/**
 * Mobile-Optimized Audio Engine
 * Spotify-Grade PWA Background Playback Architecture for Android (Samsung One UI)
 * 
 * Directives & Anti-Kill Mechanisms:
 * 1. Single persistent <audio> tag on DOM. Never dynamic new Audio().
 * 2. Hardware-level non-zero WebAudio keepalive: Keeps Qualcomm/Samsung audio DSP active so CPU never sleeps.
 * 3. Local RAM Blob Pre-Buffering: Pre-downloads audio bytes for upcoming tracks while network is active.
 *    Defeats Android Doze Mode on "Optimized" battery settings (plays locally with ZERO network needed!).
 * 4. Dual-trigger EOF bypass: Transitions 0.7s before EOF in timeupdate to prevent Android background EOF hang.
 * 5. Parallel queue pre-resolver: Pre-resolves direct CDN links for 5 upcoming tracks in memory.
 * 6. Full Android MediaSession: Lock-screen controls, 4 square artwork sizes, seekbar sync, notification resume.
 * 7. System audio interruption recovery: Auto-resumes on app return after YouTube/calls or lock-screen play tap.
 * 8. Web Locks & Wake Locks to prevent mobile tab discarding.
 */

import { state } from './state.js';
import { getBestStreamUrl, getTrackArtist, getTrackArtwork, fetchSongDetails, fetchRecommendations, streamUrlCache } from './api.js';

class AudioEngine {
  constructor() {
    // Directive 1: Exactly ONE persistent <audio> element attached to the DOM
    this.audio = document.getElementById('persistent-audio');
    if (!this.audio) {
      this.audio = document.createElement('audio');
      this.audio.id = 'persistent-audio';
      this.audio.preload = 'auto';
      this.audio.setAttribute('playsinline', 'true');
      this.audio.setAttribute('webkit-playsinline', 'true');
      document.body.appendChild(this.audio);
    } else {
      this.audio.setAttribute('playsinline', 'true');
      this.audio.setAttribute('webkit-playsinline', 'true');
    }

    this.isScrubbing = false;
    this.userExplicitlyPaused = false;
    this.wasInterruptedBySystem = false;
    this.interruptedTime = 0;
    this.pausedPosition = 0;
    this.heartbeatTimer = null;
    this.isResurrecting = false;
    this.isResolvingQueue = false;
    this.isTransitioning = false;
    this.wakeLock = null;
    this.releaseWebLock = null;
    this.audioCtx = null;
    this.keepAliveNode = null;
    this.blobUrlCache = new Map();
    this.lastPlayedBlobTrackId = null;

    this.uiCallbacks = {
      onPlaybackChange: () => {},
      onProgressUpdate: () => {},
      onTrackChange: () => {},
      onQueueChange: () => {},
      onToast: () => {}
    };

    this.setupListeners();
    this.setupMediaSession();
    this.setupInterruptionRecovery();
    this.initAudioKeepAlive();
  }

  // Allow UI layer to bind reactive rendering hooks
  bindUI(callbacks) {
    this.uiCallbacks = { ...this.uiCallbacks, ...callbacks };
  }

  /**
   * Hardware-level WebAudio keepalive buffer.
   * Generates continuous, virtually inaudible non-zero white noise (-90dB).
   * Prevents Qualcomm and Samsung One UI audio power managers from detecting digital silence
   * and cutting the hardware audio power rail when the screen is locked!
   */
  initAudioKeepAlive() {
    const startKeepAlive = () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!this.audioCtx && AudioCtx) {
          this.audioCtx = new AudioCtx();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        if (this.audioCtx && !this.keepAliveNode) {
          const sampleRate = this.audioCtx.sampleRate || 44100;
          const bufferSize = sampleRate * 2; // 2 seconds looped
          const buffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
          const channelData = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            channelData[i] = (Math.random() - 0.5) * 0.0001; // Inaudible non-zero dither
          }
          const source = this.audioCtx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const gain = this.audioCtx.createGain();
          gain.gain.value = 0.0001;
          source.connect(gain);
          gain.connect(this.audioCtx.destination);
          source.start(0);
          this.keepAliveNode = source;
        }
      } catch (e) {
        console.warn('AudioContext keepalive init deferred:', e);
      }
    };

    ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(evt => {
      document.addEventListener(evt, startKeepAlive, { once: true, passive: true });
    });
  }

  resumeAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  async requestWakeLocks() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch (e) {}

    try {
      if ('locks' in navigator && !this.releaseWebLock) {
        navigator.locks.request('mytunes_audio_playback', { mode: 'shared' }, () => {
          return new Promise((resolve) => {
            this.releaseWebLock = resolve;
          });
        });
      }
    } catch (e) {}
  }

  releaseWakeLocks() {
    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch (e) {}
      this.wakeLock = null;
    }
    if (this.releaseWebLock) {
      try { this.releaseWebLock(); } catch (e) {}
      this.releaseWebLock = null;
    }
  }

  /**
   * Pre-download audio bytes into local RAM Blob while network is active.
   * This is the definitive fix for Android "Optimized" battery mode:
   * When Android Doze mode blocks background network after 6-8 minutes,
   * upcoming songs play directly from local RAM with zero network traffic!
   */
  async prebufferTrackBlob(track) {
    if (!track || !track.id) return null;
    if (this.blobUrlCache.has(track.id)) {
      return this.blobUrlCache.get(track.id);
    }
    const streamUrl = getBestStreamUrl(track);
    if (!streamUrl) return null;

    try {
      const res = await fetch(streamUrl);
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.blobUrlCache.set(track.id, blobUrl);
        return blobUrl;
      }
    } catch (e) {
      // Graceful fallback to streaming URL
    }
    return null;
  }

  getPlayableUrl(track) {
    if (!track || !track.id) return null;
    if (this.blobUrlCache.has(track.id)) {
      return this.blobUrlCache.get(track.id);
    }
    return getBestStreamUrl(track);
  }

  /**
   * Keep-Alive Notification Heartbeat:
   * When paused because another app (YouTube / Instagram / Phone) grabbed audio focus,
   * Android's MediaSessionService will evict/dismiss the notification control panel
   * after 1-2 minutes if the session stays dormant.
   * This periodic heartbeat re-asserts the position and paused state
   * so Android keeps the media control card pinned in the notification drawer!
   */
  startNotificationHeartbeat() {
    this.stopNotificationHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.wasInterruptedBySystem || !state.currentTrack) {
        this.stopNotificationHeartbeat();
        return;
      }
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
          const cur = (this.pausedPosition > 0) ? this.pausedPosition : (this.audio.currentTime || 0);
          const dur = this.audio.duration || 100;
          this.updateMediaSessionPosition(cur, dur);
        }
        this.resumeAudioContext();
      } catch (e) {}
    }, 10000);
  }

  stopNotificationHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Resurrect & Resume Audio Pipeline
   * Resolves the "YouTube/Instagram long background pause" failure:
   * When an external app holds audio focus for minutes, the browser's TCP socket times out
   * and Android reclaims the hardware audio decoder. Calling audio.play() on a dead pipeline
   * fails silently. This method:
   * 1. Tears down the dead connection and re-arms audio.src with a fresh CDN stream
   * 2. Calls audio.load() to re-initialize the native decoder & network socket
   * 3. Accurately restores currentTime to the exact paused position
   * 4. Resumes playback, recovers WebAudio, and updates Android MediaSession
   */
  async resurrectAndResume(targetPosition) {
    if (this.isResurrecting) return;
    this.isResurrecting = true;
    this.userExplicitlyPaused = false;
    this.stopNotificationHeartbeat();
    this.resumeAudioContext();
    this.requestWakeLocks();

    const track = state.currentTrack;
    if (!track) {
      this.isResurrecting = false;
      if (state.queue.length > 0) {
        await this.loadAndPlay(state.queue.shift());
      }
      return;
    }

    const savedPosition = (targetPosition !== undefined && targetPosition !== null && !isNaN(targetPosition))
      ? targetPosition
      : ((this.pausedPosition > 0) ? this.pausedPosition : (this.audio.currentTime || 0));

    console.log(`Resurrecting audio stream for "${track.name}" at ${savedPosition.toFixed(1)}s`);

    try {
      // 1. Resolve fresh direct stream URL
      let streamUrl = this.getPlayableUrl(track);
      if (!streamUrl) {
        try {
          const fresh = await fetchSongDetails(track.id);
          if (fresh) {
            Object.assign(track, fresh);
            streamUrl = this.getPlayableUrl(track) || getBestStreamUrl(track);
          }
        } catch (e) {
          console.warn('Re-fetch details error during resurrection:', e);
        }
      }
      if (!streamUrl) {
        streamUrl = getBestStreamUrl(track);
      }

      if (!streamUrl) {
        console.error('Cannot resurrect: stream URL unavailable');
        this.isResurrecting = false;
        return;
      }

      // 2. Re-assign single persistent audio element and reload pipeline
      this.audio.src = streamUrl;
      this.audio.load();

      // 3. Restore playback position and play
      const applySeekAndPlay = async () => {
        try {
          if (savedPosition > 0 && isFinite(savedPosition)) {
            this.audio.currentTime = savedPosition;
          }
          await this.audio.play();
          state.isPlaying = true;
          this.wasInterruptedBySystem = false;
          this.interruptedTime = 0;
          this.pausedPosition = 0;
          this.updateMediaPlaybackState();
          this.updateMediaSession(track);
          this.uiCallbacks.onPlaybackChange();
          this.requestWakeLocks();
          this.resumeAudioContext();
        } catch (err) {
          console.warn('Seek and play failed during resurrection:', err);
        }
      };

      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        await applySeekAndPlay();
      } else {
        let isDone = false;
        const onCanPlay = async () => {
          if (isDone) return;
          isDone = true;
          this.audio.removeEventListener('loadedmetadata', onCanPlay);
          this.audio.removeEventListener('canplay', onCanPlay);
          await applySeekAndPlay();
        };

        this.audio.addEventListener('loadedmetadata', onCanPlay, { once: true });
        this.audio.addEventListener('canplay', onCanPlay, { once: true });
        setTimeout(onCanPlay, 1000);
      }
    } catch (err) {
      console.warn('Resurrection pipeline caught error, falling back:', err);
      try {
        await this.loadAndPlay(track, false);
        if (savedPosition > 0) {
          this.audio.currentTime = savedPosition;
        }
      } catch (e2) {}
    } finally {
      this.isResurrecting = false;
    }
  }

  setupListeners() {
    let stallWatchdog = null;

    this.audio.addEventListener('play', () => {
      this.stopNotificationHeartbeat();
      state.isPlaying = true;
      this.userExplicitlyPaused = false;
      this.wasInterruptedBySystem = false;
      this.updateMediaPlaybackState();
      this.uiCallbacks.onPlaybackChange();
      this.requestWakeLocks();
      this.resumeAudioContext();
    });

    this.audio.addEventListener('playing', () => {
      clearTimeout(stallWatchdog);
      this.isTransitioning = false;
      state.isPlaying = true;
      this.updateMediaPlaybackState();
    });

    this.audio.addEventListener('stalled', () => {
      if (state.isPlaying && !this.audio.paused && !this.isTransitioning) {
        clearTimeout(stallWatchdog);
        stallWatchdog = setTimeout(() => {
          if (state.isPlaying && !this.isTransitioning) {
            console.warn('Audio stream stalled in background. Resurrecting connection...');
            this.resurrectAndResume();
          }
        }, 3500);
      }
    });

    this.audio.addEventListener('pause', () => {
      // If paused without user action, external app (YouTube, phone call) took audio focus
      if (!this.userExplicitlyPaused && (state.isPlaying || state.currentTrack)) {
        this.wasInterruptedBySystem = true;
        this.interruptedTime = Date.now();
        this.pausedPosition = this.audio.currentTime || 0;
        this.startNotificationHeartbeat();
      }
      state.isPlaying = false;
      this.updateMediaPlaybackState();
      this.uiCallbacks.onPlaybackChange();
    });

    this.audio.addEventListener('timeupdate', () => {
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || 0;

      if (!this.isScrubbing) {
        this.uiCallbacks.onProgressUpdate(cur, dur);
      }

      // Android/Samsung Lock Screen Scrubber Synchronization
      this.updateMediaSessionPosition(cur, dur);

      // 1. Proactive Lookahead: Ensure upcoming tracks are resolved in advance
      if (dur > 0 && (dur - cur) <= 45) {
        this.resolveUpcomingQueue();
      }

      // 2. Dual-Trigger EOF Bypass:
      // Mobile Chrome on Android often throttles or fails to dispatch the 'ended' event when screen is off!
      // Transitioning at 0.7s before EOF guarantees continuous playback without stalling at the end of the file!
      if (dur > 2 && cur >= (dur - 0.7) && !this.isTransitioning) {
        this.isTransitioning = true;
        this.handleTrackTransition();
      }
    });

    // Fallback: If 'ended' event does fire first, handle it
    this.audio.addEventListener('ended', () => {
      if (!this.isTransitioning) {
        this.isTransitioning = true;
        this.handleTrackTransition();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error encountered:', e);
      if (this.audio.paused || this.wasInterruptedBySystem) {
        // Network connection timed out while paused in background; do NOT advance/skip track!
        // It will be smoothly resurrected when user taps play or returns.
        return;
      }
      if (state.queue.length > 0 && !this.isTransitioning) {
        this.isTransitioning = true;
        this.uiCallbacks.onToast('Advancing to next track...');
        this.handleTrackTransition();
      }
    });
  }

  // Handle external interruptions (YouTube, phone calls, background app switches)
  setupInterruptionRecovery() {
    const handleReturnToForeground = async () => {
      if (this.wasInterruptedBySystem && state.currentTrack) {
        console.log('Regained foreground after audio interruption. Auto-resuming...');
        await this.resurrectAndResume();
        this.uiCallbacks.onToast('Resumed playback');
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleReturnToForeground();
      }
    });

    window.addEventListener('focus', () => {
      handleReturnToForeground();
    });

    window.addEventListener('pageshow', () => {
      handleReturnToForeground();
    });
  }

  // Directive 3: Full MediaSession Controls for Samsung One UI & Android Lock Screen
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const actionMap = [
      ['play', async () => {
        this.wasInterruptedBySystem = false;
        this.userExplicitlyPaused = false;
        await this.resurrectAndResume();
      }],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.playPrevious()],
      ['nexttrack', () => this.playNext()],
      ['stop', () => this.pause()],
      ['seekbackward', (details) => {
        const skip = details.seekOffset || 10;
        this.audio.currentTime = Math.max((this.audio.currentTime || 0) - skip, 0);
        this.updateMediaSessionPosition(this.audio.currentTime, this.audio.duration);
      }],
      ['seekforward', (details) => {
        const skip = details.seekOffset || 10;
        this.audio.currentTime = Math.min((this.audio.currentTime || 0) + skip, this.audio.duration || Infinity);
        this.updateMediaSessionPosition(this.audio.currentTime, this.audio.duration);
      }],
      ['seekto', (details) => {
        if (details.seekTime !== undefined && isFinite(details.seekTime)) {
          this.audio.currentTime = details.seekTime;
          this.updateMediaSessionPosition(this.audio.currentTime, this.audio.duration);
        }
      }]
    ];

    for (const [action, handler] of actionMap) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {}
    }
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const title = track.name || 'Vibe Track';
    const artist = getTrackArtist(track);
    const album = track.album?.name || track.album || 'Single';
    const art = getTrackArtwork(track, '500x500');

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: artist,
        album: album,
        artwork: [
          { src: art, sizes: '512x512', type: 'image/jpeg' },
          { src: art, sizes: '256x256', type: 'image/jpeg' },
          { src: art, sizes: '128x128', type: 'image/jpeg' },
          { src: art, sizes: '96x96', type: 'image/jpeg' }
        ]
      });
    } catch (e) {
      console.warn('Failed to update MediaSession metadata:', e);
    }

    this.updateMediaPlaybackState();
    this.updateMediaSessionPosition(this.audio.currentTime, this.audio.duration);
  }

  updateMediaPlaybackState() {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
      } catch (e) {}
    }
  }

  updateMediaSessionPosition(currentTime, duration) {
    if (
      'mediaSession' in navigator &&
      'setPositionState' in navigator.mediaSession &&
      duration &&
      !isNaN(duration) &&
      duration > 0
    ) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: this.audio.playbackRate || 1.0,
          position: Math.min(Math.max(currentTime, 0), duration)
        });
      } catch (e) {}
    }
  }

  // Play a specific track
  async loadAndPlay(track, addToHistory = true) {
    if (!track) return;

    if (addToHistory && state.currentTrack && state.currentTrack.id !== track.id) {
      state.addToHistory(state.currentTrack);
    }

    // Revoke old blob to keep memory minimal
    if (this.lastPlayedBlobTrackId && this.lastPlayedBlobTrackId !== track.id) {
      if (this.blobUrlCache.has(this.lastPlayedBlobTrackId)) {
        URL.revokeObjectURL(this.blobUrlCache.get(this.lastPlayedBlobTrackId));
        this.blobUrlCache.delete(this.lastPlayedBlobTrackId);
      }
    }
    this.lastPlayedBlobTrackId = track.id;

    state.currentTrack = track;
    this.userExplicitlyPaused = false;
    this.wasInterruptedBySystem = false;
    this.isTransitioning = false;
    this.stopNotificationHeartbeat();

    // 1. Check in-memory stream cache or local Blob first
    let streamUrl = this.getPlayableUrl(track);

    // 2. If not cached, resolve full details
    if (!streamUrl) {
      this.uiCallbacks.onToast('Buffering high quality audio...');
      const fullSong = await fetchSongDetails(track.id);
      if (fullSong) {
        Object.assign(track, fullSong);
        state.currentTrack = track;
        streamUrl = this.getPlayableUrl(track);
      }
    }

    if (!streamUrl) {
      this.uiCallbacks.onToast('Audio stream unavailable for this track');
      return;
    }

    // 3. Single persistent audio element assignment
    this.audio.src = streamUrl;
    this.audio.load();

    try {
      await this.audio.play();
      state.isPlaying = true;
      this.requestWakeLocks();
      this.resumeAudioContext();
    } catch (err) {
      console.warn('Autoplay deferred until user interaction:', err);
      state.isPlaying = false;
    }

    this.updateMediaSession(track);
    this.uiCallbacks.onTrackChange(track);
    this.uiCallbacks.onPlaybackChange();
    this.uiCallbacks.onQueueChange();

    // 4. Immediately start pre-resolving and pre-buffering upcoming queue!
    this.resolveUpcomingQueue();
  }

  play() {
    this.userExplicitlyPaused = false;
    this.stopNotificationHeartbeat();
    this.resumeAudioContext();
    this.requestWakeLocks();

    // If was interrupted by system or pipeline is not ready, use resurrectAndResume
    if (this.wasInterruptedBySystem || !this.audio.src || this.audio.error || this.audio.readyState < 2) {
      this.resurrectAndResume();
      return;
    }

    if (this.audio.src) {
      this.audio.play().then(() => {
        state.isPlaying = true;
        this.wasInterruptedBySystem = false;
        this.updateMediaPlaybackState();
        this.uiCallbacks.onPlaybackChange();
      }).catch(err => {
        console.warn('Direct play() failed, falling back to resurrection:', err);
        this.resurrectAndResume();
      });
    } else if (state.queue.length > 0) {
      this.loadAndPlay(state.queue.shift());
    }
  }

  pause() {
    this.userExplicitlyPaused = true;
    this.wasInterruptedBySystem = false;
    this.stopNotificationHeartbeat();
    this.audio.pause();
    this.releaseWakeLocks();
  }

  togglePlayPause() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  async playNext() {
    if (state.repeatMode === 'one' && state.currentTrack) {
      this.audio.currentTime = 0;
      await this.audio.play();
      return;
    }

    if (state.queue.length === 0 && state.repeatMode === 'all' && state.currentTrack) {
      state.queue.push(state.currentTrack);
    }

    if (state.queue.length > 0) {
      const nextTrack = state.queue.shift();
      if (state.repeatMode === 'all' && state.currentTrack) {
        state.queue.push(state.currentTrack);
      }
      await this.loadAndPlay(nextTrack);
    } else if (state.autoplay && state.currentTrack) {
      this.uiCallbacks.onToast('Autoplaying recommended vibe...');
      const recommendations = await fetchRecommendations(state.currentTrack);
      if (recommendations.length > 0) {
        const deduplicated = recommendations.filter(
          s => s.id !== state.currentTrack.id && !state.queue.some(q => q.id === s.id)
        );
        if (deduplicated.length > 0) {
          state.queue.push(...deduplicated.slice(0, 10));
          this.uiCallbacks.onQueueChange();
          const next = state.queue.shift();
          await this.loadAndPlay(next);
          return;
        }
      }
      this.uiCallbacks.onToast('Queue finished');
      this.pause();
    } else {
      this.uiCallbacks.onToast('Queue finished');
      this.pause();
    }
  }

  async playPrevious() {
    if (this.audio.currentTime > 4) {
      this.audio.currentTime = 0;
      return;
    }

    if (state.history.length > 0) {
      const prevTrack = state.history.shift();
      state.saveHistory();
      if (state.currentTrack) {
        state.queue.unshift(state.currentTrack);
        this.uiCallbacks.onQueueChange();
      }
      await this.loadAndPlay(prevTrack, false);
    } else {
      this.audio.currentTime = 0;
    }
  }

  /**
   * Parallel Lookahead Queue Pre-Resolver & Blob Pre-Bufferer
   * Resolves direct CDN stream URLs for the upcoming 5 tracks in parallel.
   * Pre-downloads the audio binary as local Blobs for the immediate next 2 tracks.
   * This completely defeats Android Doze mode on "Optimized" battery settings!
   */
  async resolveUpcomingQueue() {
    if (this.isResolvingQueue) return;
    this.isResolvingQueue = true;

    try {
      // PRIORITY 1: Pre-resolve direct stream URLs for the upcoming 5 tracks in queue in parallel!
      const upcoming = state.queue.slice(0, 5);
      const resolvePromises = upcoming.map(async (track) => {
        if (!track || !track.id) return;
        let url = getBestStreamUrl(track);
        if (!url) {
          try {
            const full = await fetchSongDetails(track.id);
            if (full) {
              Object.assign(track, full);
              url = getBestStreamUrl(track);
            }
          } catch (e) {
            console.warn(`Failed pre-resolving track ${track.id}:`, e);
          }
        }
      });

      await Promise.allSettled(resolvePromises);

      // PRIORITY 2: Pre-buffer audio data as local Blobs for the immediate next 2 tracks!
      // When Android Doze mode shuts down background network after 6-8 minutes,
      // these tracks play 100% locally from device RAM without touching the internet!
      const immediateNext = state.queue.slice(0, 2);
      for (const t of immediateNext) {
        if (t && t.id && !this.blobUrlCache.has(t.id)) {
          this.prebufferTrackBlob(t); // runs asynchronously in background
        }
      }

      // PRIORITY 3: If queue is running low (<= 3 tracks) and autoplay is on, replenish recommendations
      if (state.queue.length <= 3 && state.autoplay && state.currentTrack) {
        try {
          const suggestions = await fetchRecommendations(state.currentTrack);
          if (suggestions && suggestions.length > 0) {
            const fresh = suggestions.filter(
              s => s.id !== state.currentTrack.id && !state.queue.some(q => q.id === s.id)
            );
            if (fresh.length > 0) {
              state.queue.push(...fresh.slice(0, 10));
              this.uiCallbacks.onQueueChange();

              // Pre-resolve fresh suggestions
              const freshUpcoming = state.queue.slice(0, 3);
              freshUpcoming.forEach(t => {
                if (t && t.id && !getBestStreamUrl(t)) {
                  fetchSongDetails(t.id).then(f => {
                    if (f) Object.assign(t, f);
                  }).catch(() => {});
                }
              });
            }
          }
        } catch (e) {
          console.warn('Autoplay pre-fetch failed:', e);
        }
      }
    } finally {
      this.isResolvingQueue = false;
    }
  }

  /**
   * Zero-Latency Synchronous Track Switch
   * Synchronously assigns audio.src = streamUrl and calls audio.play()
   * maintains the Android audio session with zero silence gap!
   */
  handleTrackTransition() {
    // Mode 1: Repeat One
    if (state.repeatMode === 'one' && state.currentTrack) {
      this.audio.currentTime = 0;
      this.audio.play().catch(console.error);
      return;
    }

    // Mode 2: Repeat All (loop back finished track)
    if (state.repeatMode === 'all' && state.currentTrack) {
      state.queue.push(state.currentTrack);
      this.uiCallbacks.onQueueChange();
    }

    // If queue is empty, finish playback
    if (state.queue.length === 0) {
      this.isTransitioning = false;
      state.isPlaying = false;
      this.updateMediaPlaybackState();
      this.uiCallbacks.onPlaybackChange();
      this.releaseWakeLocks();
      this.uiCallbacks.onToast('Queue finished');
      return;
    }

    // Shift next track from queue
    const nextTrack = state.queue.shift();
    if (state.currentTrack) {
      state.addToHistory(state.currentTrack);
    }

    // Revoke previous played Blob URL to conserve memory
    if (this.lastPlayedBlobTrackId && this.lastPlayedBlobTrackId !== nextTrack.id) {
      if (this.blobUrlCache.has(this.lastPlayedBlobTrackId)) {
        URL.revokeObjectURL(this.blobUrlCache.get(this.lastPlayedBlobTrackId));
        this.blobUrlCache.delete(this.lastPlayedBlobTrackId);
      }
    }
    this.lastPlayedBlobTrackId = nextTrack.id;
    state.currentTrack = nextTrack;

    // Check pre-resolved local Blob URL (or direct CDN stream URL)
    const streamUrl = this.getPlayableUrl(nextTrack);

    if (streamUrl) {
      // 100% SYNCHRONOUS assignment and play!
      this.audio.src = streamUrl;
      const playPromise = this.audio.play();
      if (playPromise) {
        playPromise.then(() => {
          this.isTransitioning = false;
          state.isPlaying = true;
          this.updateMediaPlaybackState();
          this.requestWakeLocks();
        }).catch(err => {
          console.warn('Playback error on zero-latency track switch:', err);
          this.isTransitioning = false;
        });
      }

      this.updateMediaSession(nextTrack);
      this.uiCallbacks.onTrackChange(nextTrack);
      this.uiCallbacks.onPlaybackChange();
      this.uiCallbacks.onQueueChange();

      // Immediately kick off background lookahead for subsequent songs!
      this.resolveUpcomingQueue();
    } else {
      // Fallback: If not cached yet, load and play asynchronously
      this.loadAndPlay(nextTrack);
    }
  }
}

export const engine = new AudioEngine();

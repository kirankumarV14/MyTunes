/**
 * Global State Management
 * Persistent reactive store for songs, playlists, history, and user settings
 */

import { STORAGE_KEYS, DEFAULT_PLAYLIST_IMAGE } from './config.js';
import { getTrackArtist, getTrackArtwork } from './api.js';

class StateManager {
  constructor() {
    this.currentTrack = null;
    this.queue = [];
    this.originalQueue = [];
    this.history = this.loadHistory();
    this.isPlaying = false;
    this.isShuffled = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.autoplay = true;
    this.prefetchedNextTrackId = null;
    this.prefetchedNextUrl = null;
    this.likedSongs = this.loadLikedSongs();
    this.playlists = this.loadPlaylists();
    this.activeTab = 'home';
    this.activeFilter = 'all';
    this.isGridLayout = false;
    this.selectedPlaylistId = null;
    this.listeners = new Set();
  }

  // Event listener registry for reactive UI updates
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(event, data) {
    this.listeners.forEach(fn => fn(event, data));
  }

  // --- LIKED SONGS STORAGE ---
  loadLikedSongs() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.LIKED_SONGS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Failed to parse liked songs from localStorage', e);
      return [];
    }
  }

  saveLikedSongs() {
    try {
      localStorage.setItem(STORAGE_KEYS.LIKED_SONGS, JSON.stringify(this.likedSongs));
      this.notify('liked_updated', this.likedSongs);
    } catch (e) {
      console.error('Failed to save liked songs', e);
    }
  }

  toggleLike(track) {
    if (!track || !track.id) return false;
    const index = this.likedSongs.findIndex(s => s.id === track.id);
    let isLiked = false;
    if (index >= 0) {
      this.likedSongs.splice(index, 1);
      isLiked = false;
    } else {
      // Clean persistent metadata: never store transient CDN links in storage
      const safeTrack = {
        id: track.id,
        name: track.name,
        artist: getTrackArtist(track),
        album: track.album?.name || track.album || '',
        language: track.language || '',
        image: getTrackArtwork(track, '500x500'),
        duration: track.duration || 0
      };
      this.likedSongs.unshift(safeTrack);
      isLiked = true;
    }
    this.saveLikedSongs();
    return isLiked;
  }

  isLiked(trackId) {
    if (!trackId) return false;
    return this.likedSongs.some(s => s.id === trackId);
  }

  // --- PLAYLIST STORAGE & MANAGEMENT ---
  loadPlaylists() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          // Filter out legacy starter mock playlists
          const filtered = parsed.filter(p => 
            !['Midnight Drive Lofi', 'Tamil Energy Workout', 'Acoustic Evenings'].includes(p.name) &&
            !['p_1', 'p_2', 'p_3'].includes(p.id)
          );
          if (filtered.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(filtered));
          }
          return filtered;
        }
      }
    } catch (e) {}

    return [];
  }

  savePlaylists(customList) {
    try {
      const list = customList || this.playlists;
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(list));
      this.notify('playlists_updated', this.playlists);
    } catch (e) {
      console.error('Failed to save playlists', e);
    }
  }

  getPlaylist(playlistId) {
    if (!playlistId) return null;
    return this.playlists.find(p => p.id === playlistId || String(p.id) === String(playlistId)) || null;
  }

  createPlaylist(name, art = null) {
    const trimmedName = name.trim() || 'My Playlist';
    const newPl = {
      id: 'pl_' + Date.now(),
      name: trimmedName,
      art: art || DEFAULT_PLAYLIST_IMAGE,
      tracks: []
    };
    this.playlists.unshift(newPl);
    this.savePlaylists();
    return newPl;
  }

  deletePlaylist(playlistId) {
    const idx = this.playlists.findIndex(p => p.id === playlistId);
    if (idx >= 0) {
      this.playlists.splice(idx, 1);
      this.savePlaylists();
      return true;
    }
    return false;
  }

  addTrackToPlaylist(playlistId, track) {
    if (!track || !track.id) return false;
    const pl = this.getPlaylist(playlistId);
    if (!pl) return false;

    // Check duplicate
    if (pl.tracks.some(t => t.id === track.id)) {
      return false; // Already in playlist
    }

    const safeTrack = {
      id: track.id,
      name: track.name,
      artist: getTrackArtist(track),
      album: track.album?.name || track.album || '',
      language: track.language || '',
      image: getTrackArtwork(track, '500x500'),
      duration: track.duration || 0
    };

    pl.tracks.unshift(safeTrack);
    // If playlist artwork was default, adopt song artwork
    if (!pl.art || pl.art === DEFAULT_PLAYLIST_IMAGE) {
      pl.art = safeTrack.image;
    }

    this.savePlaylists();
    return true;
  }

  removeTrackFromPlaylist(playlistId, trackId) {
    const pl = this.getPlaylist(playlistId);
    if (!pl) return false;
    const idx = pl.tracks.findIndex(t => t.id === trackId);
    if (idx >= 0) {
      pl.tracks.splice(idx, 1);
      this.savePlaylists();
      return true;
    }
    return false;
  }

  // --- PLAYBACK HISTORY STORAGE ---
  loadHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
      this.notify('history_updated', this.history);
    } catch (e) {
      console.error('Failed to save history', e);
    }
  }

  addToHistory(track) {
    if (!track || !track.id) return;
    // Deduplicate existing entry
    this.history = this.history.filter(t => t.id !== track.id);
    const safeTrack = {
      id: track.id,
      name: track.name,
      artist: getTrackArtist(track),
      album: track.album?.name || track.album || '',
      language: track.language || '',
      image: getTrackArtwork(track, '500x500'),
      duration: track.duration || 0
    };
    this.history.unshift(safeTrack);
    if (this.history.length > 25) {
      this.history.pop();
    }
    this.saveHistory();
  }
}

export const state = new StateManager();

/**
 * Main Application Bootstrap Script
 * Vibe Music - Production ES6 Modular Architecture
 */

import { SHOWCASE_TRACKS } from './config.js';
import { state } from './state.js';
import { engine } from './audio.js';
import { executeMultiPassSearch } from './search.js';
import {
  showToast,
  renderHomeScreen,
  renderLibraryScreen,
  renderQueue,
  updatePlaybackUI,
  updateTrackInfoUI,
  updateProgressUI,
  switchTab,
  createTrackRowElement,
  escapeHtml,
  registerLiveSearchTrigger,
  openPlaylistDetailModal,
  hideAppLoading,
  showAppLoading,
  showAppError,
  hideAppError
} from './ui.js';

// Bind AudioEngine callbacks to UI rendering
engine.bindUI({
  onPlaybackChange: () => updatePlaybackUI(),
  onProgressUpdate: (cur, dur) => updateProgressUI(cur, dur),
  onTrackChange: (track) => updateTrackInfoUI(track),
  onQueueChange: () => renderQueue(),
  onToast: (msg) => showToast(msg)
});

// Search input debouncer (300ms)
let searchDebounceTimer = null;
function handleSearchInput(query) {
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) {
    clearBtn.classList.toggle('visible', query.trim().length > 0);
  }

  if (state.activeTab !== 'search') {
    switchTab('search');
  }

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    runSearch(query.trim());
  }, 300);
}

// Live search coordinator
async function runSearch(query) {
  const stateView = document.getElementById('searchStateView');
  const resultsList = document.getElementById('searchResultsList');
  const resultsHeader = document.getElementById('searchResultsHeader');
  const resultsCount = document.getElementById('searchResultCount');

  if (!query) {
    if (stateView) stateView.style.display = 'flex';
    if (resultsList) resultsList.style.display = 'none';
    if (resultsHeader) resultsHeader.textContent = 'Browse All';
    if (resultsCount) resultsCount.textContent = '';
    return;
  }

  if (stateView) {
    stateView.style.display = 'flex';
    stateView.innerHTML = `
      <span class="material-symbols-outlined" style="animation: spin 1s infinite linear;">sync</span>
      <h4 class="search-state-title">Searching JioSaavn...</h4>
      <p class="search-state-desc">Finding high quality 320kbps tracks for "${escapeHtml(query)}"</p>
    `;
  }
  if (resultsList) resultsList.style.display = 'none';

  // PART 2: Execute Multi-Pass Search Engine
  const tracks = await executeMultiPassSearch(query, state.activeFilter);

  if (!tracks || tracks.length === 0) {
    if (stateView) {
      stateView.style.display = 'flex';
      stateView.innerHTML = `
        <span class="material-symbols-outlined">search_off</span>
        <h4 class="search-state-title">No matching songs found</h4>
        <p class="search-state-desc">Try searching by artist or movie album.</p>
      `;
    }
    if (resultsCount) resultsCount.textContent = '0 results';
  } else {
    if (stateView) stateView.style.display = 'none';
    if (resultsList) {
      resultsList.style.display = 'flex';
      resultsList.innerHTML = '';
      tracks.forEach((track, idx) => {
        resultsList.appendChild(createTrackRowElement(track, { trackList: tracks, index: idx }));
      });
    }
    if (resultsHeader) resultsHeader.textContent = `Results for "${query}"`;
    if (resultsCount) resultsCount.textContent = `${tracks.length} songs`;
  }
}

// Register search trigger for global invocation
registerLiveSearchTrigger((q) => {
  handleSearchInput(q);
});

// App Initialization
document.addEventListener('DOMContentLoaded', () => {

  // 1. Initial Render & Viewport/Filter Setup
  switchTab('home');
  renderHomeScreen();
  renderLibraryScreen();
  renderQueue();

  // Load default featured song into player ready state (without autoplaying)
  if (SHOWCASE_TRACKS.length > 0) {
    state.currentTrack = SHOWCASE_TRACKS[0];
    state.queue = SHOWCASE_TRACKS.slice(1);
    updateTrackInfoUI(SHOWCASE_TRACKS[0]);
    renderQueue();
  }

  // Dismiss initial preloader smoothly once DOM and rails are populated
  setTimeout(() => {
    hideAppLoading();
  }, 450);

  if (!navigator.onLine) {
    showAppError('No Internet Connection', 'You are currently offline. Tap below to access your saved library.');
  }

  // 2. Tab Navigation
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
    });
  });

  // 3. Global Search Input
  const searchInput = document.getElementById('globalSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handleSearchInput(e.target.value);
    });
    searchInput.addEventListener('focus', () => {
      if (state.activeTab !== 'search') switchTab('search');
    });
  }

  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      handleSearchInput('');
      searchInput.focus();
    });
  }

  // Default search filter to all
  state.activeFilter = 'all';

  // 5. Mini-Player Click to Expand Fullscreen Player
  const miniPlayerTrigger = document.getElementById('miniPlayerTrigger');
  const nowPlayingModal = document.getElementById('nowPlayingModal');
  const collapsePlayerBtn = document.getElementById('collapsePlayerBtn');

  if (miniPlayerTrigger && nowPlayingModal) {
    miniPlayerTrigger.addEventListener('click', () => {
      nowPlayingModal.classList.add('open');
    });
  }

  if (collapsePlayerBtn && nowPlayingModal) {
    collapsePlayerBtn.addEventListener('click', () => {
      nowPlayingModal.classList.remove('open');
    });
  }

  // 6. Playback Controls
  const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
  const giantPlayPauseBtn = document.getElementById('giantPlayPauseBtn');
  const prevTrackBtn = document.getElementById('prevTrackBtn');
  const nextTrackBtn = document.getElementById('nextTrackBtn');
  const miniNextBtn = document.getElementById('miniNextBtn');

  if (miniPlayPauseBtn) miniPlayPauseBtn.addEventListener('click', () => engine.togglePlayPause());
  if (giantPlayPauseBtn) giantPlayPauseBtn.addEventListener('click', () => engine.togglePlayPause());
  if (prevTrackBtn) prevTrackBtn.addEventListener('click', () => engine.playPrevious());
  if (nextTrackBtn) nextTrackBtn.addEventListener('click', () => engine.playNext());
  if (miniNextBtn) miniNextBtn.addEventListener('click', () => engine.playNext());

  // 7. Shuffle & Repeat
  const shuffleBtn = document.getElementById('shuffleBtn');
  const queueShuffleToggle = document.getElementById('queueShuffleToggle');
  const repeatBtn = document.getElementById('repeatBtn');

  function toggleShuffle() {
    state.isShuffled = !state.isShuffled;
    if (state.isShuffled) {
      state.originalQueue = [...state.queue];
      state.queue.sort(() => Math.random() - 0.5);
      shuffleBtn?.classList.add('active-mode');
      queueShuffleToggle?.classList.add('active');
      showToast('Queue Shuffled');
    } else {
      if (state.originalQueue.length) state.queue = [...state.originalQueue];
      shuffleBtn?.classList.remove('active-mode');
      queueShuffleToggle?.classList.remove('active');
      showToast('Queue Unshuffled');
    }
    renderQueue();
  }

  if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);
  if (queueShuffleToggle) queueShuffleToggle.addEventListener('click', toggleShuffle);

  if (repeatBtn) {
    repeatBtn.addEventListener('click', () => {
      if (state.repeatMode === 'off') {
        state.repeatMode = 'all';
        repeatBtn.classList.add('active-mode');
        repeatBtn.querySelector('.material-symbols-outlined').textContent = 'repeat';
        showToast('Repeat All');
      } else if (state.repeatMode === 'all') {
        state.repeatMode = 'one';
        repeatBtn.classList.add('active-mode');
        repeatBtn.querySelector('.material-symbols-outlined').textContent = 'repeat_one';
        showToast('Repeat One');
      } else {
        state.repeatMode = 'off';
        repeatBtn.classList.remove('active-mode');
        repeatBtn.querySelector('.material-symbols-outlined').textContent = 'repeat';
        showToast('Repeat Off');
      }
    });
  }

  // 8. Autoplay Switch in Queue Drawer
  const autoplaySwitch = document.getElementById('autoplaySwitch');
  if (autoplaySwitch) {
    autoplaySwitch.addEventListener('click', () => {
      state.autoplay = !state.autoplay;
      autoplaySwitch.classList.toggle('active', state.autoplay);
      autoplaySwitch.setAttribute('aria-checked', state.autoplay);
      showToast(`Autoplay ${state.autoplay ? 'Enabled' : 'Disabled'}`);
    });
  }

  // 9. Interactive Audio Scrubber (Seeker)
  const scrubberRail = document.getElementById('scrubberRail');
  if (scrubberRail) {
    function seekFromEvent(e) {
      if (!engine.audio.duration || isNaN(engine.audio.duration)) return;
      const rect = scrubberRail.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const percent = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      engine.audio.currentTime = percent * engine.audio.duration;
      updateProgressUI(engine.audio.currentTime, engine.audio.duration);
    }

    scrubberRail.addEventListener('mousedown', (e) => {
      engine.isScrubbing = true;
      seekFromEvent(e);
      const onMove = (moveEvt) => seekFromEvent(moveEvt);
      const onUp = () => {
        engine.isScrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    scrubberRail.addEventListener('touchstart', (e) => {
      engine.isScrubbing = true;
      seekFromEvent(e);
      const onTouchMove = (moveEvt) => seekFromEvent(moveEvt);
      const onTouchEnd = () => {
        engine.isScrubbing = false;
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };
      window.addEventListener('touchmove', onTouchMove);
      window.addEventListener('touchend', onTouchEnd);
    });
  }

  // 10. Queue Drawer Opening & Closing
  const openQueueBtn = document.getElementById('openQueueBtn');
  const queueDrawer = document.getElementById('queueDrawer');
  const queueBackdrop = document.getElementById('queueBackdrop');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const clearQueueBtn = document.getElementById('clearQueueBtn');

  function openQueue() {
    renderQueue();
    queueDrawer?.classList.add('open');
    queueBackdrop?.classList.add('open');
  }

  function closeQueue() {
    queueDrawer?.classList.remove('open');
    queueBackdrop?.classList.remove('open');
  }

  if (openQueueBtn) openQueueBtn.addEventListener('click', openQueue);
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeQueue);
  if (queueBackdrop) queueBackdrop.addEventListener('click', closeQueue);

  if (clearQueueBtn) {
    clearQueueBtn.addEventListener('click', () => {
      state.queue = [];
      renderQueue();
      showToast('Queue cleared');
    });
  }

  // 11. Liked Songs Button in Fullscreen Player & Mini-Player
  const playerHeartBtn = document.getElementById('playerHeartBtn');
  const miniLikeBtn = document.getElementById('miniLikeBtn');

  function toggleCurrentLike() {
    if (!state.currentTrack) return;
    const isLiked = state.toggleLike(state.currentTrack);
    updateTrackInfoUI(state.currentTrack);
    showToast(isLiked ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
  }

  if (playerHeartBtn) playerHeartBtn.addEventListener('click', toggleCurrentLike);
  if (miniLikeBtn) miniLikeBtn.addEventListener('click', toggleCurrentLike);

  // Liked Songs Playback & Banner Action
  const playLikedSongs = () => {
    if (state.likedSongs.length > 0) {
      state.setQueue(state.likedSongs, 0);
      engine.loadAndPlay(state.likedSongs[0]);
      engine.resolveUpcomingQueue();
      showToast(`Playing Liked Songs (${state.likedSongs.length})`);
    } else {
      showToast('No liked songs yet. Tap the heart on any song to save it.');
    }
  };

  const playLikedSongsBtn = document.getElementById('playLikedSongsBtn');
  const likedSongsBanner = document.getElementById('likedSongsBanner');
  const likedSectionPlayBtn = document.getElementById('likedSectionPlayBtn');

  if (likedSongsBanner) {
    likedSongsBanner.addEventListener('click', (e) => {
      if (e.target.closest('#playLikedSongsBtn')) return;
      e.stopPropagation();
      openPlaylistDetailModal('liked');
    });
  }

  if (playLikedSongsBtn) {
    playLikedSongsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playLikedSongs();
    });
  }

  if (likedSectionPlayBtn) {
    likedSectionPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playLikedSongs();
    });
  }

  // 12. Create New Playlist Modal
  const openNewPlaylistModalBtn = document.getElementById('openNewPlaylistModalBtn');
  const newPlaylistModal = document.getElementById('newPlaylistModal');
  const cancelPlaylistModalBtn = document.getElementById('cancelPlaylistModalBtn');
  const savePlaylistModalBtn = document.getElementById('savePlaylistModalBtn');
  const newPlaylistNameInput = document.getElementById('newPlaylistNameInput');

  if (openNewPlaylistModalBtn && newPlaylistModal) {
    openNewPlaylistModalBtn.addEventListener('click', () => {
      newPlaylistModal.classList.add('open');
      if (newPlaylistNameInput) {
        newPlaylistNameInput.value = '';
        newPlaylistNameInput.focus();
      }
    });
  }

  function closePlaylistModal() {
    newPlaylistModal?.classList.remove('open');
    state.pendingTrackForNewPlaylist = null;
  }

  if (newPlaylistModal) {
    newPlaylistModal.addEventListener('click', (e) => {
      if (e.target === newPlaylistModal) closePlaylistModal();
    });
  }

  if (cancelPlaylistModalBtn) cancelPlaylistModalBtn.addEventListener('click', closePlaylistModal);
  if (savePlaylistModalBtn && newPlaylistNameInput) {
    savePlaylistModalBtn.addEventListener('click', () => {
      const name = newPlaylistNameInput.value.trim();
      if (name) {
        const newPl = state.createPlaylist(name);
        if (state.pendingTrackForNewPlaylist) {
          state.addTrackToPlaylist(newPl.id, state.pendingTrackForNewPlaylist);
          showToast(`Created "${name}" & added song`);
          state.pendingTrackForNewPlaylist = null;
        } else {
          showToast(`Playlist "${name}" created`);
        }
        renderLibraryScreen();
        renderHomeScreen();
        closePlaylistModal();
        openPlaylistDetailModal(newPl.id);
      }
    });
  }

  // 13. Grid/List Layout Toggle for Playlists
  const toggleLayoutBtn = document.getElementById('toggleLayoutBtn');
  const layoutIcon = document.getElementById('layoutIcon');
  const playlistsContainer = document.getElementById('playlistsContainer');

  if (toggleLayoutBtn && playlistsContainer && layoutIcon) {
    toggleLayoutBtn.addEventListener('click', () => {
      state.isGridLayout = !state.isGridLayout;
      playlistsContainer.classList.toggle('is-grid-layout', state.isGridLayout);
      layoutIcon.textContent = state.isGridLayout ? 'view_list' : 'grid_view';
      showToast(state.isGridLayout ? 'Switched to Grid view' : 'Switched to List view');
    });
  }

  // 14. PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker registered successfully:', reg.scope))
        .catch((err) => console.warn('Service Worker registration failed:', err));
    });
  }

  // 15. Online/Offline network monitoring
  window.addEventListener('online', () => {
    const text = document.getElementById('onlineStatusText');
    const dot = document.querySelector('.connection-dot');
    if (text) text.textContent = 'Online';
    if (dot) dot.style.background = '#00e5ff';
    hideAppError();
    showToast('Back online • Internet restored');
    renderHomeScreen();
  });

  window.addEventListener('offline', () => {
    const text = document.getElementById('onlineStatusText');
    const dot = document.querySelector('.connection-dot');
    if (text) text.textContent = 'Offline';
    if (dot) dot.style.background = '#ff5252';
    showAppError('No Internet Connection', 'You are currently offline. Please check your Wi-Fi or mobile data.');
  });

  // 16. Share button
  const shareSongBtn = document.getElementById('shareSongBtn');
  if (shareSongBtn) {
    shareSongBtn.addEventListener('click', () => {
      if (navigator.share && state.currentTrack) {
        navigator.share({
          title: state.currentTrack.name,
          text: `Listening to ${state.currentTrack.name} on Vibe Music!`,
          url: window.location.href
        }).catch(() => {});
      } else {
        showToast('Link copied to clipboard');
      }
    });
  }

  // 17. Device output pill
  const deviceOutputPill = document.getElementById('deviceOutputPill');
  if (deviceOutputPill) {
    deviceOutputPill.addEventListener('click', () => {
      showToast('Connected: Samsung Ultra High Quality Audio');
    });
  }

  // 18. See All Tamil Releases button
  const seeAllReleasesBtn = document.getElementById('seeAllReleasesBtn');
  if (seeAllReleasesBtn) {
    seeAllReleasesBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('globalSearchInput');
      if (searchInput) {
        searchInput.value = 'Tamil Trending Hits';
        switchTab('search');
        handleSearchInput('Tamil Trending Hits');
      }
    });
  }

  // 19. Dynamic Home Search Bar Hide on Scroll Down / Reveal on Scroll Up
  const appHeader = document.querySelector('.app-header');
  const headerSearchBar = document.getElementById('headerSearchBar');
  let lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  let scrollTicking = false;

  const onScroll = () => {
    if (scrollTicking) return;
    scrollTicking = true;

    window.requestAnimationFrame(() => {
      if (state.activeTab === 'home') {
        const currentY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        const delta = currentY - lastScrollY;

        if (currentY <= 15) {
          if (appHeader) appHeader.classList.remove('search-bar-hidden');
          if (headerSearchBar) headerSearchBar.classList.remove('is-collapsed');
        } else if (delta > 3 && currentY > 20) {
          // User scrolling down -> smoothly move up search bar and hide it
          if (appHeader) appHeader.classList.add('search-bar-hidden');
          if (headerSearchBar) headerSearchBar.classList.add('is-collapsed');
        } else if (delta < -3) {
          // User scrolling up -> smoothly reveal search bar
          if (appHeader) appHeader.classList.remove('search-bar-hidden');
          if (headerSearchBar) headerSearchBar.classList.remove('is-collapsed');
        }
        lastScrollY = currentY;
      } else {
        if (appHeader) appHeader.classList.remove('search-bar-hidden');
        if (headerSearchBar) headerSearchBar.classList.remove('is-collapsed');
      }
      scrollTicking = false;
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true });

  // 20. Rename Playlist Dialog Wireup
  const renamePlaylistModal = document.getElementById('renamePlaylistModal');
  const renamePlaylistNameInput = document.getElementById('renamePlaylistNameInput');
  const cancelRenamePlaylistModalBtn = document.getElementById('cancelRenamePlaylistModalBtn');
  const saveRenamePlaylistModalBtn = document.getElementById('saveRenamePlaylistModalBtn');

  function closeRenameModal() {
    renamePlaylistModal?.classList.remove('open');
    state.targetPlaylistForRename = null;
  }

  if (renamePlaylistModal) {
    renamePlaylistModal.addEventListener('click', (e) => {
      if (e.target === renamePlaylistModal) closeRenameModal();
    });
  }
  if (cancelRenamePlaylistModalBtn) cancelRenamePlaylistModalBtn.addEventListener('click', closeRenameModal);
  if (saveRenamePlaylistModalBtn && renamePlaylistNameInput) {
    const applyRename = () => {
      const newName = renamePlaylistNameInput.value.trim();
      if (newName && state.targetPlaylistForRename) {
        const pl = state.getPlaylist(state.targetPlaylistForRename);
        if (pl) {
          pl.name = newName;
          state.savePlaylists();
          // Update live elements inside the open playlist detail modal immediately
          const heroName = document.getElementById('playlistDetailHeroName');
          const navTitle = document.getElementById('playlistDetailNavTitle');
          if (heroName) heroName.textContent = newName;
          if (navTitle) navTitle.textContent = newName;
          renderLibraryScreen();
          renderHomeScreen();
          showToast(`Playlist renamed to "${newName}"`);
        }
      }
      closeRenameModal();
    };
    saveRenamePlaylistModalBtn.addEventListener('click', applyRename);
    renamePlaylistNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyRename();
      } else if (e.key === 'Escape') {
        closeRenameModal();
      }
    });
  }
});


/**
 * UI Rendering & DOM Management Layer
 * Spotify & Samsung One UI aesthetics: dynamic category rails, Jump Back In,
 * Continue Listening history, Playlist container modal, and Song context menus.
 */

import {
  DEFAULT_FALLBACK_IMAGE,
  DEFAULT_PLAYLIST_IMAGE,
  CURATED_RAILS,
  SHOWCASE_TRACKS,
  CURATED_SAI_TRACKS,
  CURATED_TAMIL_RELEASES,
  CURATED_RAHMAN_TRACKS
} from './config.js';
import { state } from './state.js';
import { engine } from './audio.js';
import { getTrackArtwork, getTrackArtist, formatTime, fetchCategorySongs, searchSongs, isCleanOriginalSong } from './api.js';

// Universal Image Fallback string
export const IMG_FALLBACK = `onerror="this.onerror=null;this.src='${DEFAULT_FALLBACK_IMAGE}';"`;

/**
 * Toast Notification Helper
 */
let toastTimer = null;
export function showToast(message) {
  const toast = document.getElementById('actionToast');
  const msgSpan = document.getElementById('toastMessage');
  if (!toast || !msgSpan) return;

  msgSpan.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}

/**
 * HTML Escaping utility
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Create standardized One UI track row element
 */
export function createTrackRowElement(track, options = {}) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.id = track.id;

  if (state.currentTrack && state.currentTrack.id === track.id) {
    row.classList.add('is-active');
  }

  const isLiked = state.isLiked(track.id);
  const artwork = getTrackArtwork(track, '150x150');
  const artist = getTrackArtist(track);
  const bitrate = track.downloadUrl ? '320kbps' : 'AAC';

  row.innerHTML = `
    <div class="track-left">
      <div class="track-thumb-wrapper">
        <img class="track-thumb" src="${artwork}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
        <div class="track-hover-overlay">
          <span class="material-symbols-outlined" style="color: var(--primary); font-size: 24px;">play_arrow</span>
        </div>
      </div>
      <div class="track-info">
        <div class="track-title-row">
          <span class="track-title">${escapeHtml(track.name)}</span>
          <span class="bitrate-badge">${bitrate}</span>
        </div>
        <span class="track-subtitle">${escapeHtml(artist)}</span>
      </div>
    </div>
    <div class="track-right">
      <button class="icon-btn like-btn ${isLiked ? 'is-liked' : ''}" title="Like">
        <span class="material-symbols-outlined" style="font-size: 20px; ${isLiked ? "font-variation-settings: 'FILL' 1;" : ''}">favorite</span>
      </button>
      <button class="icon-btn track-menu-btn" title="Song options">
        <span class="material-symbols-outlined" style="font-size: 20px;">more_vert</span>
      </button>
    </div>
  `;

  // Row click -> Play track and queue remaining tracks in collection
  row.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn')) return;
    if (options.trackList && Array.isArray(options.trackList)) {
      const idx = options.trackList.findIndex(t => t.id === track.id);
      if (idx >= 0) {
        state.queue = [...options.trackList.slice(idx + 1)];
      }
    }
    engine.loadAndPlay(track);
    engine.resolveUpcomingQueue();
  });

  // Like button
  const likeBtn = row.querySelector('.like-btn');
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const liked = state.toggleLike(track);
    likeBtn.classList.toggle('is-liked', liked);
    const icon = likeBtn.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.style.fontVariationSettings = liked ? "'FILL' 1" : "'FILL' 0";
    }
    showToast(liked ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
    updateLikedSongsView();
  });

  // Context Menu (Add to Playlist / Queue)
  const menuBtn = row.querySelector('.track-menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSongContextMenu(track);
  });

  return row;
}

/**
 * Context Menu Dialog: Add to Playlist / Queue / Like / Play Next
 */
export function openSongContextMenu(track) {
  let modal = document.getElementById('songContextModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'songContextModal';
    modal.className = 'playlist-modal-backdrop';
    document.body.appendChild(modal);
  }

  const isLiked = state.isLiked(track.id);
  const art = getTrackArtwork(track, '150x150');
  const artist = getTrackArtist(track);

  let playlistsHtml = '';
  if (state.playlists.length === 0) {
    playlistsHtml = `
      <div style="padding: 14px 10px; text-align: center; background: var(--surface-2); border-radius: 12px; margin-top: 6px;">
        <p style="font-size: 13px; font-weight: 600; color: var(--text-high);">No playlists created yet</p>
        <p style="font-size: 11px; color: var(--text-medium); margin-top: 2px;">Create your first playlist to organize your songs.</p>
        <button class="context-create-pl-link" id="contextPromptCreatePlBtn" style="margin: 8px auto 0; font-size: 12px; background: var(--surface-3);">
          <span class="material-symbols-outlined" style="font-size: 16px;">add</span>
          Create Playlist
        </button>
      </div>
    `;
  } else {
    playlistsHtml = state.playlists.map(pl => {
      const alreadyIn = pl.tracks && pl.tracks.some(t => t.id === track.id);
      return `
        <div class="context-playlist-item" data-plid="${pl.id}">
          <img src="${pl.art}" alt="${escapeHtml(pl.name)}" ${IMG_FALLBACK}>
          <div style="flex: 1; overflow: hidden;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-high); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(pl.name)}</div>
            <div style="font-size: 11px; color: var(--text-medium);">${pl.tracks?.length || 0} songs ${alreadyIn ? '• In playlist' : ''}</div>
          </div>
          <span class="material-symbols-outlined" style="color: ${alreadyIn ? 'var(--text-medium)' : 'var(--primary)'}; font-size: 20px;">
            ${alreadyIn ? 'check_circle' : 'add_circle'}
          </span>
        </div>
      `;
    }).join('');
  }

  modal.innerHTML = `
    <div class="song-context-dialog">
      <div class="context-dialog-header">
        <img class="context-track-art" src="${art}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
        <div style="flex: 1; min-width: 0;">
          <h4 style="font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(track.name)}</h4>
          <p style="font-size: 12px; color: var(--text-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(artist)}</p>
        </div>
        <button class="icon-btn" id="closeContextModalBtn" title="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="context-actions-group">
        <!-- Like / Unlike -->
        <div class="context-action-row" id="contextToggleLikeBtn">
          <span class="material-symbols-outlined" style="color: ${isLiked ? '#ff4081' : 'var(--text-high)'}; ${isLiked ? "font-variation-settings: 'FILL' 1;" : ''}">
            ${isLiked ? 'favorite' : 'favorite_border'}
          </span>
          <div class="context-action-text">
            <span>${isLiked ? 'Unlike Song' : 'Like Song'}</span>
            <span class="context-action-sub">${isLiked ? 'Remove from your Liked Songs' : 'Save to your Liked Songs'}</span>
          </div>
        </div>

        <!-- Play Next -->
        <div class="context-action-row" id="contextPlayNextBtn">
          <span class="material-symbols-outlined" style="color: var(--primary);">playlist_play</span>
          <div class="context-action-text">
            <span>Play Next</span>
            <span class="context-action-sub">Play immediately after current track</span>
          </div>
        </div>

        <!-- Add to Queue -->
        <div class="context-action-row" id="contextAddToQueueBtn">
          <span class="material-symbols-outlined" style="color: var(--text-high);">queue_music</span>
          <div class="context-action-text">
            <span>Add to Queue</span>
            <span class="context-action-sub">Append to upcoming queue</span>
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 14px; margin-bottom: 8px;">
        <span style="font-size: 12px; font-weight: 700; color: var(--text-medium); text-transform: uppercase; letter-spacing: 0.05em;">Add to Playlist</span>
        <button class="context-create-pl-link" id="contextCreatePlaylistBtn">
          <span class="material-symbols-outlined" style="font-size: 16px;">add</span>
          New Playlist
        </button>
      </div>

      <div class="context-playlists-list">
        ${playlistsHtml}
      </div>
    </div>
  `;

  modal.classList.add('open');

  // Close handlers
  const closeBtn = modal.querySelector('#closeContextModalBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('open');
  };

  // 1. Like / Unlike toggle
  const likeAction = modal.querySelector('#contextToggleLikeBtn');
  if (likeAction) {
    likeAction.addEventListener('click', () => {
      const nowLiked = state.toggleLike(track);
      modal.classList.remove('open');
      showToast(nowLiked ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
      updateLikedSongsView();

      // Sync active track row like buttons
      document.querySelectorAll(`.track-row[data-id="${track.id}"] .like-btn`).forEach(btn => {
        btn.classList.toggle('is-liked', nowLiked);
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = nowLiked ? "'FILL' 1" : "'FILL' 0";
      });

      // Sync player like button if currently playing
      if (state.currentTrack && state.currentTrack.id === track.id) {
        const playerLike = document.getElementById('playerLikeBtn');
        if (playerLike) {
          playerLike.classList.toggle('is-liked', nowLiked);
          const pIcon = playerLike.querySelector('.material-symbols-outlined');
          if (pIcon) pIcon.style.fontVariationSettings = nowLiked ? "'FILL' 1" : "'FILL' 0";
        }
      }
    });
  }

  // 2. Play Next
  const playNextAction = modal.querySelector('#contextPlayNextBtn');
  if (playNextAction) {
    playNextAction.addEventListener('click', () => {
      state.queue.unshift(track);
      renderQueue();
      modal.classList.remove('open');
      showToast(`"${track.name}" will play next`);
    });
  }

  // 3. Add to Queue
  const queueAction = modal.querySelector('#contextAddToQueueBtn');
  if (queueAction) {
    queueAction.addEventListener('click', () => {
      state.queue.push(track);
      renderQueue();
      modal.classList.remove('open');
      showToast(`Added "${track.name}" to queue`);
    });
  }

  // 4. Create New Playlist button from context menu
  const triggerNewPlaylist = () => {
    modal.classList.remove('open');
    state.pendingTrackForNewPlaylist = track;
    const plModal = document.getElementById('newPlaylistModal');
    const plInput = document.getElementById('newPlaylistNameInput');
    if (plModal) {
      plModal.classList.add('open');
      if (plInput) {
        plInput.value = '';
        plInput.focus();
      }
    }
  };

  const createPlBtn = modal.querySelector('#contextCreatePlaylistBtn');
  if (createPlBtn) createPlBtn.addEventListener('click', triggerNewPlaylist);

  const promptCreatePlBtn = modal.querySelector('#contextPromptCreatePlBtn');
  if (promptCreatePlBtn) promptCreatePlBtn.addEventListener('click', triggerNewPlaylist);

  // 5. Add to Playlist click items
  modal.querySelectorAll('.context-playlist-item').forEach(item => {
    item.addEventListener('click', () => {
      const plId = item.dataset.plid;
      const success = state.addTrackToPlaylist(plId, track);
      modal.classList.remove('open');
      const pl = state.getPlaylist(plId);
      if (success) {
        showToast(`Added to "${pl.name}"`);
        renderLibraryScreen();
        renderHomeScreen();
      } else {
        showToast(`Already in "${pl.name}"`);
      }
    });
  });
}

/**
 * Dedicated Playlist Detail Modal (Real Container View)
 * Supports both custom user playlists and the system Liked Songs collection.
 */
export function openPlaylistDetailModal(playlistId) {
  let pl = null;
  const isLiked = (playlistId === 'liked' || playlistId === 'liked-songs');

  if (isLiked) {
    pl = {
      id: 'liked',
      name: 'Liked Songs',
      art: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500',
      tracks: state.likedSongs || [],
      isLikedCollection: true
    };
  } else if (typeof playlistId === 'object' && playlistId !== null) {
    pl = playlistId;
  } else {
    pl = state.playlists.find(p => p.id === playlistId || String(p.id) === String(playlistId)) || null;
  }

  if (!pl) {
    console.warn('Playlist not found for ID:', playlistId);
    showToast('Playlist not found');
    return;
  }

  state.selectedPlaylistId = pl.id;

  let modal = document.getElementById('playlistDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'playlistDetailModal';
    modal.className = 'playlist-detail-modal';
    const appContainer = document.getElementById('app-container') || document.body;
    appContainer.appendChild(modal);
  }

  const trackCount = pl.tracks ? pl.tracks.length : 0;
  let playlistArt = DEFAULT_PLAYLIST_IMAGE;
  if (pl.isLikedCollection) {
    playlistArt = (pl.tracks && pl.tracks.length > 0)
      ? getTrackArtwork(pl.tracks[0], '500x500')
      : 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500';
  } else if (pl.tracks && pl.tracks.length > 0 && (!pl.art || pl.art === DEFAULT_PLAYLIST_IMAGE)) {
    playlistArt = getTrackArtwork(pl.tracks[0], '500x500');
  } else if (pl.art) {
    playlistArt = pl.art;
  }

  const headerActionsHtml = pl.isLikedCollection ? `
    <div style="display: flex; align-items: center; gap: 4px;">
      <span class="material-symbols-outlined fill-1" style="font-size: 20px; color: var(--primary);">favorite</span>
    </div>
  ` : `
    <div style="display: flex; align-items: center; gap: 4px;">
      <button class="icon-btn" id="renamePlaylistHeaderBtn" title="Rename Playlist">
        <span class="material-symbols-outlined" style="font-size: 20px;">edit</span>
      </button>
      <button class="icon-btn" id="deletePlaylistBtn" title="Delete Playlist">
        <span class="material-symbols-outlined" style="font-size: 22px; color: #ff5252;">delete</span>
      </button>
    </div>
  `;

  const heroBadge = pl.isLikedCollection ? 'Saved Collection' : 'Custom Playlist';
  const heroSubtitle = pl.isLikedCollection
    ? `${trackCount} ${trackCount === 1 ? 'song' : 'songs'} • Pinned Library`
    : `${trackCount} ${trackCount === 1 ? 'song' : 'songs'} • Created by you`;

  const heroNameHtml = pl.isLikedCollection ? `
    <h2 class="playlist-detail-name" id="playlistDetailHeroName">${escapeHtml(pl.name)}</h2>
  ` : `
    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
      <h2 class="playlist-detail-name" id="playlistDetailHeroName" style="cursor: pointer;" title="Tap to rename">${escapeHtml(pl.name)}</h2>
      <button class="playlist-rename-chip" id="renamePlaylistHeroBtn" title="Rename Playlist">
        <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
        <span>Rename</span>
      </button>
    </div>
  `;

  modal.innerHTML = `
    <div class="playlist-detail-sheet" id="playlistDetailSheet">
      <div class="sheet-grab-handle" id="playlistGrabHandle" title="Tap to close"></div>

      <div class="playlist-detail-header">
        <button class="icon-btn" id="closePlaylistDetailBtn" title="Back">
          <span class="material-symbols-outlined" style="font-size: 26px;">arrow_back</span>
        </button>
        <span class="playlist-detail-nav-title" id="playlistDetailNavTitle">${escapeHtml(pl.name)}</span>
        ${headerActionsHtml}
      </div>

      <div class="playlist-detail-hero">
        <div class="playlist-detail-cover-wrapper">
          <img class="playlist-detail-cover" id="playlistDetailCoverImg" src="${playlistArt}" alt="${escapeHtml(pl.name)}" ${IMG_FALLBACK}>
        </div>
        <div class="playlist-detail-meta">
          <span class="playlist-detail-badge">${heroBadge}</span>
          ${heroNameHtml}
          <p class="playlist-detail-stats" id="playlistDetailStats">${heroSubtitle}</p>
        </div>
        <div class="playlist-detail-actions">
          <button class="playlist-play-all-btn" id="playlistPlayAllBtn">
            <span class="material-symbols-outlined fill-1" style="font-size: 22px;">play_arrow</span>
            <span>Play All</span>
          </button>
          <button class="playlist-secondary-btn" id="playlistAddMoreBtn" title="Find Songs">
            <span class="material-symbols-outlined" style="font-size: 18px;">${pl.isLikedCollection ? 'search' : 'add'}</span>
            <span>${pl.isLikedCollection ? 'Find Music' : 'Add Songs'}</span>
          </button>
        </div>
      </div>

      <!-- Quick Inline Song Search & Add Drawer -->
      <div class="playlist-song-finder" id="playlistSongFinder" style="display: none;">
        <div class="playlist-finder-header">
          <span style="font-size: 13px; font-weight: 700; color: var(--text-high);">${pl.isLikedCollection ? 'Find & Save Songs' : 'Find & Add Songs'}</span>
          <button class="icon-btn" id="closePlaylistFinderBtn" style="width: 28px; height: 28px;">
            <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
          </button>
        </div>
        <div class="playlist-finder-input-box">
          <span class="material-symbols-outlined">search</span>
          <input type="text" id="playlistFinderInput" placeholder="Search songs, artists, or movies..." autocomplete="off">
        </div>
        <div class="playlist-finder-results" id="playlistFinderResults">
          <!-- Live results populated by search -->
        </div>
      </div>

      <div class="playlist-detail-content">
        <div class="playlist-songs-header">
          <span class="playlist-songs-count" id="playlistSongsCount">Tracks (${trackCount})</span>
        </div>
        <div class="track-list" id="playlistDetailTrackList">
          <!-- Rendered Below -->
        </div>
        <div class="scroll-bottom-spacer" style="height: 140px;"></div>
      </div>
    </div>
  `;

  modal.classList.add('open');

  // Background click acts as back button (with mobile touch guard to prevent instant closing)
  const modalOpenedTime = Date.now();
  modal.onclick = (e) => {
    if (Date.now() - modalOpenedTime < 250) return;
    if (e.target === modal || e.target.id === 'playlistGrabHandle') {
      modal.classList.remove('open');
    }
  };

  // Back button in header
  const backBtn = modal.querySelector('#closePlaylistDetailBtn');
  if (backBtn) {
    backBtn.onclick = (e) => {
      e.stopPropagation();
      modal.classList.remove('open');
    };
  }

  // Grab handle click closes modal
  const grabHandle = modal.querySelector('#playlistGrabHandle');
  if (grabHandle) {
    grabHandle.onclick = (e) => {
      e.stopPropagation();
      modal.classList.remove('open');
    };
  }

  // Rename playlist wireup
  if (!pl.isLikedCollection) {
    const triggerRename = (e) => {
      if (e) e.stopPropagation();
      state.targetPlaylistForRename = pl.id;
      const renameModal = document.getElementById('renamePlaylistModal');
      const renameInput = document.getElementById('renamePlaylistNameInput');
      if (renameModal && renameInput) {
        renameInput.value = pl.name;
        renameModal.classList.add('open');
        setTimeout(() => {
          renameInput.focus();
          renameInput.select();
        }, 80);
      }
    };

    const renameHeaderBtn = modal.querySelector('#renamePlaylistHeaderBtn');
    const renameHeroBtn = modal.querySelector('#renamePlaylistHeroBtn');
    const renameHeroTitle = modal.querySelector('#playlistDetailHeroName');
    if (renameHeaderBtn) renameHeaderBtn.onclick = triggerRename;
    if (renameHeroBtn) renameHeroBtn.onclick = triggerRename;
    if (renameHeroTitle) renameHeroTitle.onclick = triggerRename;

    // Delete playlist button
    const deleteBtn = modal.querySelector('#deletePlaylistBtn');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        if (confirm(`Delete playlist "${pl.name}"?`)) {
          state.deletePlaylist(pl.id);
          modal.classList.remove('open');
          renderLibraryScreen();
          renderHomeScreen();
          showToast('Playlist deleted');
        }
      };
    }
  }

  // Play All button
  const playAllBtn = modal.querySelector('#playlistPlayAllBtn');
  if (playAllBtn) {
    playAllBtn.onclick = () => {
      const tracksToPlay = pl.isLikedCollection ? state.likedSongs : pl.tracks;
      if (tracksToPlay && tracksToPlay.length > 0) {
        state.queue = [...tracksToPlay.slice(1)];
        engine.loadAndPlay(tracksToPlay[0]);
        engine.resolveUpcomingQueue();
        showToast(`Playing "${pl.name}"`);
      } else {
        showToast(pl.isLikedCollection ? 'No liked songs to play.' : 'Playlist is empty. Add songs using "Add Songs".');
      }
    };
  }

  // Inline Song Finder Toggle
  const addMoreBtn = modal.querySelector('#playlistAddMoreBtn');
  const songFinder = modal.querySelector('#playlistSongFinder');
  const finderInput = modal.querySelector('#playlistFinderInput');
  const finderResults = modal.querySelector('#playlistFinderResults');
  const closeFinderBtn = modal.querySelector('#closePlaylistFinderBtn');

  if (addMoreBtn && songFinder) {
    addMoreBtn.onclick = () => {
      const isHidden = songFinder.style.display === 'none';
      songFinder.style.display = isHidden ? 'block' : 'none';
      if (isHidden && finderInput) {
        finderInput.focus();
        if (!finderInput.value.trim()) {
          searchSongs('Trending Tamil').then(tracks => renderFinderResults(tracks)).catch(() => {});
        }
      }
    };
  }

  if (closeFinderBtn && songFinder) {
    closeFinderBtn.onclick = () => {
      songFinder.style.display = 'none';
    };
  }

  // Finder search typing
  let finderDebounce = null;
  if (finderInput) {
    finderInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(finderDebounce);
      if (!q) {
        finderResults.innerHTML = '';
        return;
      }
      finderDebounce = setTimeout(async () => {
        try {
          const results = await searchSongs(q);
          renderFinderResults(results);
        } catch (err) {
          console.error(err);
        }
      }, 250);
    });
  }

  function renderFinderResults(results) {
    if (!finderResults) return;
    if (!results || results.length === 0) {
      finderResults.innerHTML = '<p style="font-size: 12px; color: var(--text-medium); padding: 8px 0; text-align: center;">No songs found</p>';
      return;
    }
    finderResults.innerHTML = '';
    const currentTracks = pl.isLikedCollection ? state.likedSongs : pl.tracks;

    results.slice(0, 8).forEach(track => {
      const alreadyIn = currentTracks && currentTracks.some(t => t.id === track.id);
      const row = document.createElement('div');
      row.className = 'finder-track-row';
      const artwork = getTrackArtwork(track, '150x150');
      const artist = getTrackArtist(track);

      row.innerHTML = `
        <div class="finder-track-left">
          <img class="finder-track-art" src="${artwork}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
          <div class="finder-track-meta">
            <span class="finder-track-title">${escapeHtml(track.name)}</span>
            <span class="finder-track-artist">${escapeHtml(artist)}</span>
          </div>
        </div>
        <button class="finder-add-btn ${alreadyIn ? 'added' : ''}">
          <span class="material-symbols-outlined" style="font-size: 15px;">${alreadyIn ? 'check' : 'add'}</span>
          <span>${alreadyIn ? 'Added' : 'Add'}</span>
        </button>
      `;

      const addBtn = row.querySelector('.finder-add-btn');
      addBtn.onclick = () => {
        if (pl.isLikedCollection) {
          state.toggleLike(track);
          addBtn.classList.add('added');
          addBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 15px;">check</span><span>Added</span>';
          renderPlaylistTracksList();
          renderLibraryScreen();
          showToast(`Saved "${track.name}" to Liked Songs`);
        } else {
          if (state.addTrackToPlaylist(pl.id, track)) {
            addBtn.classList.add('added');
            addBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 15px;">check</span><span>Added</span>';
            renderPlaylistTracksList();
            renderLibraryScreen();
            showToast(`Added "${track.name}" to "${pl.name}"`);
          }
        }
      };

      finderResults.appendChild(row);
    });
  }

  // Render tracks list function
  function renderPlaylistTracksList() {
    const trackListContainer = modal.querySelector('#playlistDetailTrackList');
    const statsEl = modal.querySelector('#playlistDetailStats');
    const countEl = modal.querySelector('#playlistSongsCount');
    const coverEl = modal.querySelector('#playlistDetailCoverImg');

    const tracksList = pl.isLikedCollection ? (state.likedSongs || []) : (pl.tracks || []);
    const curCount = tracksList.length;

    if (statsEl) {
      statsEl.textContent = pl.isLikedCollection
        ? `${curCount} ${curCount === 1 ? 'song' : 'songs'} • Pinned Library`
        : `${curCount} ${curCount === 1 ? 'song' : 'songs'} • Created by you`;
    }
    if (countEl) countEl.textContent = `Tracks (${curCount})`;

    if (curCount > 0 && coverEl && tracksList[0]) {
      coverEl.src = getTrackArtwork(tracksList[0], '500x500');
    }

    if (!trackListContainer) return;

    if (curCount === 0) {
      trackListContainer.innerHTML = `
        <div class="playlist-empty-state">
          <div class="playlist-empty-icon">
            <span class="material-symbols-outlined">${pl.isLikedCollection ? 'favorite_border' : 'queue_music'}</span>
          </div>
          <h4 class="playlist-empty-title">${pl.isLikedCollection ? 'No liked songs yet' : 'This playlist is empty'}</h4>
          <p class="playlist-empty-desc">${pl.isLikedCollection ? 'Tap the heart icon on any song while listening to save it here.' : `Tap "Add Songs" above to search and add music to "${escapeHtml(pl.name)}".`}</p>
        </div>
      `;
    } else {
      trackListContainer.innerHTML = '';
      tracksList.forEach((track, idx) => {
        const row = document.createElement('div');
        row.className = 'track-row playlist-track-row';
        row.dataset.id = track.id;
        if (state.currentTrack && state.currentTrack.id === track.id) {
          row.classList.add('is-active');
        }

        const artwork = getTrackArtwork(track, '150x150');
        const artist = getTrackArtist(track);
        const isLikedTrack = state.isLiked(track.id);

        row.innerHTML = `
          <div class="track-left">
            <span class="track-index">${idx + 1}</span>
            <div class="track-thumb-wrapper">
              <img class="track-thumb" src="${artwork}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
              <div class="track-hover-overlay">
                <span class="material-symbols-outlined" style="color: var(--primary); font-size: 20px;">play_arrow</span>
              </div>
            </div>
            <div class="track-info">
              <span class="track-title">${escapeHtml(track.name)}</span>
              <span class="track-subtitle">${escapeHtml(artist)}</span>
            </div>
          </div>
          <div class="track-right">
            <button class="icon-btn like-btn ${isLikedTrack ? 'is-liked' : ''}" title="Favorite">
              <span class="material-symbols-outlined" style="font-size: 20px; ${isLikedTrack ? "font-variation-settings: 'FILL' 1;" : ''}">favorite</span>
            </button>
            <button class="icon-btn playlist-remove-btn" title="${pl.isLikedCollection ? 'Remove from liked' : 'Remove from playlist'}">
              <span class="material-symbols-outlined" style="font-size: 20px;">${pl.isLikedCollection ? 'heart_broken' : 'delete_outline'}</span>
            </button>
          </div>
        `;

        // Play song on row click
        row.onclick = (e) => {
          if (e.target.closest('.icon-btn')) return;
          const remaining = tracksList.slice(idx + 1);
          state.queue = [...remaining];
          engine.loadAndPlay(track);
          engine.resolveUpcomingQueue();
        };

        // Like toggle
        const likeBtn = row.querySelector('.like-btn');
        likeBtn.onclick = (e) => {
          e.stopPropagation();
          const liked = state.toggleLike(track);
          likeBtn.classList.toggle('is-liked', liked);
          const icon = likeBtn.querySelector('.material-symbols-outlined');
          if (icon) {
            icon.style.fontVariationSettings = liked ? "'FILL' 1" : "'FILL' 0";
          }
          showToast(liked ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
          if (pl.isLikedCollection) {
            renderPlaylistTracksList();
          }
          updateLikedSongsView();
        };

        // Remove from playlist
        const removeBtn = row.querySelector('.playlist-remove-btn');
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          if (pl.isLikedCollection) {
            state.toggleLike(track);
            renderPlaylistTracksList();
            updateLikedSongsView();
            renderLibraryScreen();
            showToast(`Removed "${track.name}" from Liked Songs`);
          } else {
            state.removeTrackFromPlaylist(pl.id, track.id);
            renderPlaylistTracksList();
            renderLibraryScreen();
            showToast(`Removed from "${pl.name}"`);
          }
        };

        trackListContainer.appendChild(row);
      });
    }
  }

  // Initial render of playlist tracks
  renderPlaylistTracksList();
}

/**
 * PART 3: Dynamic Spotify & One UI Style Home Screen Rendering
 */

/**
 * Render "Jump Back In" section:
 * 1. Dedicated Liked Songs card (#1) with gradient heart icon, title, count subtitle, play all button.
 * 2. Real custom playlists strictly from localStorage (state.playlists).
 * 3. Dynamic fill from state.history and "+ Create Playlist" prompt card.
 * Zero hardcoded or static showcase cards!
 */
export function renderJumpBackInGrid() {
  const quickPlayGrid = document.getElementById('quickPlayGrid');
  if (!quickPlayGrid) return;

  quickPlayGrid.innerHTML = '';

  // 1. Dedicated "Liked Songs" Card (Slot #1)
  const likedCount = state.likedSongs.length;
  const likedCard = document.createElement('div');
  likedCard.className = 'quick-play-card';
  likedCard.innerHTML = `
    <div class="quick-play-thumb-gradient">
      <span class="material-symbols-outlined fill-1">favorite</span>
    </div>
    <div class="quick-play-info">
      <div class="quick-play-meta">
        <span class="quick-play-name">Liked Songs</span>
        <span class="quick-play-subtitle">${likedCount} ${likedCount === 1 ? 'song' : 'songs'}</span>
      </div>
      <button class="quick-play-btn" title="Play Liked Songs">
        <span class="material-symbols-outlined">play_arrow</span>
      </button>
    </div>
  `;

  likedCard.addEventListener('click', (e) => {
    if (e.target.closest('.quick-play-btn')) {
      e.stopPropagation();
      if (state.likedSongs.length > 0) {
        state.queue = [...state.likedSongs.slice(1)];
        engine.loadAndPlay(state.likedSongs[0]);
        engine.resolveUpcomingQueue();
        showToast('Playing Liked Songs');
      } else {
        showToast('No liked songs yet');
      }
      return;
    }
    e.stopPropagation();
    openPlaylistDetailModal('liked');
  });

  quickPlayGrid.appendChild(likedCard);

  // 2. Real Custom Playlists strictly from localStorage (state.playlists)
  const userPlaylists = state.playlists || [];
  userPlaylists.slice(0, 5).forEach(pl => {
    const plCard = document.createElement('div');
    plCard.className = 'quick-play-card';
    const plTracksCount = pl.tracks ? pl.tracks.length : 0;
    const plArt = (pl.tracks && pl.tracks.length > 0 && (!pl.art || pl.art === DEFAULT_PLAYLIST_IMAGE))
      ? getTrackArtwork(pl.tracks[0], '500x500')
      : (pl.art || DEFAULT_PLAYLIST_IMAGE);

    plCard.innerHTML = `
      <img class="quick-play-thumb" src="${plArt}" alt="${escapeHtml(pl.name)}" ${IMG_FALLBACK}>
      <div class="quick-play-info">
        <div class="quick-play-meta">
          <span class="quick-play-name">${escapeHtml(pl.name)}</span>
          <span class="quick-play-subtitle">${plTracksCount} ${plTracksCount === 1 ? 'song' : 'songs'}</span>
        </div>
        <button class="quick-play-btn" title="Play Playlist">
          <span class="material-symbols-outlined">play_arrow</span>
        </button>
      </div>
    `;

    plCard.addEventListener('click', (e) => {
      if (e.target.closest('.quick-play-btn')) {
        e.stopPropagation();
        if (pl.tracks && pl.tracks.length > 0) {
          state.queue = [...pl.tracks.slice(1)];
          engine.loadAndPlay(pl.tracks[0]);
          engine.resolveUpcomingQueue();
          showToast(`Playing "${pl.name}"`);
        } else {
          showToast(`Playlist "${pl.name}" is empty`);
        }
        return;
      }
      e.stopPropagation();
      openPlaylistDetailModal(pl.id);
    });

    quickPlayGrid.appendChild(plCard);
  });

  // 3. If user has created fewer than 5 playlists, dynamically fill remaining slots with recently played tracks from state.history or + Create Playlist
  if (userPlaylists.length < 5) {
    const addedHistoryIds = new Set();
    const historyList = state.history || [];

    // Add recent history tracks up to 5 cards (leaving room for + Create Playlist prompt)
    for (const track of historyList) {
      if (quickPlayGrid.children.length >= 5) break;
      if (!addedHistoryIds.has(track.id)) {
        addedHistoryIds.add(track.id);
        const histCard = document.createElement('div');
        histCard.className = 'quick-play-card';
        histCard.innerHTML = `
          <img class="quick-play-thumb" src="${getTrackArtwork(track, '150x150')}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
          <div class="quick-play-info">
            <div class="quick-play-meta">
              <span class="quick-play-name">${escapeHtml(track.name)}</span>
              <span class="quick-play-subtitle">${escapeHtml(getTrackArtist(track))}</span>
            </div>
            <button class="quick-play-btn" title="Play">
              <span class="material-symbols-outlined">play_arrow</span>
            </button>
          </div>
        `;
        histCard.addEventListener('click', () => {
          engine.loadAndPlay(track);
        });
        quickPlayGrid.appendChild(histCard);
      }
    }

    // Include clean "+ Create Playlist" prompt card
    if (quickPlayGrid.children.length < 6) {
      const createCard = document.createElement('div');
      createCard.className = 'quick-play-card';
      createCard.innerHTML = `
        <div class="quick-play-thumb-create">
          <span class="material-symbols-outlined" style="font-size: 26px;">add</span>
        </div>
        <div class="quick-play-info">
          <div class="quick-play-meta">
            <span class="quick-play-name">+ Create Playlist</span>
            <span class="quick-play-subtitle">Make custom mix</span>
          </div>
          <button class="quick-play-btn" title="Create Playlist" style="background: var(--surface-3); color: var(--primary);">
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>
      `;

      createCard.addEventListener('click', () => {
        const modal = document.getElementById('newPlaylistModal');
        const input = document.getElementById('newPlaylistNameInput');
        if (modal) {
          modal.classList.add('open');
          if (input) {
            input.value = '';
            input.focus();
          }
        }
      });

      quickPlayGrid.appendChild(createCard);
    }

    // If still under 6 slots, continue filling with remaining history tracks
    for (const track of historyList) {
      if (quickPlayGrid.children.length >= 6) break;
      if (!addedHistoryIds.has(track.id)) {
        addedHistoryIds.add(track.id);
        const histCard = document.createElement('div');
        histCard.className = 'quick-play-card';
        histCard.innerHTML = `
          <img class="quick-play-thumb" src="${getTrackArtwork(track, '150x150')}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
          <div class="quick-play-info">
            <div class="quick-play-meta">
              <span class="quick-play-name">${escapeHtml(track.name)}</span>
              <span class="quick-play-subtitle">${escapeHtml(getTrackArtist(track))}</span>
            </div>
            <button class="quick-play-btn" title="Play">
              <span class="material-symbols-outlined">play_arrow</span>
            </button>
          </div>
        `;
        histCard.addEventListener('click', () => {
          engine.loadAndPlay(track);
        });
        quickPlayGrid.appendChild(histCard);
      }
    }
  }
}

/**
 * Render dynamic "Tamil Hits & New Releases" horizontal rail
 * Strictly original soundtrack songs from recent blockbuster movies (Amaran, Vettaiyan, GOAT, Leo, Jailer, Raayan, Devara)
 * Zero DJ remixes, zero audio cuts, zero gym workout tracks!
 */
export async function renderTamilReleasesRail() {
  const releasesRail = document.getElementById('releasesRail');
  if (!releasesRail) return;

  // Render curated blockbuster tracks immediately
  releasesRail.innerHTML = '';
  CURATED_TAMIL_RELEASES.forEach((track, idx) => {
    releasesRail.appendChild(createRailCard(track, CURATED_TAMIL_RELEASES, idx));
  });

  // Background enhancement: fetch fresh recent movie songs and append if missing
  try {
    const freshHits = await fetchCategorySongs('Amaran Tamil Vettaiyan Leo', 15);
    const existingIds = new Set(CURATED_TAMIL_RELEASES.map(t => t.id));
    for (const t of freshHits) {
      if (!existingIds.has(t.id) && isCleanOriginalSong(t)) {
        existingIds.add(t.id);
        releasesRail.appendChild(createRailCard(t, freshHits));
      }
    }
  } catch (err) {
    console.warn('Background Tamil releases refresh:', err);
  }
}

/**
 * Fetch and assemble curated tracks with strict content purity per category
 */
export async function fetchCuratedRailTracks(railConfig) {
  // 1. A.R. Rahman Specials: strictly return his verified discography (27+ tracks)
  if (railConfig.type === 'rahman' || railConfig.id === 'section-ar-rahman') {
    return CURATED_RAHMAN_TRACKS;
  }

  // 2. Sai Abhyankkar Specials: strictly return his verified viral discography
  if (railConfig.type === 'sai' || railConfig.id === 'section-sai') {
    return CURATED_SAI_TRACKS;
  }

  // 3. Category rail queries (Thalapathy Vijay, Anirudh Beats, etc.)
  let songs = [];
  try {
    const rawSongs = await fetchCategorySongs(railConfig.query, 25);
    songs = (rawSongs || []).filter(t => isCleanOriginalSong(t));
  } catch (e) {
    console.warn(`Category fetch error for ${railConfig.title}:`, e);
  }

  // Minimum 15 songs guarantee for artist rails without injecting irrelevant songs
  if (!songs || songs.length < 15) {
    try {
      const fallbackQuery = (railConfig.type === 'vijay' || railConfig.id.includes('vijay')) 
        ? 'Vijay Tamil Master Leo Varisu' 
        : 'Anirudh Ravichander Blockbusters';
      const fallbackSongs = await fetchCategorySongs(fallbackQuery, 20);
      const existingIds = new Set((songs || []).map(s => s.id));
      songs = songs || [];
      for (const t of fallbackSongs) {
        if (!existingIds.has(t.id) && isCleanOriginalSong(t)) {
          songs.push(t);
          existingIds.add(t.id);
          if (songs.length >= 20) break;
        }
      }
    } catch (err) {
      console.warn('Fallback query error:', err);
    }
  }

  return songs || [];
}

/**
 * Render dynamic horizontal rails (🌟 Sai Abhyankkar Specials, Thalapathy Vijay Hits, Anirudh Beats, Global English Hits)
 */
export async function renderDynamicHomeRails() {
  // Wire all See All action buttons
  document.querySelectorAll('.home-section .section-action[data-query]').forEach(btn => {
    btn.onclick = () => {
      const q = btn.dataset.query;
      const searchInput = document.getElementById('globalSearchInput');
      if (searchInput && q) {
        searchInput.value = q;
        switchTab('search');
        triggerLiveSearch(q);
      }
    };
  });

  // Populate each curated rail directly into its container
  for (const railConfig of CURATED_RAILS) {
    const railEl = document.getElementById(railConfig.railId) || document.getElementById(`${railConfig.id}-rail`);
    if (!railEl) continue;

    // Show skeletons while fetching if empty
    if (railEl.children.length === 0) {
      railEl.innerHTML = `
        <div style="display: flex; gap: 12px; padding: 4px 0;">
          <div class="rail-skeleton"></div>
          <div class="rail-skeleton"></div>
          <div class="rail-skeleton"></div>
          <div class="rail-skeleton"></div>
        </div>
      `;
    }

    fetchCuratedRailTracks(railConfig).then(songs => {
      if (!songs || songs.length === 0) return;
      railEl.innerHTML = '';
      songs.forEach((track, idx) => {
        railEl.appendChild(createRailCard(track, songs, idx));
      });
    }).catch(err => {
      console.warn(`Failed to render category rail: ${railConfig.title}`, err);
    });
  }
}

/**
 * Render "Continue Listening" section based on state.history
 */
export function renderContinueListeningSection() {
  let section = document.getElementById('continueListeningSection');
  const homeView = document.getElementById('home-view');
  if (!homeView) return;

  if (state.history.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (!section) {
    section = document.createElement('section');
    section.id = 'continueListeningSection';
    section.className = 'home-section';
    const quickSection = document.querySelector('#quickPlayGrid')?.closest('.home-section');
    if (quickSection && quickSection.nextSibling) {
      homeView.insertBefore(section, quickSection.nextSibling);
    } else {
      homeView.prepend(section);
    }
  }

  section.style.display = 'block';
  section.innerHTML = `
    <div class="section-header">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="material-symbols-outlined" style="color: var(--primary); font-size: 20px;">history</span>
        <h3 class="section-title">Continue Listening</h3>
      </div>
      <span class="section-subtitle">${state.history.length} recent tracks</span>
    </div>
    <div class="horizontal-rail" id="continueListeningRail"></div>
  `;

  const rail = section.querySelector('#continueListeningRail');
  state.history.slice(0, 10).forEach(track => {
    rail.appendChild(createRailCard(track));
  });
}

export async function renderHomeScreen() {
  const homeView = document.getElementById('home-view');
  if (!homeView) return;

  // 1. "Jump Back In" (Dynamic Playlists, Liked Songs, History)
  renderJumpBackInGrid();

  // 2. "Continue Listening" (Recent History Rail)
  renderContinueListeningSection();

  // 3. Dynamic Tamil Hits & New Releases (Live API, >= 15 tracks)
  renderTamilReleasesRail();

  // 4. Dynamic Curated Rails (Sai Abhyankkar Specials, Thalapathy Vijay Hits, Anirudh Beats, English Hits)
  renderDynamicHomeRails();

  // 5. Dynamic Trending Now list from API
  const trendingList = document.getElementById('homeTrendingList');
  if (trendingList && trendingList.children.length === 0) {
    fetchCategorySongs('Tamil Hits', 12).then(tracks => {
      if (tracks && tracks.length > 0) {
        trendingList.innerHTML = '';
        tracks.forEach(t => trendingList.appendChild(createTrackRowElement(t)));
      }
    }).catch(() => {});
  }
}

export function createRailCard(track, railSongs = null, idx = 0) {
  const card = document.createElement('div');
  card.className = 'rail-card';
  card.innerHTML = `
    <div class="rail-card-art">
      <img src="${getTrackArtwork(track, '500x500')}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
      <button class="rail-card-play" title="Play">
        <span class="material-symbols-outlined" style="font-size: 22px;">play_arrow</span>
      </button>
    </div>
    <div class="rail-card-meta">
      <div class="rail-card-title-row">
        <span class="rail-card-title" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</span>
        <button class="icon-btn rail-card-menu-btn" title="Options">
          <span class="material-symbols-outlined" style="font-size: 18px;">more_vert</span>
        </button>
      </div>
      <span class="rail-card-subtitle">${escapeHtml(getTrackArtist(track))}</span>
    </div>
  `;

  // Row click -> Play track and queue remaining tracks in rail
  card.addEventListener('click', (e) => {
    if (e.target.closest('.rail-card-menu-btn')) return;
    if (railSongs && Array.isArray(railSongs)) {
      state.queue = [...railSongs.slice(idx + 1)];
    }
    engine.loadAndPlay(track);
    engine.resolveUpcomingQueue();
  });

  // 3-dot menu button
  const menuBtn = card.querySelector('.rail-card-menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSongContextMenu(track);
    });
  }

  return card;
}

/**
 * Render Queue Drawer
 */
export function renderQueue() {
  const queueList = document.getElementById('queueList');
  const queueCountBadge = document.getElementById('queueCountBadge');
  const queueSummarySubtitle = document.getElementById('queueSummarySubtitle');

  if (!queueList) return;

  const count = state.queue.length;
  if (queueCountBadge) queueCountBadge.textContent = count;
  if (queueSummarySubtitle) queueSummarySubtitle.textContent = `${count} Tracks • Autoplay Ready`;

  if (count === 0) {
    queueList.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-medium);">
        <span class="material-symbols-outlined" style="font-size: 40px; color: var(--surface-4); margin-bottom: 8px;">queue_music</span>
        <p style="font-size: 14px; font-weight: 600; color: var(--text-high);">Queue is empty</p>
        <p style="font-size: 12px; margin-top: 4px;">Autoplay is active and will discover new tracks automatically.</p>
      </div>
    `;
    return;
  }

  queueList.innerHTML = '';
  state.queue.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'queue-row';
    const artwork = getTrackArtwork(track, '150x150');
    const artist = getTrackArtist(track);

    row.innerHTML = `
      <div class="track-left">
        <span class="material-symbols-outlined queue-drag-handle">drag_indicator</span>
        <div class="track-thumb-wrapper" style="width: 42px; height: 42px;">
          <img class="track-thumb" src="${artwork}" alt="${escapeHtml(track.name)}" ${IMG_FALLBACK}>
        </div>
        <div class="track-info">
          <span class="track-title">${escapeHtml(track.name)}</span>
          <span class="track-subtitle">${escapeHtml(artist)}</span>
        </div>
      </div>
      <button class="queue-delete-btn" title="Remove from queue">
        <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
      </button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.queue-delete-btn')) return;
      state.queue.splice(index, 1);
      engine.loadAndPlay(track);
    });

    const delBtn = row.querySelector('.queue-delete-btn');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.queue.splice(index, 1);
      renderQueue();
      showToast('Removed from queue');
    });

    queueList.appendChild(row);
  });
}

/**
 * Render Library Screen
 */
export function updateLikedSongsView() {
  const countSubtitle = document.getElementById('likedCountSubtitle');
  const likedSectionCountSubtitle = document.getElementById('likedSectionCountSubtitle');
  const count = state.likedSongs.length;
  if (countSubtitle) {
    countSubtitle.textContent = `${count} songs • Auto-synced offline`;
  }
  if (likedSectionCountSubtitle) {
    likedSectionCountSubtitle.textContent = `${count} ${count === 1 ? 'song' : 'songs'} saved`;
  }

  // Sync Jump Back In grid card subtitle
  renderJumpBackInGrid();

  const likedTracksList = document.getElementById('likedTracksList');
  if (likedTracksList) {
    likedTracksList.innerHTML = '';
    if (count === 0) {
      likedTracksList.innerHTML = `
        <div class="empty-state-card" style="padding: 30px; text-align: center; color: var(--text-medium);">
          <span class="material-symbols-outlined" style="font-size: 38px; color: var(--surface-4);">favorite_border</span>
          <p style="font-size: 14px; font-weight: 600; color: var(--text-high); margin-top: 8px;">No liked songs yet</p>
          <p style="font-size: 12px; margin-top: 4px;">Tap the heart icon on any song to save it here.</p>
        </div>
      `;
    } else {
      state.likedSongs.forEach((track, idx) => {
        likedTracksList.appendChild(createTrackRowElement(track, { trackList: state.likedSongs, index: idx }));
      });
    }
  }
}

export function renderLibraryScreen() {
  updateLikedSongsView();

  // Playlists Container
  const container = document.getElementById('playlistsContainer');
  if (container) {
    container.innerHTML = '';
    if (state.playlists.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 24px 16px; text-align: center; color: var(--text-medium); background: var(--surface-1); border-radius: 12px; border: 1px dashed var(--border-subtle);">
          <span class="material-symbols-outlined" style="font-size: 32px; color: var(--surface-4);">queue_music</span>
          <p style="font-size: 14px; font-weight: 600; color: var(--text-high); margin-top: 6px;">No playlists created yet</p>
          <p style="font-size: 12px; margin-top: 2px;">Tap "+ Playlist" above to start your collection.</p>
        </div>
      `;
    } else {
      state.playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
          <div class="playlist-card-left">
            <img class="playlist-art" src="${pl.art}" alt="${escapeHtml(pl.name)}" ${IMG_FALLBACK}>
            <div class="playlist-details">
              <span class="playlist-title">${escapeHtml(pl.name)}</span>
              <span class="playlist-subtitle">${pl.tracks?.length || 0} tracks • By You</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button class="icon-btn playlist-play-btn" title="Play">
              <span class="material-symbols-outlined" style="font-size: 24px; color: var(--primary);">play_circle</span>
            </button>
          </div>
        `;

        // Explicit play button handler to start playing playlist
        const playBtn = card.querySelector('.playlist-play-btn');
        if (playBtn) {
          playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pl.tracks && pl.tracks.length > 0) {
              state.queue = [...pl.tracks.slice(1)];
              engine.loadAndPlay(pl.tracks[0]);
              showToast(`Playing "${pl.name}"`);
            } else {
              showToast('Playlist is empty. Add songs to play.');
            }
          });
        }

        // Clicking the banner / card opens playlist detail view
        card.addEventListener('click', (e) => {
          if (e.target.closest('.playlist-play-btn')) return;
          e.stopPropagation();
          openPlaylistDetailModal(pl.id);
        });

        container.appendChild(card);
      });
    }
  }
}

/**
 * UI Sync on Playback & Progress Changes
 */
export function updatePlaybackUI() {
  const miniIcon = document.getElementById('miniPlayIcon');
  const giantIcon = document.getElementById('giantPlayIcon');
  const queueEq = document.getElementById('queueEqualizer');

  const iconName = state.isPlaying ? 'pause' : 'play_arrow';
  if (miniIcon) miniIcon.textContent = iconName;
  if (giantIcon) giantIcon.textContent = iconName;

  if (queueEq) {
    queueEq.style.opacity = state.isPlaying ? '1' : '0.4';
  }

  // Active track row highlight
  document.querySelectorAll('.track-row').forEach(row => {
    const rowId = row.dataset.id;
    if (state.currentTrack && rowId === state.currentTrack.id) {
      row.classList.add('is-active');
    } else {
      row.classList.remove('is-active');
    }
  });
}

export function updateTrackInfoUI(track) {
  if (!track) return;
  const title = track.name || 'Unknown Track';
  const artist = getTrackArtist(track);
  const artUrl = getTrackArtwork(track, '500x500');
  const thumbUrl = getTrackArtwork(track, '150x150');

  // Mini-player elements
  const miniPlayer = document.getElementById('miniPlayer');
  const miniThumb = document.getElementById('miniThumb');
  const miniTitle = document.getElementById('miniTitle');
  const miniArtist = document.getElementById('miniArtist');
  const miniLikeBtn = document.getElementById('miniLikeBtn');

  if (miniPlayer) miniPlayer.classList.add('visible');
  if (miniThumb) miniThumb.src = thumbUrl;
  if (miniTitle) miniTitle.textContent = title;
  if (miniArtist) miniArtist.textContent = artist;

  // Full-screen player elements
  const playerArt = document.getElementById('playerArtwork');
  const playerTitle = document.getElementById('playerTitle');
  const playerArtist = document.getElementById('playerArtist');
  const playerHeartBtn = document.getElementById('playerHeartBtn');
  const queueCurrentThumb = document.getElementById('queueCurrentThumb');
  const queueCurrentTitle = document.getElementById('queueCurrentTitle');
  const queueCurrentArtist = document.getElementById('queueCurrentArtist');

  if (playerArt) playerArt.src = artUrl;
  if (playerTitle) playerTitle.textContent = title;
  if (playerArtist) playerArtist.textContent = artist;
  if (queueCurrentThumb) queueCurrentThumb.src = thumbUrl;
  if (queueCurrentTitle) queueCurrentTitle.textContent = title;
  if (queueCurrentArtist) queueCurrentArtist.textContent = artist;

  // Liked state
  const isLiked = state.isLiked(track.id);
  [miniLikeBtn, playerHeartBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('is-liked', isLiked);
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.style.fontVariationSettings = isLiked ? "'FILL' 1" : "'FILL' 0";
      }
    }
  });

  // Re-render continue listening if history changed
  renderContinueListeningSection();
}

export function updateProgressUI(currentTime, duration) {
  const timeElapsed = document.getElementById('timeElapsed');
  const timeRemaining = document.getElementById('timeRemaining');
  const scrubberFill = document.getElementById('scrubberFill');
  const scrubberThumb = document.getElementById('scrubberThumb');
  const miniProgressFill = document.getElementById('miniProgressFill');

  if (!duration || isNaN(duration)) {
    if (timeElapsed) timeElapsed.textContent = formatTime(currentTime);
    if (timeRemaining) timeRemaining.textContent = '-0:00';
    return;
  }

  const percent = Math.min(Math.max((currentTime / duration) * 100, 0), 100);

  if (scrubberFill) scrubberFill.style.width = `${percent}%`;
  if (scrubberThumb) scrubberThumb.style.left = `${percent}%`;
  if (miniProgressFill) miniProgressFill.style.width = `${percent}%`;

  if (timeElapsed) timeElapsed.textContent = formatTime(currentTime);
  if (timeRemaining) timeRemaining.textContent = '-' + formatTime(duration - currentTime);
}

/**
 * Tab Navigation Switcher
 */
export function switchTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `${tabName}-view`);
  });

  const isSearch = (tabName === 'search');
  const isLibrary = (tabName === 'library');
  const isHome = (tabName === 'home');

  const appContainer = document.getElementById('app-container');
  const filterChipsRail = document.getElementById('filterChipsRail');
  const headerSearchBar = document.getElementById('headerSearchBar');

  if (appContainer) {
    appContainer.classList.toggle('search-mode', isSearch);
    appContainer.classList.toggle('library-mode', isLibrary);
    appContainer.classList.toggle('home-mode', isHome);
  }
  if (filterChipsRail) {
    filterChipsRail.style.display = isSearch ? 'flex' : 'none';
  }
  if (headerSearchBar) {
    headerSearchBar.classList.remove('is-collapsed');
  }

  if (isLibrary) {
    updateLikedSongsView();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Forward reference for search trigger
let liveSearchHandler = null;
export function registerLiveSearchTrigger(fn) {
  liveSearchHandler = fn;
}
export function triggerLiveSearch(query) {
  if (liveSearchHandler) liveSearchHandler(query);
}

/**
 * App Loading Screen Controller
 */
export function hideAppLoading() {
  const loader = document.getElementById('appLoadingScreen');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => {
      loader.style.display = 'none';
    }, 400);
  }
}

export function showAppLoading() {
  const loader = document.getElementById('appLoadingScreen');
  if (loader) {
    loader.style.display = 'flex';
    loader.classList.remove('fade-out');
  }
}

/**
 * Network / Offline Error Screen Controller
 */
export function showAppError(title = 'No Internet Connection', desc = 'Please check your internet connection.') {
  const errorScreen = document.getElementById('appErrorScreen');
  if (errorScreen) {
    const t = errorScreen.querySelector('.error-title');
    const d = errorScreen.querySelector('.error-desc');
    if (t) t.textContent = title;
    if (d) d.textContent = desc;
    errorScreen.style.display = 'flex';
  }
}

export function hideAppError() {
  const errorScreen = document.getElementById('appErrorScreen');
  if (errorScreen) {
    errorScreen.style.display = 'none';
  }
}

// Wire error screen buttons once DOM is available
document.addEventListener('DOMContentLoaded', () => {
  const retryBtn = document.getElementById('errorRetryBtn');
  const libBtn = document.getElementById('errorGoLibraryBtn');

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (navigator.onLine) {
        hideAppError();
        renderHomeScreen();
        renderLibraryScreen();
        showToast('Connected! Reloading music...');
      } else {
        showToast('Still offline. Please check your Wi-Fi or data connection.');
      }
    });
  }

  if (libBtn) {
    libBtn.addEventListener('click', () => {
      hideAppError();
      switchTab('library');
      showToast('Switched to your offline library');
    });
  }
});

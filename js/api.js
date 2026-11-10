/**
 * API Integration Layer
 * Resilient fetcher with primary/fallback routing and in-memory category caching
 */

import { PRIMARY_API, FALLBACK_API, DEFAULT_FALLBACK_IMAGE } from './config.js';

// In-memory cache for category rails and search responses to eliminate repeated network delay
const memoryCache = new Map();

// In-memory cache for direct 320k/160k stream URLs to eliminate zero-latency playback delays
export const streamUrlCache = new Map();

/**
 * Universal resilient API fetcher with strict timeout to prevent mobile background hang
 */
export async function apiFetch(endpoint) {
  // Check memory cache first if applicable
  if (memoryCache.has(endpoint)) {
    return memoryCache.get(endpoint);
  }

  // Attempt Primary API with 10-second timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${PRIMARY_API}${endpoint}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const json = await res.json();
      if (json && (json.success !== false || json.status === 'SUCCESS' || json.data)) {
        memoryCache.set(endpoint, json);
        return json;
      }
    }
  } catch (err) {
    console.warn(`Primary API call failed for ${endpoint}:`, err.message);
  }

  // Fallback API attempt with 3-second timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${FALLBACK_API}${endpoint}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const json = await res.json();
      if (json && (json.success !== false || json.data)) {
        memoryCache.set(endpoint, json);
        return json;
      }
    }
  } catch (fallbackErr) {
    // Silently ignore fallback failure
  }

  return null;
}

/**
 * Search songs with configurable limit
 */
export async function searchSongs(query, limit = 30) {
  if (!query || !query.trim()) return [];
  const endpoint = `/search/songs?query=${encodeURIComponent(query.trim())}&limit=${limit}`;
  const res = await apiFetch(endpoint);
  if (res && res.data && Array.isArray(res.data.results)) {
    // Prime streamUrlCache with any download URLs already returned by search
    res.data.results.forEach(track => {
      if (track && track.id && track.downloadUrl) {
        getBestStreamUrl(track);
      }
    });
    return res.data.results;
  }
  return [];
}

/**
 * Fetch full song details by ID (resolves high-fidelity download URLs)
 */
export async function fetchSongDetails(songId) {
  if (!songId) return null;
  const endpoint = `/songs/${songId}`;
  const res = await apiFetch(endpoint);
  if (res && res.data) {
    const song = Array.isArray(res.data) ? res.data[0] : res.data;
    if (song) {
      getBestStreamUrl(song); // Primes streamUrlCache
    }
    return song;
  }
  return null;
}

/**
 * Autoplay recommendations: queries /songs/{id}/suggestions with smart search fallback
 */
export async function fetchRecommendations(currentTrack) {
  if (!currentTrack || !currentTrack.id) return [];
  let suggestions = [];

  // 1. Try direct suggestions endpoint
  try {
    const res = await apiFetch(`/songs/${currentTrack.id}/suggestions?limit=15`);
    if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
      suggestions = res.data;
    }
  } catch (e) {
    console.warn('Suggestions API error, using artist fallback', e);
  }

  // 2. Fallback: Search by primary artist
  if (!suggestions.length) {
    const artist = getTrackArtist(currentTrack).split(',')[0].trim();
    const query = artist && artist !== 'Unknown Artist' ? artist : 'Top Hits';
    const searchRes = await searchSongs(query, 15);
    if (searchRes.length > 0) {
      suggestions = searchRes.filter(s => s.id !== currentTrack.id);
    }
  }

  return suggestions;
}

/**
 * Fetch lyrics for a song
 */
export async function fetchLyrics(songId) {
  if (!songId) return null;
  try {
    const res = await apiFetch(`/lyrics?id=${songId}`);
    if (res && res.data && res.data.lyrics) {
      return res.data.lyrics;
    }
  } catch (e) {
    console.warn('Lyrics fetch failed', e);
  }
  return null;
}

// Strictly reject audio cuts, DJ remixes, dialogue, ringtones, gym motivational audio, meme edits, techno/dnb/slowed edits
const JUNK_SONG_REGEX = /\b(dj\s*remix|dj\s+[a-z0-9]+|gym\s*motivational|workout|non-?stop|bass\s*boosted|bass\s*boost|dialogue|speech|ringtone|status\s*video|audio\s*cut|teaser|trailer|bgm\s*cut|scene|8d\s*audio|slowed\s*(&|and)?\s*reverb|slowed|nightcore|techno|dnb|drum\s*(&|and)?\s*bass|sped\s*up|speed\s*up|ambient\s*version|16-?bit|8-?bit|emulation|karaoke|instrumental\s*cover|instrumental\s*karaoke|melody\s*karaoke)\b/i;

/**
 * Filter ensuring tracks are authentic full studio songs (Spotify/YT Music standard)
 */
export function isCleanOriginalSong(track, allowRemix = false) {
  if (!track || !track.name) return false;
  const name = track.name.toLowerCase();

  if (!allowRemix) {
    if (JUNK_SONG_REGEX.test(name)) return false;
  }

  // Filter out short audio cuts, dialogues, clips under 75 seconds
  if (track.duration && track.duration < 75) {
    return false;
  }

  return true;
}

/**
 * Fetch songs for a category rail with persistent in-memory caching and quality filtering
 */
export async function fetchCategorySongs(query, limit = 15) {
  const cacheKey = `category_${query}_${limit}`;
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  const results = await searchSongs(query, limit * 2);
  const cleanResults = (results || []).filter(t => isCleanOriginalSong(t)).slice(0, limit);
  if (cleanResults && cleanResults.length > 0) {
    memoryCache.set(cacheKey, cleanResults);
  }
  return cleanResults || [];
}

/**
 * Extract highest available bitrate stream URL (checks streamUrlCache first)
 */
export function getBestStreamUrl(track) {
  if (!track) return null;
  if (track.id && streamUrlCache.has(track.id)) {
    return streamUrlCache.get(track.id);
  }
  if (!track.downloadUrl || !track.downloadUrl.length) return null;
  const priority = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'];
  for (const quality of priority) {
    const match = track.downloadUrl.find(item => item.quality === quality);
    if (match && match.url) {
      if (track.id) streamUrlCache.set(track.id, match.url);
      return match.url;
    }
  }
  const fallbackUrl = track.downloadUrl[track.downloadUrl.length - 1]?.url || null;
  if (fallbackUrl && track.id) {
    streamUrlCache.set(track.id, fallbackUrl);
  }
  return fallbackUrl;
}

/**
 * Extract artwork URL with fallback
 */
export function getTrackArtwork(track, preferredSize = '500x500') {
  if (!track) return DEFAULT_FALLBACK_IMAGE;
  if (typeof track.image === 'string' && track.image.trim()) return track.image;
  if (Array.isArray(track.image) && track.image.length > 0) {
    const match = track.image.find(img => img.quality === preferredSize);
    if (match && match.url) return match.url;
    return track.image[track.image.length - 1]?.url || DEFAULT_FALLBACK_IMAGE;
  }
  return DEFAULT_FALLBACK_IMAGE;
}

/**
 * Normalize artist display string
 */
export function getTrackArtist(track) {
  if (!track) return 'Unknown Artist';
  if (typeof track.artist === 'string' && track.artist.trim()) return track.artist;
  if (track.artists?.primary && Array.isArray(track.artists.primary)) {
    const names = track.artists.primary.map(a => a.name).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  if (track.primaryArtists && typeof track.primaryArtists === 'string') {
    return track.primaryArtists;
  }
  return 'Various Artists';
}

/**
 * Format seconds to M:SS
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

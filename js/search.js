/**
 * Advanced Search Relevance & Query Normalization Engine
 * Resolves typo resilience, stop-word stripping, multi-pass fallback,
 * language filtering, verified catalog priority, and studio quality scoring.
 */

import { searchSongs, getTrackArtist, isCleanOriginalSong } from './api.js';
import {
  CURATED_SAI_TRACKS,
  CURATED_TAMIL_RELEASES,
  CURATED_RAHMAN_TRACKS,
  SHOWCASE_TRACKS
} from './config.js';

// Master library of verified authentic studio tracks (Spotify/YT Music reference)
const MASTER_VERIFIED_TRACKS = [
  ...CURATED_RAHMAN_TRACKS,
  ...CURATED_SAI_TRACKS,
  ...CURATED_TAMIL_RELEASES,
  ...SHOWCASE_TRACKS
];

// Common spaced prefixes / suffixes to collapse
const PREFIX_COLLAPSE_RULES = [
  { pattern: /\bun\s+stoppable\b/gi, replacement: 'unstoppable' },
  { pattern: /\bin\s+destructible\b/gi, replacement: 'indestructible' },
  { pattern: /\bnon\s+stop\b/gi, replacement: 'nonstop' },
  { pattern: /\bre\s+play\b/gi, replacement: 'replay' },
  { pattern: /\bheart\s+beat\b/gi, replacement: 'heartbeat' },
  { pattern: /\bwith\s+out\b/gi, replacement: 'without' },
  { pattern: /\bevery\s+thing\b/gi, replacement: 'everything' },
  { pattern: /\bsome\s+one\b/gi, replacement: 'someone' },
  { pattern: /\bany\s+one\b/gi, replacement: 'anyone' },
  { pattern: /\bcan\s+not\b/gi, replacement: 'cannot' }
];

// Noise words & search stop words for secondary fallback pass
const STOP_WORDS = new Set([
  'i', 'am', 'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'is', 'it', 'for', 'with', 'by', 'at', 'from', 'feat', 'ft',
  'song', 'songs', 'audio', 'track', 'mp3', 'lyrics', 'official', 'video',
  'full', 'hd', 'version'
]);

/**
 * Normalizes query string:
 * 1. Collapses spaced prefixes/suffixes
 * 2. Strips noisy punctuation while keeping alphanumeric and spaces
 * 3. Collapses multiple spaces
 */
export function normalizeQuery(query) {
  if (!query) return '';
  let cleaned = query.trim().toLowerCase();

  // 1. Collapse known broken spaced words
  PREFIX_COLLAPSE_RULES.forEach(rule => {
    cleaned = cleaned.replace(rule.pattern, rule.replacement);
  });

  // Also collapse single-letter prefixes attached with space like 'un - stoppable'
  cleaned = cleaned.replace(/([a-z]{2,})\s*-\s*([a-z]{2,})/gi, '$1$2');

  // 2. Strip noisy punctuation: quotes, braces, brackets, asterisks, etc.
  cleaned = cleaned.replace(/['"“”‘’`~@#$%^&*()_=+{}[\]:;,.<>/?\\|]/g, ' ');

  // 3. Collapse multiple whitespaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Strips stop words for secondary query fallback
 */
export function stripStopWords(query) {
  const words = query.split(' ');
  const filtered = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  return filtered.length > 0 ? filtered.join(' ') : query;
}

/**
 * String similarity using Dice's bigram coefficient
 */
export function stringSimilarity(str1, str2) {
  const s1 = (str1 || '').toLowerCase().trim();
  const s2 = (str2 || '').toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.85 + (Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length)) * 0.15;
  }

  function getBigrams(str) {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substr(i, 2));
    }
    return bigrams;
  }

  const bg1 = getBigrams(s1);
  const bg2 = getBigrams(s2);
  let intersection = 0;

  bg1.forEach(item => {
    if (bg2.has(item)) intersection++;
  });

  const total = bg1.size + bg2.size;
  return total > 0 ? (2.0 * intersection) / total : 0;
}

/**
 * Token overlap score (how many words in query are in title/artist)
 */
export function tokenOverlapRatio(queryTokens, targetText) {
  if (!queryTokens.length || !targetText) return 0;
  const targetLower = targetText.toLowerCase();
  let matches = 0;

  queryTokens.forEach(token => {
    if (targetLower.includes(token)) {
      matches++;
    }
  });

  return matches / queryTokens.length;
}

/**
 * Clean track title helper
 */
function getCleanTitle(name) {
  return (name || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim().toLowerCase();
}

/**
 * Comprehensive Title & Metadata Relevance Scoring
 * Returns a score from 0.0 to 200.0+
 */
export function calculateRelevanceScore(track, rawQuery, normalizedQuery, isLikelyEnglish = false) {
  if (!track || !track.name) return 0;

  const rawTitle = (track.name || '').toLowerCase();
  const cleanTitle = getCleanTitle(track.name);
  const artist = getTrackArtist(track).toLowerCase();
  const album = (track.album?.name || track.album || '').toLowerCase();
  const lang = (track.language || '').toLowerCase();

  const queryLower = normalizedQuery.toLowerCase();
  const queryTokens = queryLower.split(' ').filter(Boolean);

  let score = 0;

  // 1. Exact Title Match (Highest Priority)
  if (cleanTitle === queryLower || rawTitle === queryLower) {
    score += 120;
  } else if (cleanTitle.startsWith(queryLower) || rawTitle.startsWith(queryLower)) {
    score += 85;
  } else if (cleanTitle.includes(queryLower) || rawTitle.includes(queryLower)) {
    score += 65;
  }

  // 2. Token Overlap Score in Title
  const titleOverlap = tokenOverlapRatio(queryTokens, cleanTitle);
  score += titleOverlap * 45;

  // 3. String Similarity (Bigram Dice coefficient)
  const titleSim = stringSimilarity(queryLower, cleanTitle);
  score += titleSim * 35;

  // 4. Artist Match Contribution
  if (artist.includes(queryLower)) {
    score += 40;
  } else {
    const artistOverlap = tokenOverlapRatio(queryTokens, artist);
    score += artistOverlap * 25;
  }

  // 5. Album match contribution
  if (album.includes(queryLower)) {
    score += 15;
  }

  // 6. Language relevance bonus & regional demotion
  if (isLikelyEnglish) {
    if (lang === 'english' || lang === 'instrumental' || lang === 'en') {
      score += 35;
    } else if (['haryanvi', 'bhojpuri', 'rajasthani', 'sanskrit'].includes(lang)) {
      score -= 50; // Heavily demote irrelevant regional Indian languages when searching English songs
    }
  } else {
    if (lang === 'tamil') {
      score += 25;
    }
  }

  // 7. Popularity bonus if present
  if (track.playCount) {
    score += Math.min(Math.log10(Number(track.playCount) + 1), 5);
  }

  return score;
}

/**
 * Multi-Pass Search Engine with Verified Studio Track Priority
 * 1. Checks verified catalog (instantaneous 100% accurate hit)
 * 2. Fetches API results and strips non-songs/cuts/DJ remixes
 * 3. Demotes irrelevant regional tracks for English queries
 * 4. Merges, scores, and respects active filter chips
 */
export async function executeMultiPassSearch(rawQuery, activeFilter = 'all') {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return [];

  const queryLower = normalized.toLowerCase();
  const queryTokens = queryLower.split(' ').filter(Boolean);
  const allowRemix = /\b(remix|dj|mashup|slowed)\b/i.test(rawQuery);
  const isLikelyEnglish = /^[a-z0-9\s'.-]+$/i.test(rawQuery) && 
    !/\b(tamil|paadal|song|kadhal|thalaivar|vijay|anirudh|ajith|kamal|suriya|dhanush|simbu|sivakarthikeyan|rajini)\b/i.test(rawQuery);

  const seenIds = new Set();
  const seenSignatures = new Set();
  const scoredTracks = [];

  // PASS 0: Instant Verified Catalog Match
  for (const verified of MASTER_VERIFIED_TRACKS) {
    const title = verified.name.toLowerCase();
    const cleanTitle = getCleanTitle(verified.name);
    const artist = getTrackArtist(verified).toLowerCase();
    const album = (verified.album?.name || verified.album || '').toLowerCase();

    const meaningfulTokens = queryTokens.filter(t => t.length > 2 && !STOP_WORDS.has(t));

    let vScore = 0;
    if (cleanTitle === queryLower || title === queryLower) {
      vScore = 1500;
    } else if (cleanTitle.startsWith(queryLower) || title.startsWith(queryLower)) {
      vScore = 1200;
    } else if (cleanTitle.includes(queryLower) || title.includes(queryLower)) {
      vScore = 900;
    } else if (meaningfulTokens.length > 0 && meaningfulTokens.every(t => cleanTitle.includes(t) || artist.includes(t))) {
      vScore = 800;
    } else if (album.includes(queryLower) && queryLower.length > 2) {
      vScore = 750;
    } else if (artist.includes(queryLower)) {
      vScore = 700;
    } else if (meaningfulTokens.length > 0 && tokenOverlapRatio(meaningfulTokens, cleanTitle) >= 0.5) {
      vScore = 500;
    }

    if (vScore > 0) {
      const sig = `${cleanTitle}::${artist.split(',')[0].trim()}`;
      if (!seenSignatures.has(sig)) {
        seenIds.add(verified.id);
        seenSignatures.add(sig);
        scoredTracks.push({ track: verified, score: vScore });
      }
    }
  }

  // PASS 1: Live API Search
  try {
    let apiResults = await searchSongs(normalized, 30);

    // If query is an English song and returned scarce results, try fallback with artist hint or keyword
    if (isLikelyEnglish && (!apiResults || apiResults.length < 5)) {
      const fallbackResults = await searchSongs(`${normalized} song`, 20);
      apiResults = [...(apiResults || []), ...(fallbackResults || [])];
    }

    for (const track of (apiResults || [])) {
      if (seenIds.has(track.id)) continue;
      if (!isCleanOriginalSong(track, allowRemix)) continue;

      const lang = (track.language || '').toLowerCase();
      // Drop irrelevant regional languages for English query
      if (isLikelyEnglish && ['haryanvi', 'bhojpuri', 'rajasthani', 'sanskrit'].includes(lang)) {
        continue;
      }

      const cleanTitle = getCleanTitle(track.name);
      const artist = getTrackArtist(track).toLowerCase();
      const sig = `${cleanTitle}::${artist.split(',')[0].trim()}`;

      if (seenSignatures.has(sig)) continue;

      const score = calculateRelevanceScore(track, rawQuery, normalized, isLikelyEnglish);
      if (score > 15) {
        seenIds.add(track.id);
        seenSignatures.add(sig);
        scoredTracks.push({ track, score });
      }
    }
  } catch (err) {
    console.warn('API search error in executeMultiPassSearch:', err);
  }

  // Sort descending by calculated relevance score
  scoredTracks.sort((a, b) => b.score - a.score);

  let finalTracks = scoredTracks.map(item => item.track);

  // SMART LANGUAGE & FILTER CHIPS
  // Filter chips NEVER overwrite searchInput.value! They filter the results.
  if (activeFilter && activeFilter !== 'all') {
    const filterLower = activeFilter.toLowerCase();

    if (filterLower === 'tamil') {
      finalTracks = finalTracks.filter(track => {
        const lang = (track.language || '').toLowerCase();
        return lang === 'tamil' || lang === '';
      });
    } else if (filterLower === 'english') {
      finalTracks = finalTracks.filter(track => {
        const lang = (track.language || '').toLowerCase();
        return lang === 'english' || lang === 'en' || lang === 'instrumental';
      });
    } else if (filterLower === 'playlists') {
      finalTracks = finalTracks.filter(track => Boolean(track.album?.name || track.album));
    } else if (filterLower === 'podcasts') {
      finalTracks = finalTracks.filter(track => {
        const t = (track.name || '').toLowerCase();
        return t.includes('podcast') || t.includes('talk') || t.includes('audiobook');
      });
    }
  }

  return finalTracks;
}

/**
 * Configuration & App Constants
 * Vibe Music - Samsung One UI / Spotify Dark Music Player
 */

export const PRIMARY_API = 'https://jiosaavn-api.kirankumar-14-v.workers.dev/api';
export const FALLBACK_API = 'https://saavn.sumit.co/api';

export const STORAGE_KEYS = {
  LIKED_SONGS: 'liked_songs',
  PLAYLISTS: 'custom_playlists',
  SETTINGS: 'player_settings',
  HISTORY: 'playback_history'
};

export const DEFAULT_FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500';
export const DEFAULT_PLAYLIST_IMAGE = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500';

import { CURATED_SAI_TRACKS, CURATED_TAMIL_RELEASES, CURATED_RAHMAN_TRACKS } from './catalogs.js';
export { CURATED_SAI_TRACKS, CURATED_TAMIL_RELEASES, CURATED_RAHMAN_TRACKS };

// Curated Category Rails for dynamic home page
export const CURATED_RAILS = [
  {
    id: 'section-sai',
    railId: 'saiRail',
    title: '🌟 Sai Abhyankkar Specials',
    subtitle: 'Viral Hits & Grooves',
    type: 'sai',
    query: 'Sai Abhyankkar',
    icon: 'auto_awesome'
  },
  {
    id: 'section-vijay',
    railId: 'vijayRail',
    title: 'Thalapathy Vijay Hits',
    subtitle: 'Blockbuster tracks & mass beats',
    type: 'vijay',
    query: 'Vijay Tamil Hits',
    icon: 'star'
  },
  {
    id: 'section-anirudh',
    railId: 'anirudhRail',
    title: 'Anirudh Beats',
    subtitle: 'High octane chartbusters',
    type: 'anirudh',
    query: 'Anirudh Ravichander Hits',
    icon: 'equalizer'
  },
  {
    id: 'section-ar-rahman',
    railId: 'rahmanRail',
    title: '🎵 A.R. Rahman Specials',
    subtitle: 'Timeless Melodies & Oscar Classics',
    type: 'rahman',
    query: 'A.R. Rahman Hits',
    icon: 'piano'
  }
];

// Curated Showcase Tracks for immediate zero-loading playback on initial app launch
export const SHOWCASE_TRACKS = [
  {
    id: 'U9fFGPDn',
    name: 'Lokiverse 2.0',
    artists: { primary: [{ name: 'Anirudh Ravichander' }] },
    album: { name: 'Leo' },
    language: 'tamil',
    duration: 114,
    image: [
      { quality: '50x50', url: 'https://c.saavncdn.com/415/Leo-Original-Motion-Picture-Soundtrack-English-2023-20231019170311-50x50.jpg' },
      { quality: '150x150', url: 'https://c.saavncdn.com/415/Leo-Original-Motion-Picture-Soundtrack-English-2023-20231019170311-150x150.jpg' },
      { quality: '500x500', url: 'https://c.saavncdn.com/415/Leo-Original-Motion-Picture-Soundtrack-English-2023-20231019170311-500x500.jpg' }
    ],
    downloadUrl: [
      { quality: '160kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_160.mp4' },
      { quality: '320kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_320.mp4' }
    ]
  },
  {
    id: 'WZ5FUQGs',
    name: 'Hukum - Thalaivar Alappara',
    artists: { primary: [{ name: 'Anirudh Ravichander' }] },
    album: { name: 'Jailer' },
    language: 'tamil',
    duration: 236,
    image: [
      { quality: '150x150', url: 'https://c.saavncdn.com/artists/Anirudh_Ravichander_003_20260121134149_150x150.jpg' },
      { quality: '500x500', url: 'https://c.saavncdn.com/artists/Anirudh_Ravichander_003_20260121134149_500x500.jpg' }
    ],
    downloadUrl: [
      { quality: '160kbps', url: 'https://aac.saavncdn.com/036/326e8d22296a170594071806f0982623_160.mp4' },
      { quality: '320kbps', url: 'https://aac.saavncdn.com/036/326e8d22296a170594071806f0982623_320.mp4' }
    ]
  },
  {
    id: 'qbQ0IFxj',
    name: 'Badass',
    artists: { primary: [{ name: 'Anirudh Ravichander' }] },
    album: { name: 'Leo' },
    language: 'tamil',
    duration: 229,
    image: [
      { quality: '150x150', url: 'https://c.saavncdn.com/415/Leo-Original-Motion-Picture-Soundtrack-English-2023-20231019170311-150x150.jpg' },
      { quality: '500x500', url: 'https://c.saavncdn.com/415/Leo-Original-Motion-Picture-Soundtrack-English-2023-20231019170311-500x500.jpg' }
    ],
    downloadUrl: [
      { quality: '160kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_160.mp4' },
      { quality: '320kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_320.mp4' }
    ]
  },
  {
    id: 'Ck1V-H4b',
    name: 'Kaavaalaa',
    artists: { primary: [{ name: 'Shilpa Rao, Anirudh' }] },
    album: { name: 'Jailer' },
    language: 'tamil',
    duration: 190,
    image: [
      { quality: '150x150', url: 'https://c.saavncdn.com/artists/Anirudh_Ravichander_003_20260121134149_150x150.jpg' },
      { quality: '500x500', url: 'https://c.saavncdn.com/artists/Anirudh_Ravichander_003_20260121134149_500x500.jpg' }
    ],
    downloadUrl: [
      { quality: '160kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_160.mp4' },
      { quality: '320kbps', url: 'https://aac.saavncdn.com/415/37c60aa27b569c5fb8d1ca651599b0ee_320.mp4' }
    ]
  }
];

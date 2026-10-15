# AGENTS.md — Architecture & Android Mobile Optimization Rules

## Project Role
You are a Senior Full-Stack and Mobile Web Engineer building a standalone, Spotify-style PWA for Android (Samsung One UI feel).

## Backend Integration
- Primary Cloudflare Worker API: `https://jiosaavn-api.kirankumar-14-v.workers.dev/api`
- Fallback API: `https://saavn.sumit.co/api`
- Search Route: `/search/songs?query={query}`
- Song Suggestions (Autoplay/Recommendations): `/songs/{id}/suggestions`
- Song Details by ID: `/songs/{id}`

## Strict Mobile Audio & Battery Optimization Directives (Crucial)
1. **Single Persistent Audio Element:**
   - NEVER create dynamic `new Audio()` instances on track switches.
   - Instantiate exactly ONE `` element attached to the DOM at load.
   - When changing tracks, only reassign `audio.src = newUrl` and call `await audio.play()`.

2. **Zero-Latency Background Queuing (Anti-Kill Mechanism):**
   - Mobile Android/Samsung battery managers suspend background tabs if silence occurs after a song ends.
   - To bypass this: Always pre-fetch the next track's direct CDN download link (`downloadUrl` 320kbps/160kbps) at least 20 seconds before the current track finishes.
   - When the `ended` event fires, the next URL must be immediately ready in memory so playback continues with zero network delay.

3. **Android MediaSession Integration:**
   - On every track change, configure `navigator.mediaSession.metadata` using `MediaMetadata` with title, artists, album, and high-res square album art.
   - Register persistent action handlers (`play`, `pause`, `previoustrack`, `nexttrack`, `seekto`).
   - Keep action handlers bound globally once on initialization.

4. **Client-Side State & Storage:**
   - JioSaavn does not store user accounts. Use browser `localStorage` for `likedSongs`, custom `playlists`, and playback settings.
   - Never store dynamic CDN streaming links in `localStorage` as they can expire; store persistent track IDs and metadata, resolving stream URLs dynamically.

5. **PWA Standalone Shell:**
   - Include a valid `manifest.json` and a minimal offline caching `sw.js` (Service Worker) so the app can be installed via "Add to Home screen".
# 🎵 Mytunes (Vibe Music)

> **High-Fidelity, Zero-Latency Background Audio Streaming PWA**  
> *Engineered for Android & Modern Desktop Browsers.*


## 📖 Overview

**Mytunes** is a standalone Progressive Web App (PWA) that brings the seamless, continuous background listening experience of native music players (such as Spotify and Apple Music) to the open web.

Most mobile web audio players stall or stop playing after 1 or 2 songs when the screen is locked, or when switching to external apps like YouTube or Instagram. **Mytunes** solves these mobile browser constraints through an anti-kill audio pipeline, in-memory parallel pre-buffering, notification heartbeats, and zero-latency track switching.

---

## ✨ Features

### 🎧 Audio & Playback Engine
- **Zero-Latency Track Transitions:** Pre-resolves 320kbps and 160kbps Akamai CDN stream links in advance, switching tracks in the same execution tick without buffering silence.
- **Continuous Android Background Playback:** Defeats aggressive Android battery managers (e.g., Samsung One UI, Xiaomi MIUI, Pixel Doze) even under standard *"Optimised"* battery settings.
- **Interruption Recovery:** Automatically resumes audio playback after phone calls or external media interruptions (YouTube, Instagram Reels) without pipeline deadlocks.
- **Lock Screen & Media Notification Integration:** Full support for `navigator.mediaSession` with 4 square artwork resolutions (512px, 256px, 128px, 96px), lock-screen scrubber synchronization, and seek controls.
- **Playback Modes:** Shuffle, Repeat One, Repeat All, and Smart Autoplay recommendations.

### 📱 UI & Experience 
- **Fluid Standalone PWA:** Installs via *"Add to Home screen"* with a splash screen, native app shell, portrait lock, and gesture navigation.
- **Mini-Player & Full Now Playing Modal:** Smooth transitions between ambient mini-player and expanded modal featuring high-res artwork, real-time scrubber, volume controls, and live queue manager.
- **Curated Category Rails:** Home page sections featuring trending releases, artist specials (e.g., Anirudh, Sai Abhyankkar, A.R. Rahman), and recent history.
- **In-Place Playlist Renaming:** Fast, elevated modal dialogs with automatic text selection and keyboard adjustments for mobile viewports.

### 📚 Library & Personalization
- **Client-Side Storage:** Fast, private, account-free persistence using browser `localStorage` for Liked Songs, Custom Playlists, and Playback History.
- **Offline CDN Link Persistence:** Preserves high-bitrate stream URLs within stored playlists to eliminate background API dependency.
- **Full Playlist Management:** Create, rename, delete, and add/remove songs with instant UI synchronization.
- **Inline Track Search Drawer:** Search and append tracks directly inside playlist views without losing context.

---

## 🛠️ Architecture & Mobile Optimization Deep Dive

### 1. Single Persistent Audio Element
Mobile browsers strictly enforce user-activation policies: creating dynamic `new Audio()` instances in background callbacks throws `NotAllowedError`. Mytunes instantiates exactly **one** persistent `<audio id="persistent-audio">` element attached to the DOM at initialization. Track switches reassign `audio.src = directUrl` and invoke `audio.play()` on the existing authorized node.

### 2. Dual-Trigger EOF Transition Engine
Mobile Chrome often throttles or drops DOM `'ended'` events when the screen is locked. Mytunes employs a dual-trigger mechanism:
- **Primary Trigger:** The `timeupdate` handler checks `cur >= (dur - 0.7s)`. If reached, it synchronously advances to the next track before the current audio buffer drains.
- **Fallback Trigger:** Standard `'ended'` event listener acts as a safety net if `timeupdate` was jittered by OS CPU throttling.

### 3. Parallel Lookahead Queue Resolver
When a playlist or track is started, the engine immediately dispatches `batchResolveStreamUrls()` across up to 25 upcoming queue tracks in parallel chunks of 5. All direct stream links are populated in memory (`streamUrlCache`) within 1–2 seconds while the user is still looking at the screen. When the phone is locked, the engine plays directly from RAM without requiring background API network requests.

### 4. Direct Stream URL Persistence & Auto-Hydration
In `js/state.js`, stored tracks in `likedSongs` and `playlists` retain their direct 320kbps/160kbps CDN URLs. On application launch, an automated background hydration pass inspects stored tracks and pre-resolves any missing CDN URLs, saving them permanently to `localStorage`.

### 5. Resurrect & Resume Pipeline (`resurrectAndResume`)
When an external app like YouTube or Instagram takes audio focus, Chrome pauses the audio element and releases the hardware audio decoder. Upon returning or tapping **Play** in the notification panel, Mytunes:
1. Re-arms the `<audio>` source with a fresh connection.
2. Calls `audio.load()` to re-acquire the native audio decoder.
3. Listens for the `loadedmetadata` event (`readyState >= 1`) before applying `audio.currentTime = savedPosition`, preventing browser `InvalidStateError` crashes.
4. Resumes playback seamlessly down to the exact sub-second.

### 6. Notification Keep-Alive Heartbeat
Android's `MediaSessionService` evicts paused background media controls after 1–2 minutes of inactivity. Mytunes runs a lightweight 10-second heartbeat during external interruptions, re-asserting playback state and position to keep the notification card pinned in the drawer.

---

## 📂 Project Structure

```text
Mytunes/
├── index.html              # Core application markup, modal shells & templates
├── style.css               # Complete styling
├── manifest.json           # PWA manifest (standalone mode, theme colors, icons)
├── sw.js                   # Service Worker (cache-first static assets, skipWaiting, cache purge)
├── vercel.json             # Vercel deployment configuration, headers & routing
├── Music_logo.png          # High-resolution PWA application icon
├── AGENTS.md               # Optimization rules & engineering guidelines
└── js/
    ├── app.js              # Application entry point, tab routing & event wireup
    ├── audio.js            # AudioEngine (MediaSession, queue pre-buffering, resurrection)
    ├── state.js            # StateManager (reactive store, localStorage, playlist CRUD)
    ├── api.js              # API layer (Cloudflare Worker fetcher, search, batch resolver)
    ├── catalogs.js         # Curated starter catalogs (verified studio releases)
    ├── config.js           # App constants, API endpoints, curated rail definitions
    ├── search.js           # Debounced search handler & category filtering
    └── ui.js               # DOM rendering (rails, track rows, modals, toast feedback)
```

---

## 🌐 Backend & API Integration

Mytunes interfaces with a high-performance Cloudflare Worker reverse-proxy for the JioSaavn music catalog:

- **Primary API:** `https://jiosaavn-api.kirankumar-14-v.workers.dev/api`
- **Search Endpoint:** `/search/songs?query={query}&limit={limit}`
- **Song Details:** `/songs/{id}` (resolves 320kbps, 160kbps, 96kbps, 48kbps, and 12kbps MP4/AAC streams)
- **Recommendations:** `/songs/{id}/suggestions` with artist fallback
- **Lyrics:** `/lyrics?id={id}`

### Quality Filtering & Data Hygiene
All search and catalog queries pass through `isCleanOriginalSong()` in `js/api.js`:
- Filters out non-stop remixes, DJ sets, dialogues, ringtones, motivational speech edits, 8D audio, and slowed/reverb edits.
- Rejects clips under 75 seconds to ensure only full studio tracks appear on rails.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher) installed on your machine.

### Local Development Setup

1. **Clone or download the repository:**
   ```bash
   git clone https://github.com/<your-username>/Mytunes.git
   cd Mytunes
   ```

2. **Serve the application locally:**
   You can use any static HTTP server. For example:
   ```bash
   # Using npx serve
   npx serve -l 5500 -s .
   
   # Or using Python 3
   python -m http.server 5500
   ```

3. **Open in your browser:**
   ```text
   http://localhost:5500
   ```

### 📱 Testing on Mobile over Local Wi-Fi

1. Ensure your mobile phone and laptop are connected to the **same Wi-Fi network**.
2. Find your laptop's local IPv4 address:
   - **Windows:** Run `ipconfig` in PowerShell/CMD (look for `IPv4 Address` under Wi-Fi, e.g. `192.168.1.4`).
   - **macOS / Linux:** Run `ifconfig` or `ip a` (look for `inet` under `en0` or `wlan0`).
3. Open Chrome on your mobile phone and navigate to:
   ```text
   http://<YOUR-IP-ADDRESS>:5500
   ```
4. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install app"** to run Mytunes as a standalone PWA.

---

## 🚢 Deployment (Vercel)

The repository includes a ready-to-use `vercel.json` configured with:
- Cache control headers ensuring `sw.js` and `manifest.json` are always revalidated (`must-revalidate, max-age=0`).
- Clean URL rewrites and security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

### Deploying via Vercel CLI
```bash
# Install Vercel CLI if needed
npm install -g vercel

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Deploying via GitHub Integration
1. Push your changes to your GitHub repository.
2. Link the repository in your [Vercel Dashboard](https://vercel.com).
3. Vercel will automatically detect the static project and deploy it.

---

## ⚙️ Configuration & Storage Keys

Application configuration resides in `js/config.js`:

| Key | Description | Default |
| :--- | :--- | :--- |
| `PRIMARY_API` | Cloudflare Worker API URL | `https://jiosaavn-api.kirankumar-14-v.workers.dev/api` |
| `STORAGE_KEYS.LIKED_SONGS` | LocalStorage key for saved songs | `liked_songs` |
| `STORAGE_KEYS.PLAYLISTS` | LocalStorage key for custom playlists | `custom_playlists` |
| `STORAGE_KEYS.HISTORY` | LocalStorage key for playback history | `playback_history` |
| `STORAGE_KEYS.SETTINGS` | LocalStorage key for repeat/shuffle state | `player_settings` |

---

## ❓ Frequently Asked Questions (FAQ)

<details>
<summary><b>Why does background audio keep playing when screen is off on Mytunes, but fails on other web apps?</b></summary>
Standard web apps rely on network requests after each song ends. When your phone's screen turns off, Android puts the CPU into Light Doze, blocking background JavaScript fetch calls. Mytunes pre-resolves up to 25 tracks ahead into memory and local storage, switching directly to pre-cached CDN links with zero silence gap so the Android media service never suspends Chrome.
</details>

<details>
<summary><b>Does Mytunes require account creation?</b></summary>
No. All playlists, liked tracks, and history are stored locally on your device via standard browser <code>localStorage</code>. Your data remains private, fast, and accessible instantly without logins.
</details>

<details>
<summary><b>How do I update the PWA on my phone after deploying new code?</b></summary>
The Service Worker (<code>sw.js</code>) features automatic cache invalidation using unique cache versions (e.g., <code>vibe-music-cache-v10-infinite-bg</code>) and calls <code>self.skipWaiting()</code>. When a new version is deployed, simply reopen or refresh the app, and the service worker will claim clients and load updated assets immediately.
</details>

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.


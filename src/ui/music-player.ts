// src/ui/music-player.ts — Themed-folder music browser with shuffle,
// auto-advance, persistent state across reloads, scrolling track name,
// expandable track list, minimize button, and volume slider. Ported from
// beamline-tycoon's MusicPlayer.js.

const STORAGE_KEY = 'austerbitz.music';

interface SavedState {
  selectedTheme: string | null;
  currentIndex: number;
  currentTime: number;
  volume: number;
  shuffled: boolean;
  minimized: boolean;
  wasPlaying?: boolean;
}

interface Track {
  url: string;
  name: string;
}

export interface MusicPlayer {
  root: HTMLElement;
}

export function createMusicPlayer(root: HTMLElement): MusicPlayer {
  // ---- DOM construction ----
  const el = document.createElement('div');
  el.id = 'music-player';
  el.innerHTML = `
    <button class="mp-btn mp-prev" title="Previous">&lt;</button>
    <button class="mp-btn mp-play" title="Play/Pause">&gt;</button>
    <button class="mp-btn mp-next" title="Next">&gt;&gt;</button>
    <div class="mp-track-name-wrap">
      <button class="mp-track-name" title="Click to show tracks"><span class="mp-track-name-inner">Loading...</span></button>
      <div class="mp-track-list" hidden></div>
    </div>
    <button class="mp-btn mp-shuffle" title="Shuffle">~</button>
    <select class="mp-theme" title="Theme"></select>
    <input type="range" class="mp-volume" min="0" max="1" step="0.05" value="0.4" title="Volume">
    <button class="mp-btn mp-minimize" title="Minimize">_</button>
  `;
  root.appendChild(el);

  const trackNameWrap = el.querySelector('.mp-track-name-wrap') as HTMLDivElement;
  const trackNameBtn = el.querySelector('.mp-track-name') as HTMLButtonElement;
  const trackNameEl = el.querySelector('.mp-track-name-inner') as HTMLSpanElement;
  const trackListEl = el.querySelector('.mp-track-list') as HTMLDivElement;
  const playBtn = el.querySelector('.mp-play') as HTMLButtonElement;
  const prevBtn = el.querySelector('.mp-prev') as HTMLButtonElement;
  const nextBtn = el.querySelector('.mp-next') as HTMLButtonElement;
  const shuffleBtn = el.querySelector('.mp-shuffle') as HTMLButtonElement;
  const volumeSlider = el.querySelector('.mp-volume') as HTMLInputElement;
  const themeSelect = el.querySelector('.mp-theme') as HTMLSelectElement;
  const minimizeBtn = el.querySelector('.mp-minimize') as HTMLButtonElement;

  // ---- state ----
  let themes: Record<string, string[]> = {};
  let themeNames: string[] = [];
  let currentTheme: string | null = null;
  let tracks: Track[] = [];
  let currentIndex = -1;
  const audio = new Audio();
  audio.volume = 0.4;
  let isPlaying = false;
  let shuffled = false;
  let shuffleOrder: number[] = [];
  let pendingResumeTime = 0;
  let lastPositionSave = 0;
  let trackListOpen = false;
  let minimized = false;

  // ---- helpers ----
  function readSavedState(): SavedState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SavedState;
    } catch {
      return null;
    }
  }

  function saveState(): void {
    try {
      const t = audio.currentTime;
      const payload: SavedState = {
        selectedTheme: currentTheme,
        currentIndex,
        currentTime: typeof t === 'number' && isFinite(t) ? t : 0,
        wasPlaying: isPlaying,
        volume: audio.volume,
        shuffled,
        minimized,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors (private mode, full quota, etc.)
    }
  }

  function updatePlayButton(): void {
    playBtn.textContent = isPlaying ? '||' : '>';
  }

  function updateCurrentListItem(): void {
    if (trackListEl.hidden) return;
    const items = trackListEl.querySelectorAll('.mp-track-list-item');
    items.forEach((item, i) => {
      item.classList.toggle('current', i === currentIndex);
    });
  }

  function updateScrollAnimation(): void {
    // Reset first so measurements reflect natural widths
    trackNameWrap.classList.remove('mp-scrolling');
    requestAnimationFrame(() => {
      const overflow = trackNameEl.scrollWidth - trackNameBtn.clientWidth;
      if (overflow > 2) {
        // Slow scroll: ~40px per second of travel, round-trip animation with pauses
        const travelSec = Math.max(6, overflow / 20);
        const totalSec = travelSec * 2 + 3;
        trackNameWrap.style.setProperty('--mp-scroll-end', `-${overflow}px`);
        trackNameWrap.style.setProperty('--mp-scroll-duration', `${totalSec}s`);
        trackNameWrap.classList.add('mp-scrolling');
      } else {
        trackNameWrap.style.removeProperty('--mp-scroll-end');
        trackNameWrap.style.removeProperty('--mp-scroll-duration');
      }
    });
  }

  function updateTrackDisplay(): void {
    if (currentIndex < 0 || currentIndex >= tracks.length) return;
    const name = tracks[currentIndex]!.name;
    trackNameEl.textContent = name;
    trackNameBtn.title = name;
    updateScrollAnimation();
    updateCurrentListItem();
  }

  function renderTrackList(): void {
    trackListEl.innerHTML = '';
    if (tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mp-track-list-item';
      empty.textContent = 'No tracks';
      empty.style.cursor = 'default';
      trackListEl.appendChild(empty);
      return;
    }
    tracks.forEach((track, i) => {
      const item = document.createElement('button');
      item.className = 'mp-track-list-item';
      if (i === currentIndex) item.classList.add('current');
      item.textContent = track.name;
      item.title = track.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        playTrack(i);
        setTrackListOpen(false);
      });
      trackListEl.appendChild(item);
    });
  }

  function setTrackListOpen(open: boolean): void {
    trackListOpen = open;
    if (open) {
      renderTrackList();
      trackListEl.hidden = false;
    } else {
      trackListEl.hidden = true;
    }
  }

  function toggleTrackList(): void {
    setTrackListOpen(!trackListOpen);
  }

  function generateShuffleOrder(): void {
    shuffleOrder = tracks.map((_, i) => i);
    // Fisher-Yates shuffle
    for (let i = shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = shuffleOrder[i]!;
      const b = shuffleOrder[j]!;
      shuffleOrder[i] = b;
      shuffleOrder[j] = a;
    }
  }

  function playTrack(index: number): void {
    currentIndex = index;
    const targetUrl = tracks[index]!.url;
    const resolved = new URL(targetUrl, location.href).href;
    if (audio.src !== resolved) {
      audio.src = targetUrl;
    }
    audio.play().catch(() => {});
    isPlaying = true;
    updateTrackDisplay();
    updatePlayButton();
    saveState();
  }

  function next(): void {
    if (tracks.length === 0) return;
    const order = shuffled ? shuffleOrder : tracks.map((_, i) => i);
    const posInOrder = order.indexOf(currentIndex);
    const nextPos = (posInOrder + 1) % order.length;
    playTrack(order[nextPos]!);
  }

  function prev(): void {
    if (tracks.length === 0) return;
    // If more than 3 seconds in, restart current track
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const order = shuffled ? shuffleOrder : tracks.map((_, i) => i);
    const posInOrder = order.indexOf(currentIndex);
    const prevPos = (posInOrder - 1 + order.length) % order.length;
    playTrack(order[prevPos]!);
  }

  function togglePlay(): void {
    if (tracks.length === 0) return;
    if (isPlaying) {
      audio.pause();
      isPlaying = false;
    } else {
      playTrack(currentIndex);
    }
    updatePlayButton();
    saveState();
  }

  function toggleShuffle(): void {
    shuffled = !shuffled;
    shuffleBtn.classList.toggle('active', shuffled);
    if (shuffled) generateShuffleOrder();
    saveState();
  }

  function setMinimized(value: boolean): void {
    minimized = value;
    el.classList.toggle('minimized', minimized);
    minimizeBtn.textContent = minimized ? '+' : '_';
    minimizeBtn.title = minimized ? 'Expand' : 'Minimize';
    saveState();
  }

  function tryAutoplay(): void {
    const p = audio.play();
    if (!p || typeof p.then !== 'function') {
      isPlaying = !audio.paused;
      updatePlayButton();
      return;
    }
    p.then(() => {
      isPlaying = true;
      updatePlayButton();
      saveState();
    }).catch(() => {
      // Autoplay blocked — start on first user interaction
      isPlaying = false;
      updatePlayButton();
      const resume = (): void => {
        document.removeEventListener('pointerdown', resume, true);
        document.removeEventListener('keydown', resume, true);
        audio
          .play()
          .then(() => {
            isPlaying = true;
            updatePlayButton();
            saveState();
          })
          .catch(() => {});
      };
      document.addEventListener('pointerdown', resume, { capture: true, once: true });
      document.addEventListener('keydown', resume, { capture: true, once: true });
    });
  }

  function buildTracksForCurrentTheme(): void {
    const files = (currentTheme && themes[currentTheme]) || [];
    tracks = files.map((f) => ({
      url: `/music/${encodeURIComponent(currentTheme!)}/${encodeURIComponent(f)}`,
      name: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    }));
  }

  function populateThemeSelect(): void {
    themeSelect.innerHTML = '';
    for (const name of themeNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      themeSelect.appendChild(opt);
    }
    themeSelect.disabled = false;
  }

  function setTheme(name: string): void {
    if (!themes[name] || name === currentTheme) return;
    const wasPlaying = isPlaying;
    audio.pause();
    isPlaying = false;

    currentTheme = name;
    buildTracksForCurrentTheme();
    currentIndex = 0;
    if (shuffled) generateShuffleOrder();
    setTrackListOpen(false);

    const hasTracks = tracks.length > 0;
    playBtn.disabled = !hasTracks;
    prevBtn.disabled = !hasTracks;
    nextBtn.disabled = !hasTracks;

    if (hasTracks) {
      updateTrackDisplay();
      if (wasPlaying) {
        playTrack(currentIndex);
      } else {
        updatePlayButton();
      }
    } else {
      trackNameEl.textContent = 'No tracks';
      updatePlayButton();
    }

    saveState();
  }

  // ---- events ----
  playBtn.addEventListener('click', () => togglePlay());
  prevBtn.addEventListener('click', () => prev());
  nextBtn.addEventListener('click', () => next());
  shuffleBtn.addEventListener('click', () => toggleShuffle());
  volumeSlider.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    audio.volume = parseFloat(target.value);
    saveState();
  });
  themeSelect.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    setTheme(target.value);
  });
  minimizeBtn.addEventListener('click', () => setMinimized(!minimized));
  trackNameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTrackList();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!trackListOpen) return;
    const target = e.target as Node | null;
    if (target && !trackNameWrap.contains(target)) {
      setTrackListOpen(false);
    }
  });

  audio.addEventListener('ended', () => next());
  audio.addEventListener('error', () => {
    // Skip broken tracks
    if (tracks.length > 1) next();
  });

  // Apply a pending resume position once the track's metadata is known
  audio.addEventListener('loadedmetadata', () => {
    if (pendingResumeTime > 0 && isFinite(audio.duration)) {
      if (pendingResumeTime < audio.duration - 1) {
        try {
          audio.currentTime = pendingResumeTime;
        } catch {
          // ignore — some browsers throw if seek not yet supported
        }
      }
      pendingResumeTime = 0;
    }
  });

  // Persist playback position while playing (throttled to ~2s)
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastPositionSave > 2000) {
      lastPositionSave = now;
      saveState();
    }
  });

  audio.addEventListener('pause', () => saveState());

  // ---- bootstrap: load tracks ----
  void (async (): Promise<void> => {
    try {
      const resp = await fetch('/music/tracks.json');
      themes = (await resp.json()) as Record<string, string[]>;
    } catch {
      themes = {};
    }

    themeNames = Object.keys(themes).sort();

    if (themeNames.length === 0) {
      tracks = [];
      trackNameEl.textContent = 'No tracks';
      playBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      themeSelect.disabled = true;
      return;
    }

    populateThemeSelect();

    // Pull saved state (including selectedTheme) before picking a theme
    const saved = readSavedState();

    let theme = saved?.selectedTheme ?? null;
    if (!theme || !themes[theme]) {
      theme = themeNames[0]!;
    }
    currentTheme = theme;
    themeSelect.value = theme;
    buildTracksForCurrentTheme();

    // Restore volume + shuffle (they're global, not per-theme)
    if (saved) {
      if (typeof saved.volume === 'number') {
        audio.volume = saved.volume;
        volumeSlider.value = String(saved.volume);
      }
      if (saved.shuffled) {
        shuffled = true;
        shuffleBtn.classList.add('active');
        generateShuffleOrder();
      }
      if (typeof saved.currentIndex === 'number' && saved.currentIndex < tracks.length) {
        currentIndex = saved.currentIndex;
      }
      if (saved.minimized) setMinimized(true);
    }

    if (tracks.length === 0) {
      trackNameEl.textContent = 'No tracks';
      playBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    if (currentIndex < 0) currentIndex = 0;
    updateTrackDisplay();

    // Restore playback position + autoplay
    if (saved && typeof saved.currentTime === 'number' && saved.currentTime > 0) {
      pendingResumeTime = saved.currentTime;
    }
    audio.src = tracks[currentIndex]!.url;
    tryAutoplay();
  })();

  return { root: el };
}

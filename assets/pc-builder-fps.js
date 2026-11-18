/* ==========================================================================
   pc-builder-fps.js — estimated frame rates for the PC builder (sections/pc-builder). Pure data and functions, no DOM.
   Imported by assets/pc-builder.js (the URL sections/pc-builder prints in data-fps-src) and by the Node tests in
   .github/pc-builder. The customer always sees these numbers labelled "הערכה בלבד".

   How the numbers were made (edit them freely; every cell is a plain number):
   - GPU_FPS: average FPS with a fast processor, at [1080p, 1440p], each game's preset in GAMES (high settings, no
     DLSS/FSR, no frame generation). The RTX 5070 row is the reference, set at or below what public reviews of late
     2025 measured; every other card is scaled by its relative raster performance at 1440p (RTX 5070 = 100, the number
     in each row's comment: TechPowerUp / Hardware Unboxed-level averages), linearly at 1440p and by its 0.85 power at
     1080p (fast cards gain less at 1080p), rounded down to 5. Integrated graphics are the same formula with a small
     index, and are meant to read as "not for these games".
   - 4K: the 1440p figure × the game's k4 (GPU-bound scaling; also an estimate).
   - CPU_CAPS: the most a processor class reaches in the game whatever the card (esports titles are processor-bound).
     The class comes from the parser's processor score (assets/pc-builder-parser.js); X3D parts are their own class.
   - GAMES[].cap: the game's own frame limit (EA FC's limiter stops at 240).
   - GAMES[].target: the frame rate a build "aims" for when the customer picks the game (high-refresh screens for
     competitive titles, a steady 60 for the story/sports games); at 4K at most TARGET_4K.
   ========================================================================== */

export const GAMES = [
  { key: 'fortnite', label: 'Fortnite', preset: 'High, DX12', target: 144, k4: 0.55 },
  { key: 'valorant', label: 'Valorant', preset: 'High', target: 144, k4: 0.65 },
  { key: 'cs2', label: 'Counter-Strike 2', short: 'CS2', preset: 'High', target: 144, k4: 0.6 },
  { key: 'warzone', label: 'Call of Duty: Warzone', short: 'Warzone', preset: 'Basic/High', target: 90, k4: 0.6 },
  { key: 'cyberpunk', label: 'Cyberpunk 2077', short: 'Cyberpunk', preset: 'High, no RT', target: 60, k4: 0.5 },
  { key: 'fc', label: 'EA Sports FC', short: 'EA FC', preset: 'Ultra', target: 60, k4: 0.7, cap: 240 },
];

export const RESOLUTIONS = [
  { key: '1080p', label: '1080p', sub: 'Full HD' },
  { key: '1440p', label: '1440p', sub: '2K' },
  { key: '4k', label: '4K', sub: 'Ultra HD' },
];

export const TARGET_4K = 60;

/* [1080p, 1440p] average FPS, GPU-bound. The comment is the relative 1440p index (RTX 5070 = 100). */
export const GPU_FPS = {
  'RTX 5080': { fortnite: [245, 190], valorant: [665, 590], cs2: [430, 345], warzone: [200, 160], cyberpunk: [160, 120], fc: [320, 295] }, // 147
  'RTX 5070 Ti': { fortnite: [215, 165], valorant: [590, 510], cs2: [380, 300], warzone: [180, 140], cyberpunk: [140, 100], fc: [285, 255] }, // 128
  'RX 9070 XT': { fortnite: [210, 165], valorant: [580, 500], cs2: [375, 295], warzone: [175, 140], cyberpunk: [140, 100], fc: [280, 250] }, // 125
  'RX 9070': { fortnite: [195, 145], valorant: [530, 450], cs2: [340, 265], warzone: [160, 125], cyberpunk: [125, 90], fc: [255, 225] }, // 112
  'RTX 5070': { fortnite: [175, 130], valorant: [480, 400], cs2: [310, 235], warzone: [145, 110], cyberpunk: [115, 80], fc: [230, 200] }, // 100
  'RX 9070 GRE': { fortnite: [170, 125], valorant: [460, 380], cs2: [295, 225], warzone: [140, 105], cyberpunk: [110, 75], fc: [220, 190] }, // 95
  'RTX 5060 Ti': { fortnite: [135, 100], valorant: [375, 300], cs2: [245, 175], warzone: [115, 85], cyberpunk: [90, 60], fc: [180, 150] }, // 75
  'RX 9060 XT': { fortnite: [135, 95], valorant: [370, 295], cs2: [240, 175], warzone: [110, 80], cyberpunk: [90, 60], fc: [180, 150] }, // 74
  'RTX 5060': { fortnite: [120, 85], valorant: [330, 255], cs2: [210, 150], warzone: [100, 70], cyberpunk: [80, 50], fc: [155, 130] }, // 64
  'RTX 4060': { fortnite: [100, 70], valorant: [275, 210], cs2: [180, 120], warzone: [85, 55], cyberpunk: [65, 42], fc: [130, 105] }, // 52
  'RX 7600': { fortnite: [95, 65], valorant: [265, 200], cs2: [170, 120], warzone: [80, 55], cyberpunk: [65, 40], fc: [130, 100] }, // 50
  'RTX 5050': { fortnite: [95, 65], valorant: [260, 195], cs2: [170, 115], warzone: [80, 55], cyberpunk: [65, 39], fc: [125, 100] }, // 49
  'RTX PRO 2000': { fortnite: [90, 60], valorant: [245, 180], cs2: [155, 105], warzone: [75, 50], cyberpunk: [60, 36], fc: [115, 90] }, // 45
  'RTX 3060': { fortnite: [85, 55], valorant: [230, 170], cs2: [150, 100], warzone: [70, 46], cyberpunk: [55, 34], fc: [110, 85] }, // 42
  'RTX 3050': { fortnite: [65, 39], valorant: [175, 120], cs2: [110, 70], warzone: [50, 33], cyberpunk: [41, 24], fc: [85, 60] }, // 30
  'RTX A1000': { fortnite: [48, 29], valorant: [135, 90], cs2: [85, 50], warzone: [40, 24], cyberpunk: [32, 18], fc: [65, 44] }, // 22
  'Radeon 780M': { fortnite: [37, 21], valorant: [100, 64], cs2: [65, 38], warzone: [31, 18], cyberpunk: [24, 13], fc: [48, 32] }, // 16
  'Radeon 760M': { fortnite: [29, 16], valorant: [79, 48], cs2: [51, 28], warzone: [24, 13], cyberpunk: [19, 10], fc: [38, 24] }, // 12
  'Radeon 740M': { fortnite: [23, 12], valorant: [60, 36], cs2: [40, 21], warzone: [19, 10], cyberpunk: [15, 7], fc: [30, 18] }, // 9
  'Intel Graphics (Core Ultra)': { fortnite: [20, 10], valorant: [55, 32], cs2: [36, 19], warzone: [17, 9], cyberpunk: [13, 6], fc: [27, 16] }, // 8
  'RTX A400': { fortnite: [20, 10], valorant: [55, 32], cs2: [36, 19], warzone: [17, 9], cyberpunk: [13, 6], fc: [27, 16] }, // 8
  'GT 1030': { fortnite: [18, 9], valorant: [50, 28], cs2: [32, 16], warzone: [15, 8], cyberpunk: [12, 6], fc: [24, 14] }, // 7
  'Radeon Vega (5000G)': { fortnite: [18, 9], valorant: [50, 28], cs2: [32, 16], warzone: [15, 8], cyberpunk: [12, 6], fc: [24, 14] }, // 7
  'Intel UHD 730/770': { fortnite: [11, 5], valorant: [31, 16], cs2: [20, 9], warzone: [9, 4], cyberpunk: [7, 3], fc: [15, 8] }, // 4
  'Radeon (2 CU)': { fortnite: [9, 4], valorant: [24, 12], cs2: [16, 7], warzone: [7, 3], cyberpunk: [6, 2], fc: [12, 6] }, // 3
};

/* Processor classes, weakest first: `min` is the parser's processor score (Core i3-14100 ≈ 46, Ryzen 5 7600X ≈ 71,
   Core i7-14700 ≈ 92, Ryzen 7 9700X ≈ 99); X3D parts are always "x3d". */
export const CPU_CLASSES = [
  { key: 'entry', min: 0 },
  { key: 'mid', min: 55 },
  { key: 'upper', min: 75 },
  { key: 'high', min: 95 },
];

/* The most each class reaches per game (average FPS, any resolution). */
export const CPU_CAPS = {
  entry: { fortnite: 140, valorant: 280, cs2: 180, warzone: 110, cyberpunk: 85, fc: 180 },
  mid: { fortnite: 190, valorant: 400, cs2: 260, warzone: 150, cyberpunk: 110, fc: 240 },
  upper: { fortnite: 230, valorant: 480, cs2: 320, warzone: 180, cyberpunk: 130, fc: 240 },
  high: { fortnite: 260, valorant: 550, cs2: 380, warzone: 200, cyberpunk: 145, fc: 240 },
  x3d: { fortnite: 300, valorant: 600, cs2: 450, warzone: 230, cyberpunk: 160, fc: 240 },
};

export const gameOf = (key) => GAMES.find((g) => g.key === key) || null;

export function targetFor(gameKey, res = '1080p') {
  const g = gameOf(gameKey);
  if (!g) return null;
  return res === '4k' ? Math.min(g.target, TARGET_4K) : g.target;
}

/** The graphics a processor brings (a GPU_FPS key), from the parser's facts: null when it has none. */
export function igpuOf(cpu) {
  const f = cpu?.facts;
  if (!f || f.igpu !== true) return null;
  const m = f.model || '';
  let g;
  if ((g = m.match(/^Ryzen \d 8(\d)\d\dG/))) return +g[1] >= 7 ? 'Radeon 780M' : +g[1] >= 6 ? 'Radeon 760M' : 'Radeon 740M';
  if (/^Ryzen \d 5\d{3}G/.test(m)) return 'Radeon Vega (5000G)';
  if (/^Ryzen/.test(m)) return 'Radeon (2 CU)';
  if (/^Core Ultra/.test(m)) return 'Intel Graphics (Core Ultra)';
  if (/^Core i/.test(m)) return 'Intel UHD 730/770';
  return null;
}

/** What draws the frames: the card when there is one, else the processor's graphics. */
export function graphicsOf(sel) {
  const chip = sel?.gpu?.facts?.chip;
  if (chip) return { key: chip, integrated: false, known: !!GPU_FPS[chip] };
  const ig = igpuOf(sel?.cpu);
  return ig ? { key: ig, integrated: true, known: true } : null;
}

export function cpuClassOf(cpu) {
  const f = cpu?.facts;
  if (!f) return null;
  if (f.x3d) return 'x3d';
  const score = f.score || 0;
  let out = CPU_CLASSES[0].key;
  for (const c of CPU_CLASSES) if (score >= c.min) out = c.key;
  return out;
}

/** One game at one resolution: { fps, bound: 'gpu' | 'cpu' | 'game' } or null when there is no estimate. */
export function estimateFps(sel, gameKey, res = '1080p') {
  const game = gameOf(gameKey);
  const gfx = graphicsOf(sel);
  const row = gfx && GPU_FPS[gfx.key];
  if (!game || !row || !row[gameKey]) return null;
  const [p1080, p1440] = row[gameKey];
  let fps = res === '1440p' ? p1440 : res === '4k' ? Math.floor(p1440 * game.k4) : p1080;
  let bound = 'gpu';
  if (game.cap && game.cap < fps) {
    fps = game.cap;
    bound = 'game';
  }
  const cls = cpuClassOf(sel.cpu);
  const cpuCap = cls ? CPU_CAPS[cls][gameKey] : null;
  if (cpuCap && cpuCap < fps) {
    fps = cpuCap;
    bound = 'cpu';
  }
  return { fps: Math.round(fps), bound };
}

/** Every listed game (or all of them): [{ key, label, fps, bound, target, meets }]. */
export function estimateBuild(sel, games, res = '1080p') {
  const keys = games && games.length ? games : GAMES.map((g) => g.key);
  return keys
    .map((key) => {
      const game = gameOf(key);
      if (!game) return null;
      const e = estimateFps(sel, key, res);
      const target = targetFor(key, res);
      return { key, label: game.short || game.label, fps: e ? e.fps : null, bound: e ? e.bound : null, target, meets: !!e && e.fps >= target };
    })
    .filter(Boolean);
}

/** How close a selection comes to the targets of the chosen games, 0…1 (1 = every game at its target). The guided
    planner (planBuilds' `aim.score`) adds this to the build's value, so it buys frames until the targets are met. */
export function aimScore(sel, games, res = '1080p') {
  if (!games || !games.length) return 0;
  let s = 0;
  for (const key of games) {
    const e = estimateFps(sel, key, res);
    const target = targetFor(key, res);
    if (e && target) s += Math.min(1, e.fps / target);
  }
  return s / games.length;
}

/** "120", or "<30" below a playable rate. */
export const fpsText = (fps) => (fps === null || fps === undefined ? '—' : fps < 30 ? '<30' : String(fps));

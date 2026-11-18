/* ==========================================================================
   pc-builder-parser.js — the PC builder's pure logic (no DOM): what a product is, what it fits, and the builds.
   Loaded by assets/pc-builder.js (dynamic import of the URL sections/pc-builder prints) and by the Node harness in
   .github/pc-builder (coverage over the supplier's titles, unit tests, the static preview).

   The supplier's parts (Mor Levi, national drop-ship) arrive with a Hebrew + English title only: no vendor, no product
   type, no compatibility fields. So everything here is read from the title, and a product metafield in the "pc"
   namespace wins over the title when it is set (sections/pc-builder prints those as JSON):
     pc.category      cpu | board | ram | gpu | storage | cooler | psu | case | os | extra | none (hide)
     pc.socket        LGA1851 | LGA1700 | AM5 | AM4                     (CPU, board)
     pc.memory        DDR4 | DDR5                                       (board, RAM)
     pc.form_factor   E-ATX | ATX | mATX | Mini-ITX                     (board; for a case, the largest board it takes)
     pc.watts         number                                            (PSU output; CPU or GPU peak draw)
     pc.cooler_tdp    number                                            (the most a cooler is rated for)
     pc.igpu          true | false                                      (CPU has graphics)
     pc.needs_cooler  true | false                                      (CPU sold without a cooler)
     pc.back_connect  true | false                                      (board with rear connectors; a case for them)

   Strict compatibility: a part missing a fact its checks need (REQUIRED_FACTS) never fits anything until a pc.*
   metafield gives it; a cooler with no rating fits processors up to UNRATED_COOLER_MAX only. applyChoice() drops the
   chosen parts a new choice no longer fits, sanitize() cleans a selection from a link or a saved build, and
   checkBuild().ok (isOrderable) is what the cart and the quote require.
   ========================================================================== */

export const STEPS = [
  { key: 'cpu', label: 'מעבד', title: 'בחירת מעבד' },
  { key: 'board', label: 'לוח אם', title: 'בחירת לוח אם' },
  { key: 'ram', label: 'זיכרון', title: 'בחירת זיכרון' },
  { key: 'gpu', label: 'כרטיס מסך', title: 'בחירת כרטיס מסך' },
  { key: 'storage', label: 'אחסון', title: 'בחירת אחסון' },
  { key: 'cooler', label: 'קירור', title: 'בחירת קירור למעבד' },
  { key: 'psu', label: 'ספק כוח', title: 'בחירת ספק כוח' },
  { key: 'case', label: 'מארז', title: 'בחירת מארז' },
  { key: 'os', label: 'מערכת הפעלה', title: 'מערכת הפעלה' },
  { key: 'extra', label: 'תוספות', title: 'תוספות למחשב', multi: true },
];

export const STEP_KEYS = STEPS.map((s) => s.key);

/* Board sizes, smallest first: a board fits a case whose largest size is the same or bigger. */
export const FORM_FACTORS = ['Mini-ITX', 'mATX', 'ATX', 'E-ATX'];
const ffRank = (ff) => FORM_FACTORS.indexOf(ff);

/* Chipset → socket. The chipset is in every board title, the socket is not (and long titles are cut mid-word). */
const CHIPSETS = {
  LGA1851: ['Z890', 'B860', 'H810'],
  LGA1700: ['Z790', 'B760', 'H610', 'H770', 'Z690', 'B660', 'H670'],
  AM5: ['X870', 'B850', 'B650', 'A620', 'B840', 'X670'],
  AM4: ['B550', 'A520', 'X570', 'B450', 'A320', 'X470'],
};
const CHIPSET_SOCKET = Object.fromEntries(Object.entries(CHIPSETS).flatMap(([s, list]) => list.map((c) => [c, s])));

/* Memory each socket takes; LGA1700 boards come in both, so the title (or the metafield) has to say. */
const SOCKET_MEMORY = { LGA1851: 'DDR5', AM5: 'DDR5', AM4: 'DDR4', LGA1700: null };

/* Graphics cards: peak board power (W) and a rough relative performance index (1440p gaming, RTX 5070 = 70). */
const GPU_TABLE = {
  'GT 1030': { watts: 30, score: 4 },
  'RTX A400': { watts: 50, score: 8 },
  'RTX A1000': { watts: 50, score: 24 },
  'RTX PRO 2000': { watts: 70, score: 42 },
  'RTX 3050': { watts: 130, score: 25 },
  'RTX 3060': { watts: 170, score: 35 },
  'RTX 4060': { watts: 115, score: 42 },
  'RTX 5050': { watts: 130, score: 38 },
  'RTX 5060': { watts: 145, score: 48 },
  'RTX 5060 Ti': { watts: 180, score: 56 },
  'RTX 5070': { watts: 250, score: 70 },
  'RTX 5070 Ti': { watts: 300, score: 90 },
  'RTX 5080': { watts: 360, score: 105 },
  'RTX 5090': { watts: 575, score: 150 },
  'RX 7600': { watts: 165, score: 38 },
  'RX 9060 XT': { watts: 170, score: 56 },
  'RX 9070 GRE': { watts: 220, score: 72 },
  'RX 9070': { watts: 220, score: 82 },
  'RX 9070 XT': { watts: 304, score: 88 },
};

const BRANDS = [
  ['AMD', /\bamd\b|\bryzen\b|\bradeon\b/i],
  ['Intel', /\bintel\b|\bcore\s*(?:ultra|i[3579])\b/i],
  ['Gigabyte', /\bgigabyte\b|\baorus\b/i],
  ['ASUS', /\basus\b|\brog\b/i],
  ['MSI', /\bmsi\b/i],
  ['ASRock', /\basrock\b/i],
  ['Corsair', /\bcorsair\b/i],
  ['Kingston', /\bkingston\b/i],
  ['Crucial', /\bcrucial\b/i],
  ['KLEVV', /\bklevv\b/i],
  ['ADATA', /\badata\b|\bxpg\b/i],
  ['Lexar', /\blexar\b/i],
  ['Netac', /\bnetac\b/i],
  ['Samsung', /\bsamsung\b/i],
  ['WD', /\bwestern digital\b|\bwd\b/i],
  ['Seagate', /\bseagate\b/i],
  ['Toshiba', /\btoshiba\b/i],
  ['SanDisk', /\bsandisk\b/i],
  ['Antec', /\bantec\b|\bantex\b|אנטק/i],
  ['Cooler Master', /\bcooler\s*master\b/i],
  ['DeepCool', /\bdeep\s*cool\b/i],
  ['Noctua', /\bnoctua\b/i],
  ['NZXT', /\bnzxt\b/i],
  ['Lian Li', /\blian\s*li\b/i],
  ['be quiet!', /\bbe\s*quiet\b/i],
  ['Thermaltake', /\bthermaltake\b/i],
  ['Microsoft', /\bmicrosoft\b|\bwindows\b|\boffice\b/i],
  ['PNY', /\bpny\b/i],
  ['NVIDIA', /\bnvidia\b/i],
  ['Logitech', /\blogitech\b|לוגיטק/i],
  ['Razer', /\brazer\b/i],
  ['Dell', /\bdell\b/i],
  ['ESET', /\beset\b|\bnod32\b/i],
  ['SAMA', /\bsama\b/i],
  ['Solid', /\bsolid\b/i],
  ['Skyloong', /\bskyloong\b/i],
  // Gigabyte's card lines, for the titles that name only the line ("GeForce RTX 5080 AERO OC").
  ['Gigabyte', /\b(?:aero|eagle|windforce)\b/i],
];

/* ---------- small helpers ---------- */

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const bool = (v) => {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'כן'].includes(s)) return true;
  if (['false', '0', 'no', 'לא'].includes(s)) return false;
  return null;
};

export function normalizeSocket(v) {
  const s = String(v ?? '').toUpperCase().replace(/\s+/g, '');
  if (/^(LGA)?1851$/.test(s)) return 'LGA1851';
  if (/^(LGA)?1700$/.test(s)) return 'LGA1700';
  if (s === 'AM5' || s === 'AM4') return s;
  return null;
}

export function normalizeFormFactor(v) {
  const s = String(v ?? '').toLowerCase().replace(/[\s_]+/g, '-');
  if (/^e-?atx$/.test(s)) return 'E-ATX';
  if (/^(mini-?)?itx$/.test(s)) return 'Mini-ITX';
  if (/^(m-?atx|micro-?atx|matx)$/.test(s)) return 'mATX';
  if (s === 'atx') return 'ATX';
  return null;
}

const normalizeMemory = (v) => {
  const m = String(v ?? '').match(/ddr\s*([45])/i);
  return m ? `DDR${m[1]}` : null;
};

/* The maker. AMD and Intel name the platform in board and card titles ("Gigabyte AMD A520M"), so they count only
   for processors, or when no other maker is named. */
export function brandOf(title, vendor = '', category = null) {
  const platform = (name) => name === 'AMD' || name === 'Intel';
  // The product's vendor, when the store set a real one (most live parts have it: "Gigabyte", "PNY", "Western
  // Digital"), in the spelling the filters use. The store's own name ("Joy Mobile Merkaz") is never a brand.
  const v = String(vendor || '').trim();
  if (v && !/joy\s*mobile|ג׳וי|ג'וי/i.test(v)) {
    for (const [name, re] of BRANDS) if (re.test(v)) return name;
    return v;
  }
  if (category === 'cpu') for (const [name, re] of BRANDS) if (platform(name) && re.test(title)) return name;
  for (const [name, re] of BRANDS) if (!platform(name) && re.test(title)) return name;
  for (const [name, re] of BRANDS) if (re.test(title)) return name;
  // Else the first Latin word that is not a size, a colour or a filler ("12cm With Cable" has no maker).
  const latin = [...String(title).matchAll(/\b[A-Za-z][A-Za-z0-9-]+/g)].map((m) => m[0]).find((w) => !STOP_WORDS.test(w));
  return latin ? latin.charAt(0).toUpperCase() + latin.slice(1).toLowerCase() : 'אחר';
}

const STOP_WORDS = /^(with|for|and|the|of|to|in|black|white|rgb|argb|usb|type-?c?|pc|cpu|gpu|led|fan|fans|cable|pack|mini|pro|new|gaming)$/i;

/* Titles do not always open with the Hebrew kind: "Antec | Atom V550 | ספק כוח", "Gigabyte B650M D3HP לוח אם". The
   separators go, and the first Hebrew run moves to the front ("ספק כוח Antec Atom V550"), so the kind is read the
   same way and the short name (from the first Latin word) is the model. */
export function cleanTitle(title) {
  let s = String(title || '').replace(/\s*[|｜•·]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (s && !/^[\u0590-\u05FF]/.test(s)) {
    const heb = s.match(/(?:^|\s)([\u0590-\u05FF][\u0590-\u05FF.״"׳'\s-]*[\u0590-\u05FF.])(?=\s|$)/);
    if (heb) s = `${heb[1].trim()} ${(s.slice(0, heb.index) + s.slice(heb.index + heb[0].length)).replace(/\s+/g, ' ').trim()}`.trim();
  }
  return s;
}

/* ---------- category ---------- */

/* What a title is, from its first words (the supplier always starts with the Hebrew kind) and then from the English.
   Returns a step key, 'system' (a whole computer or laptop: not a part) or 'ignore' (spare panels, adapters, cables,
   tools), or null when nothing matched. */
export function categorize(title) {
  const t = ` ${cleanTitle(title)} `;
  const s = t.trim();
  const starts = (re) => re.test(s);

  if (starts(/^(מחשב|מ\.\s?גיימינג|מ\.גיימינג|נייד|נייח|נ\.\s)/) || /\b(zenbook|vivobook|thinkbook|laptop)\b/i.test(t)) return 'system';
  if (starts(/^(זכוכית|סט זכוכיות|פנל|צד (ימין|שמאל)|מסילות|ברגים|לוחץ|רמקול ללוח|מתאם|כבל|כרטיס הרחבה|כרטיס זכרון|כרטיס זיכרון|קופסא|קופסה|תחנת עגינה|מתג|ספק כח ממותג)/)) return 'ignore';
  if (/\b(adapter card|dc adapter|docking|riser)\b/i.test(t)) return 'ignore';

  if (starts(/^מערכת הפעלה/) || /\bwindows\s*1[01]\b/i.test(t)) return 'os';
  if (starts(/^(קירור|ק\.\s?נוזלי|מאורר למעבד|מאוורר למעבד)/)) return 'cooler';
  if (starts(/^(מאוורר|מאורר)/) && /\btdp\b/i.test(t)) return 'cooler';
  if (starts(/^(מאוורר|מאורר|מאווררים)/)) return 'extra';
  if (starts(/^מעבד/)) return 'cpu';
  // "לוח אם", "לוח לאינטל", "לוח למעבדי", "לוח לבן עם מחברי חשמל מאחור", "לוח Gigabyte…"; not "לוח מקשים" or a
  // crimping tool ("לוחץ", above).
  if (starts(/^לוח\s(?:אם|עם|דור|אינטל|לאינטל|למעבד|למעבדי|לבן|שחור|[A-Za-z])/)) return 'board';
  if (starts(/^(ז\.|זכרון|זיכרון)/)) return 'ram';
  if (starts(/^(כרטיס מסך|כ\.\s?מסך)/)) return 'gpu';
  if (starts(/^דיסק/)) return 'storage';
  if (starts(/^ספק/)) return 'psu';
  if (starts(/^מארז/)) return 'case';
  if (starts(/^(משחה טרמית|מסך|מקלדת|סט מקלדת|סט אלחוטי|עכבר|אוזניות|רמקולים|מצלמת|אופיס|אנטי וירוס|תכנת|תוכנת|תומך לכרטיס מסך)/)) return 'extra';

  // English-only titles.
  if (/\bcpu\s*(air\s*)?cooler\b|\bliquid\s*cool|\baio\b/i.test(t)) return 'cooler';
  if (/\bmotherboard\b/i.test(t)) return 'board';
  if (/\bddr[45]\b/i.test(t) && /\d+\s*gb\b/i.test(t) && !/\b(ssd|nvme|geforce|radeon)\b/i.test(t)) return 'ram';
  if (/\b(geforce|rtx\s?\d{4}|radeon\s+rx)\b/i.test(t)) return 'gpu';
  if (/\b(psu|power supply)\b/i.test(t)) return 'psu';
  if (/\b(ssd|nvme|hdd)\b/i.test(t)) return 'storage';
  if (/\bcase\b|\btower\b/i.test(t)) return 'case';
  if (/\b(monitor|keyboard|mouse|headset|webcam|speakers?|anti\s*virus|antivirus)\b/i.test(t)) return 'extra';
  return null;
}

/* ---------- per-kind readers ---------- */

function parseCpu(t) {
  const out = { socket: null, igpu: null, needsCooler: true, watts: null, score: null, model: null };
  const explicit = t.match(/\bLGA\s?(1851|1700)\b/i) || t.match(/\b(AM[45])\b/i);
  if (explicit) out.socket = normalizeSocket(explicit[1]);

  const isAmd = /\bamd\b|\bryzen\b|\bR[3579][\s-]?\d{4}/i.test(t);
  let suffix = '';
  let tier = null;
  let gen = 0;
  const ultra = t.match(/\bultra\s?([579])\b(?:\s*processor)?\s*(2\d{2})([a-z]*)/i);
  const core = t.match(/\bi([3579])[\s-]?(1[2-4])(\d{3})([a-z]*)/i);
  const ryzen = t.match(/(?:\bryzen\s*r?|\br)([3579])[\s-]?([5789])(\d{3})([a-z0-9]*)/i);

  if (!isAmd && ultra) {
    tier = +ultra[1];
    suffix = ultra[3].toUpperCase();
    gen = 3 + (+ultra[2] >= 250 ? 0.5 : 0);
    out.socket ||= 'LGA1851';
    out.model = `Core Ultra ${tier} ${ultra[2]}${suffix}`;
  } else if (!isAmd && core) {
    tier = +core[1];
    suffix = core[4].toUpperCase();
    gen = +core[2] - 12;
    out.socket ||= 'LGA1700';
    out.model = `Core i${tier}-${core[2]}${core[3]}${suffix}`;
  } else if (ryzen) {
    tier = +ryzen[1];
    const series = +ryzen[2];
    suffix = ryzen[4].toUpperCase();
    gen = { 5: 0, 7: 2, 8: 1.5, 9: 3 }[series] ?? 0;
    out.socket ||= series === 5 ? 'AM4' : 'AM5';
    out.model = `Ryzen ${tier} ${series}${ryzen[3]}${suffix}`;
    // Ryzen 5000 desktop parts have no graphics unless they are G; 7000/9000 all have it; F never.
    if (/F/.test(suffix.replace(/X3D2?$/, ''))) out.igpu = false;
    else if (suffix.startsWith('G')) out.igpu = true;
    else out.igpu = series !== 5;
  }
  if (!isAmd && (ultra || core)) out.igpu = !/F/.test(suffix);
  if (/no\s*gpu|no\s*fan\s*\/\s*gpu|ללא\s*גרפיקה/i.test(t)) out.igpu = false;

  // Coolers: tray parts and every K / X part ship without one; only a boxed non-K Intel or non-X AMD has it.
  if (/\bbox\b/i.test(t) && !/K/.test(suffix) && !/X/.test(suffix)) out.needsCooler = false;
  if (/\btray\b|no\s*(fan|cooler)/i.test(t)) out.needsCooler = true;

  // Peak package power: the title when it says ("TDP Max 200W", "max TDP253W", "65W TDP", "117W"), else by family.
  // (the title's figure is often the base TDP, "65W", so the larger of it and the family's peak is kept).
  const w = t.match(/tdp\s*(?:max\s*)?(\d{2,3})\s*w/i) || t.match(/(\d{2,3})\s*w\b/i);
  if (w) out.watts = +w[1];
  if (tier) {
    const k = /K/.test(suffix);
    let family;
    if (isAmd) family = /X3D/.test(suffix) ? (tier === 9 ? 170 : 120) : /X/.test(suffix) ? (tier >= 9 ? 170 : 105) : 65;
    else if (ultra) family = k ? (tier >= 7 ? 250 : 159) : tier >= 7 ? 182 : 121;
    else family = k ? (tier >= 7 ? 253 : 181) : tier >= 7 ? 219 : tier === 5 ? 148 : 89;
    out.watts = Math.max(out.watts || 0, family);
  }
  const cores = t.match(/(\d{1,2})\s*(?:cores|crs|c\b)/i);
  if (tier) out.score = tier * 10 + gen * 8 + (/K/.test(suffix) || /X/.test(suffix) ? 3 : 0) + (cores ? Math.min(+cores[1], 24) * 0.3 : 0);
  out.x3d = /X3D/.test(suffix);
  return out;
}

function parseBoard(t) {
  const out = { socket: null, memory: null, formFactor: null, chipset: null, backConnect: false, wifi: false };
  const chip = t.match(/\b([abhxz])(\d{3})(e)?([mi])?\b/i);
  let chipM = false;
  let chipI = false;
  if (chip) {
    const key = `${chip[1].toUpperCase()}${chip[2]}`;
    if (CHIPSET_SOCKET[key]) {
      out.chipset = `${key}${chip[3] ? 'E' : ''}${chip[4] ? chip[4].toUpperCase() : ''}`;
      out.socket = CHIPSET_SOCKET[key];
      chipM = /m/i.test(chip[4] || '');
      chipI = /i/i.test(chip[4] || '');
    }
  }
  const explicit = t.match(/\bLGA\s?(1851|1700)\b/i) || t.match(/\b(AM[45])\b/i);
  if (explicit) out.socket = normalizeSocket(explicit[1]);

  out.memory = normalizeMemory(t) || (out.socket ? SOCKET_MEMORY[out.socket] : null);
  if (chipM) out.formFactor = 'mATX';
  else if (chipI) out.formFactor = 'Mini-ITX';
  else if (/\be-?atx\b/i.test(t)) out.formFactor = 'E-ATX';
  else if (/\bmini-?itx\b|\bitx\b/i.test(t)) out.formFactor = 'Mini-ITX';
  else if (/\bmicro[\s-]?atx\b|\bm-?atx\b|\bmatx\b/i.test(t)) out.formFactor = 'mATX';
  else if (out.chipset) out.formFactor = 'ATX';
  out.backConnect = /stealth|מחברי חשמל מאחור|back[\s-]?connect/i.test(t);
  out.wifi = /wi-?fi|\bwf\s?\d|\bax\b/i.test(t);
  return out;
}

function parseRam(t) {
  const out = { memory: normalizeMemory(t), capacity: null, modules: 1, speed: null };
  const kit = t.match(/\b([248])\s?x\s?(\d{1,2})\s?(?:gb)?\b/i);
  if (kit) {
    out.modules = +kit[1];
    out.capacity = +kit[1] * +kit[2];
  } else {
    const gbs = [...t.matchAll(/(\d{1,3})\s?gb\b/gi)].map((m) => +m[1]);
    if (gbs.length) out.capacity = Math.max(...gbs);
  }
  const speed = t.match(/(\d{4})\s?mhz/i) || t.match(/ddr[45][\s-](\d{4})\b/i) || t.match(/\b([3-8]\d{3})\b(?=\s*(?:c|cl)\s?\d)/i);
  if (speed) out.speed = +speed[1];
  if (!out.speed) {
    const bare = t.match(/\b(3200|3600|4800|5200|5600|6000|6400|6800|7000|7200|8000)\b/);
    if (bare) out.speed = +bare[1];
  }
  return out;
}

function parseGpu(t) {
  const out = { chip: null, watts: null, score: null, vram: null };
  let m;
  if ((m = t.match(/\brtx\s?pro\s?(\d{4})/i))) out.chip = `RTX PRO ${m[1]}`;
  else if ((m = t.match(/\b(?:rtx\s*)?a(400|1000|2000|4000)\b/i))) out.chip = `RTX A${m[1]}`;
  else if ((m = t.match(/\bgt\s?(\d{4})\b/i))) out.chip = `GT ${m[1]}`;
  else if ((m = t.match(/\brx\s?(\d{4})(?:\s?(xt|gre))?/i))) out.chip = `RX ${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ''}`;
  else if ((m = t.match(/(?:\brtx|\bgeforce)\s?(\d{4})(?:\s?(ti)\b)?/i) || t.match(/\b([2-5]0[5-9]0)(?:\s?(ti)\b)?/i)))
    out.chip = `RTX ${m[1]}${m[2] ? ' Ti' : ''}`;
  const known = out.chip && GPU_TABLE[out.chip];
  if (known) {
    out.watts = known.watts;
    out.score = known.score;
  }
  const v = t.match(/\b(\d{1,2})\s?g(?:b|d)?\b/i);
  if (v) out.vram = +v[1];
  if (out.chip === 'RTX 3050' && out.vram === 6) out.watts = 70;
  return out;
}

function parsePsu(t) {
  const out = { watts: null, rating: null, atx3: false, modular: null };
  let m;
  const w = t.match(/(\d{3,4})\s?w\b/i);
  if (w && +w[1] >= 300) out.watts = +w[1];
  else {
    const candidates = [...t.matchAll(/(?:^|[^\d.])(\d{3,4})(?![\d.])/g)].map((m) => +m[1]).filter((n) => n >= 300 && n <= 2500);
    if (candidates.length) out.watts = candidates[0];
  }
  const r = t.match(/\b(titanium|platinum|gold|silver|bronze|white)\b/i);
  if (r) out.rating = r[1].charAt(0).toUpperCase() + r[1].slice(1).toLowerCase();
  // Model codes that carry the rating: Antec NE1000G (Gold) / NE1200P (Platinum).
  else if ((m = t.match(/\bNE\s?\d{3,4}\s?([GP])\b/i))) out.rating = m[1].toUpperCase() === 'G' ? 'Gold' : 'Platinum';
  out.atx3 = /atx\s?3\.\d|pcie?\s?5\.\d|12v-?2x6|12vhpwr/i.test(t);
  out.modular = /full[\s-]?modular|fully modular|semi[\s-]?modular/i.test(t) ? true : /non[\s-]?modular|none modular|לא מודולרי/i.test(t) ? false : null;
  return out;
}

function parseCase(t) {
  const out = { formFactor: null, backConnect: false };
  if (/\be-?atx\b/i.test(t)) out.formFactor = 'E-ATX';
  else if (/\bmini-?itx\b/i.test(t)) out.formFactor = 'Mini-ITX';
  else if (/\bmicro[\s-]?atx\b|\bm-?atx\b|\bmatx\b|\bmini[\s-]?atx\b/i.test(t)) out.formFactor = 'mATX';
  else if (/\batx\b|\bmid[\s-]?tower|\bfull[\s-]?tower/i.test(t)) out.formFactor = 'ATX';
  else if (/\bmini[\s-]?tower\b/i.test(t)) out.formFactor = 'mATX';
  out.backConnect = /stealth|back[\s-]?connect/i.test(t);
  return out;
}

function parseCooler(t) {
  const out = { type: 'air', tdp: null, radiator: null };
  const rad = t.match(/\b(120|240|280|360|420)\b(?!\s*mm\s*(?:fan|pwm))/i);
  if (/נוזלי|liquid|\baio\b/i.test(t)) {
    out.type = 'liquid';
    if (rad) out.radiator = +rad[1];
  }
  const w = t.match(/(\d{2,3})\s?w\b/i);
  if (w) out.tdp = +w[1];
  else if (out.type === 'liquid') out.tdp = out.radiator >= 360 ? 280 : out.radiator >= 240 ? 230 : 180;
  return out;
}

function parseStorage(t) {
  const out = { kind: null, capacityGb: null, gen: null };
  if (/nvme|m\.?2\b|\bgen\s?[345]\b|\b(9[89]0|9100)\s?(pro|evo)/i.test(t)) out.kind = 'NVMe';
  else if (/rpm|\bhdd\b|barracuda|skyhawk|purple|exos|\bmg\d|s300|3\.5/i.test(t)) out.kind = 'HDD';
  else if (/\bssd\b|2\.5/i.test(t)) out.kind = 'SSD';
  const tb = t.match(/(\d+(?:\.\d+)?)\s?(?:tb|t)\b/i) || t.match(/\b(\d{1,2})b\b/i);
  const gb = t.match(/(\d{3,4})\s?gb\b/i);
  if (tb) out.capacityGb = Math.round(+tb[1] * 1000);
  else if (gb) out.capacityGb = +gb[1];
  const g = t.match(/gen\s?([345])\b/i) || t.match(/pcie\s?([345])\.0/i);
  if (g) out.gen = +g[1];
  else if (out.kind === 'NVMe') {
    // "up to 7250 Read", "3500/2400MB/s": the read speed says the generation.
    const read = t.match(/\b(\d{4,5})\s?(?:\/|mb|read)/i);
    if (read) out.gen = +read[1] >= 10000 ? 5 : +read[1] >= 4500 ? 4 : 3;
  }
  return out;
}

function parseOs(t) {
  return {
    edition: /\bpro(fessional)?\b/i.test(t) ? 'Pro' : 'Home',
    language: /עברית|hebrew/i.test(t) ? 'he' : /אנגלית|english/i.test(t) ? 'en' : null,
  };
}

function parseExtra(t) {
  let kind = 'other';
  if (/^(מאוורר|מאורר|מאווררים)/.test(t)) kind = 'fan';
  else if (/^משחה/.test(t)) kind = 'paste';
  else if (/^מסך|\bmonitor\b/i.test(t)) kind = 'monitor';
  else if (/^(מקלדת|סט)/.test(t) || /\bkeyboard\b/i.test(t)) kind = 'keyboard';
  else if (/^עכבר|\bmouse\b/i.test(t)) kind = 'mouse';
  else if (/^אוזניות|\bheadset\b/i.test(t)) kind = 'headset';
  else if (/^(אופיס|אנטי|תכנת|תוכנת)|\banti\s*virus\b/i.test(t)) kind = 'software';
  return { kind };
}

const READERS = {
  cpu: parseCpu,
  board: parseBoard,
  ram: parseRam,
  gpu: parseGpu,
  psu: parsePsu,
  case: parseCase,
  cooler: parseCooler,
  storage: parseStorage,
  os: parseOs,
  extra: parseExtra,
};

/* The facts a kind needs before the builder can check it; the coverage report counts parts missing any of them. */
export const REQUIRED_FACTS = {
  cpu: ['socket', 'igpu', 'watts'],
  board: ['socket', 'memory', 'formFactor'],
  ram: ['memory', 'capacity'],
  gpu: ['chip', 'watts'],
  psu: ['watts'],
  case: ['formFactor'],
  cooler: ['type'],
  storage: ['kind', 'capacityGb'],
  os: ['edition'],
  extra: [],
};

/* ---------- product → part ---------- */

/** Reads one title (plus optional pc.* overrides) into a part's facts. */
export function parseTitle(title, overrides = {}) {
  const raw = cleanTitle(title);
  const forced = overrides.category && String(overrides.category).trim().toLowerCase();
  const category = forced ? (forced === 'none' ? 'ignore' : forced) : categorize(raw);
  const facts = READERS[category] ? READERS[category](raw) : {};
  const fromMeta = [];
  const set = (key, value) => {
    if (value === null || value === undefined || value === '') return;
    facts[key] = value;
    fromMeta.push(key);
  };
  if (overrides && Object.keys(overrides).length) {
    set('socket', normalizeSocket(overrides.socket));
    set('memory', normalizeMemory(overrides.memory));
    set('formFactor', normalizeFormFactor(overrides.form_factor));
    const watts = num(overrides.watts);
    if (watts) set('watts', watts);
    const ctdp = num(overrides.cooler_tdp);
    if (ctdp) set('tdp', ctdp);
    set('igpu', bool(overrides.igpu));
    set('needsCooler', bool(overrides.needs_cooler));
    set('backConnect', bool(overrides.back_connect));
  }
  const missing = (REQUIRED_FACTS[category] || []).filter((k) => facts[k] === null || facts[k] === undefined);
  return { category, facts, fromMeta, missing };
}

/** A Shopify product (products.json shape) → a part, or null when it cannot be sold (no available variant). */
export function toPart(product, overrides = {}) {
  const variants = product.variants || [];
  const variant = variants.find((v) => v.available !== false) || null;
  if (!variant) return null;
  const { category, facts, fromMeta, missing } = parseTitle(product.title, overrides);
  const image = (product.images && product.images[0] && (product.images[0].src || product.images[0])) || (variant.featured_image && variant.featured_image.src) || null;
  return {
    id: product.id,
    variantId: variant.id,
    handle: product.handle,
    title: cleanTitle(product.title),
    price: num(variant.price) || 0,
    image,
    sku: variant.sku || null,
    brand: brandOf(cleanTitle(product.title), product.vendor, category),
    category,
    facts,
    fromMeta,
    missing,
  };
}

/* ---------- compatibility ---------- */

export const BASE_WATTS = 60; // board, memory, drives, fans

/** Estimated peak draw of a selection, and the PSU size it calls for (×1.5, rounded up to 50 W, at least 450 W). */
export function powerOf(sel) {
  const cpu = sel.cpu?.facts?.watts || (sel.cpu ? 125 : 0);
  const gpu = sel.gpu ? sel.gpu.facts.watts || 250 : 0;
  const draw = BASE_WATTS + cpu + gpu;
  const recommended = Math.max(450, Math.ceil((draw * 1.5) / 50) * 50);
  return { draw, recommended, psu: sel.psu?.facts?.watts || null };
}

const fmtW = (w) => `${w}W`;

/* Facts in words, for the reason a part with a missing fact cannot be chosen. */
const FACT_LABELS = {
  socket: 'תושבת',
  memory: 'סוג זיכרון',
  formFactor: 'גודל',
  watts: 'הספק',
  igpu: 'גרפיקה מובנית',
  capacity: 'נפח',
  capacityGb: 'נפח',
  chip: 'דגם',
  kind: 'סוג',
  type: 'סוג',
  edition: 'גרסה',
};

/* A cooler that does not state its rating is trusted only up to this (W). */
export const UNRATED_COOLER_MAX = 150;

/** Why `part` cannot go with what is already chosen (hard reasons), and what to double-check (soft). */
export function fitOf(part, sel) {
  const reasons = [];
  const notes = [];
  const f = part.facts;
  // Strict: a part whose title (and pc.* metafields) does not give a fact the checks need is never matched blindly.
  if (part.missing && part.missing.length)
    reasons.push(`חסר בשם המוצר: ${[...new Set(part.missing.map((k) => FACT_LABELS[k] || k))].join(', ')}. נציג יכול לבדוק בשבילכם`);
  const cpu = part.category === 'cpu' ? part : sel.cpu;
  const board = part.category === 'board' ? part : sel.board;
  const ram = part.category === 'ram' ? part : sel.ram;
  const kase = part.category === 'case' ? part : sel.case;
  const cooler = part.category === 'cooler' ? part : sel.cooler;

  switch (part.category) {
    case 'cpu':
    case 'board': {
      const other = part.category === 'cpu' ? board : cpu;
      if (other && other !== part && other.facts.socket && f.socket && other.facts.socket !== f.socket)
        reasons.push(part.category === 'cpu' ? `תושבת ${f.socket}, והלוח שנבחר הוא ${other.facts.socket}` : `תושבת ${f.socket}, והמעבד שנבחר הוא ${other.facts.socket}`);
      if (part.category === 'board') {
        if (ram && ram.facts.memory && f.memory && ram.facts.memory !== f.memory) reasons.push(`הלוח תומך ב-${f.memory}, והזיכרון שנבחר הוא ${ram.facts.memory}`);
        if (kase && kase.facts.formFactor && f.formFactor && ffRank(f.formFactor) > ffRank(kase.facts.formFactor)) reasons.push(`לוח ${f.formFactor} לא נכנס למארז ${kase.facts.formFactor}`);
        if (kase && f.backConnect && !kase.facts.backConnect) reasons.push('לוח עם מחברים מאחור צריך מארז שתומך בזה');
      }
      if (part.category === 'cpu') {
        const mem = ram?.facts.memory;
        const need = f.socket ? SOCKET_MEMORY[f.socket] : null;
        if (!board && mem && need && mem !== need) reasons.push(`המעבד עובד עם ${need}, והזיכרון שנבחר הוא ${mem}`);
        if (cooler && cooler.facts.tdp && f.watts && cooler.facts.tdp + 10 < f.watts) reasons.push(`המעבד מגיע ל-${fmtW(f.watts)}, והקירור שנבחר מתאים עד ${fmtW(cooler.facts.tdp)}`);
        if (cooler && !cooler.facts.tdp && f.watts > UNRATED_COOLER_MAX) reasons.push(`המעבד מגיע ל-${fmtW(f.watts)}, ודירוג הקירור שנבחר לא מצוין`);
      }
      break;
    }
    case 'ram': {
      if (board && board.facts.memory && f.memory && board.facts.memory !== f.memory) reasons.push(`הלוח שנבחר תומך ב-${board.facts.memory} בלבד`);
      else if (!board && cpu && f.memory) {
        const need = SOCKET_MEMORY[cpu.facts.socket];
        if (need && need !== f.memory) reasons.push(`המעבד שנבחר עובד עם ${need}`);
      }
      break;
    }
    case 'case': {
      if (board && board.facts.formFactor && f.formFactor && ffRank(board.facts.formFactor) > ffRank(f.formFactor)) reasons.push(`מארז ${f.formFactor}, והלוח שנבחר הוא ${board.facts.formFactor}`);
      if (board && board.facts.backConnect && !f.backConnect) reasons.push('הלוח שנבחר מחבר כבלים מאחור, והמארז לא תומך בזה');
      break;
    }
    case 'cooler': {
      if (cpu && cpu.facts.watts && f.tdp && f.tdp + 10 < cpu.facts.watts) reasons.push(`מתאים עד ${fmtW(f.tdp)}, והמעבד שנבחר מגיע ל-${fmtW(cpu.facts.watts)}`);
      if (cpu && cpu.facts.watts > UNRATED_COOLER_MAX && !f.tdp) reasons.push(`הדירוג לא מצוין, והמעבד שנבחר מגיע ל-${fmtW(cpu.facts.watts)}`);
      break;
    }
    case 'psu':
    case 'gpu': {
      const next = { ...sel, [part.category]: part };
      const p = powerOf(next);
      if (p.psu && p.psu < p.recommended)
        reasons.push(part.category === 'psu' ? `${fmtW(p.psu)}, והמחשב צריך לפחות ${fmtW(p.recommended)}` : `צריך ספק של ${fmtW(p.recommended)} לפחות, והספק שנבחר הוא ${fmtW(p.psu)}`);
      break;
    }
    default:
  }
  return { ok: reasons.length === 0, reasons, notes };
}

/** Which steps the selection still needs. */
export function requiredSteps(sel) {
  const req = ['cpu', 'board', 'ram', 'storage', 'psu', 'case'];
  if (!sel.cpu || sel.cpu.facts.igpu === false || sel.cpu.facts.igpu === null) req.splice(3, 0, 'gpu');
  if (!sel.cpu || sel.cpu.facts.needsCooler !== false) req.push('cooler');
  return req;
}

/** The whole build: problems between chosen parts, what is missing, and notes to double-check. */
export function checkBuild(sel) {
  const problems = [];
  const notes = [];
  // Each part against the parts of the steps before it only, so every clashing pair is reported once (the step order
  // puts every part after what it depends on: board after CPU, memory after board, PSU after CPU and card…).
  const before = {};
  for (const key of STEP_KEYS) {
    const part = key === 'extra' ? null : sel[key];
    if (part) {
      const fit = fitOf(part, before);
      fit.reasons.forEach((r) => problems.push({ step: key, text: r }));
      fit.notes.forEach((n) => notes.push({ step: key, text: n }));
      before[key] = part;
    }
  }
  // Notes that only show from the later side (memory to confirm on a board that does not say): ask the later part too.
  for (const key of STEP_KEYS) {
    if (key === 'extra' || !sel[key]) continue;
    fitOf(sel[key], { ...sel, [key]: undefined }).notes.forEach((n) => notes.push({ step: key, text: n }));
  }
  const missing = requiredSteps(sel).filter((k) => !sel[k]);
  const power = powerOf(sel);
  return { ok: problems.length === 0 && missing.length === 0, problems, missing, notes: [...new Map(notes.map((n) => [n.text, n])).values()], power };
}

/** The parts of the steps before `key`: what a part of that step must fit. */
export function earlierOf(sel, key) {
  const out = {};
  for (const k of STEP_KEYS) {
    if (k === key) break;
    if (k !== 'extra' && sel[k]) out[k] = sel[k];
  }
  return out;
}

/** Keeps, in step order, only the parts that fit everything kept before them (a shared link, a saved build, the
    last check before the cart). Returns the clean selection and what was dropped, with the reason. */
export function sanitize(sel) {
  const kept = {};
  const removed = [];
  for (const k of STEP_KEYS) {
    if (k === 'extra' || !sel[k]) continue;
    const fit = fitOf(sel[k], kept);
    if (fit.ok) kept[k] = sel[k];
    else removed.push({ step: k, part: sel[k], reason: fit.reasons[0] });
  }
  return { sel: { ...kept, extra: [...(sel.extra || [])] }, removed };
}

/** Chooses `part` and drops every other chosen part that no longer fits it (the new choice wins). */
export function applyChoice(sel, part) {
  const key = part.category;
  const kept = { [key]: part };
  const removed = [];
  for (const k of STEP_KEYS) {
    if (k === key || k === 'extra' || !sel[k]) continue;
    const fit = fitOf(sel[k], kept);
    if (fit.ok) kept[k] = sel[k];
    else removed.push({ step: k, part: sel[k], reason: fit.reasons[0] });
  }
  const out = {};
  for (const k of STEP_KEYS) if (k !== 'extra' && kept[k]) out[k] = kept[k];
  return { sel: { ...out, extra: [...(sel.extra || [])] }, removed };
}

/** Payments (the owner: interest-free up to 4, up to 12 with interest). `free` interest-free payments of the total
    divided and rounded up to whole shekels; `max` only when it is more than `free` (no monthly sum is claimed for it,
    since the interest is the card company's). Null when there is nothing to show. */
export function installmentsOf(total, free, max) {
  const n = Math.floor(Number(free) || 0);
  const t = Number(total) || 0;
  if (n < 2 || t <= 0) return null;
  const m = Math.floor(Number(max) || 0);
  return { count: n, each: Math.ceil(t / n), max: m > n ? m : null };
}

/** Whether a selection may go to the cart (or into a quote): complete for its required steps, and every pair fits. */
export const isOrderable = (sel) => checkBuild(sel).ok;

/* ---------- guided builds ----------
   Start from the cheapest complete, compatible computer for the use, then keep taking the upgrade that adds the most
   (weighted for the use) per shekel while the total stays within the tier's target. An upgrade may pull others along
   (a processor on another socket needs another board and maybe other memory; a stronger card may need a bigger PSU):
   repair() swaps exactly the parts that stop fitting for the cheapest ones that fit, and that cost counts. */

export const USES = {
  gaming: { label: 'גיימינג', weights: { gpu: 4, cpu: 1.8, ram: 0.5, storage: 0.4, board: 0.25, case: 0.2 }, gpu: true, storage: 1000 },
  work: { label: 'עבודה ועריכה', weights: { cpu: 4, gpu: 1.6, ram: 1.4, storage: 0.8, board: 0.25, case: 0.1 }, gpu: true, storage: 1000 },
  office: { label: 'משרד ולימודים', weights: { cpu: 2, ram: 0.6, storage: 0.8, board: 0.1, case: 0.2 }, gpu: false, storage: 500 },
};

export const TIERS = [
  { key: 'value', label: 'חסכוני', factor: 0.75 },
  { key: 'recommended', label: 'מומלץ', factor: 1 },
  { key: 'power', label: 'חזק', factor: 1.25 },
];

const RATING_RANK = { White: 0, Bronze: 1, Silver: 2, Gold: 3, Platinum: 4, Titanium: 5 };
const BOARD_VALUE_CAP = 1300;
const CASE_VALUE_CAP = 700;
/* From this target up, a guided build gets a full-chipset board (not H/A) and an 80 Plus Gold PSU, when the collection
   has one that fits: a ₪10,000 computer is not built on the cheapest board and supply. */
export const PREMIUM_TARGET = 9000;

function scoreOf(part, use) {
  const f = part.facts;
  switch (part.category) {
    case 'cpu': return (f.score || part.price / 100) + (use === 'gaming' && f.x3d ? 12 : 0);
    case 'gpu': return f.score || part.price / 100;
    case 'ram': return (f.capacity || 0) * 2 + (f.speed || 0) / 400;
    case 'storage': return Math.min(f.capacityGb || 0, 4000) / 50 + (f.gen || 3) * 4;
    case 'psu': return (RATING_RANK[f.rating] ?? 1) * 10 + (f.atx3 ? 3 : 0) + Math.min(f.watts || 0, 1200) / 100;
    // Past a point a dearer case or board buys looks and ports, not speed: the upgrade loop stops there.
    case 'case': return Math.min(part.price, CASE_VALUE_CAP) / 50 - (/no\s*fans?|בלי מאווררים|ללא מאווררים/i.test(part.title) ? 15 : 0);
    case 'board': return Math.min(part.price, BOARD_VALUE_CAP) / 50;
    default: return part.price / 50; // cooler: the dearer one is the better-made one
  }
}

/* Guided builds only: an unlocked or 170W+ processor goes on a board of a full chipset (Z/X/B), not an entry one (H/A).
   A guided build uses only coolers that state their rating (the step-by-step list still offers an unrated one for a
   processor up to 150W), and a PSU needs an 80 Plus Bronze rating or better.
   Coolers and PSUs are never "upgraded": the cheapest that carries the processor and the card is the right one. */
const suits = (key, cpu, part) => {
  if (key === 'cooler') return !!part.facts.tdp;
  if (key === 'psu') return (RATING_RANK[part.facts.rating] ?? 0) >= 1;
  if (!cpu) return true;
  if (key === 'board') return (cpu.facts.watts || 0) < 170 || !/^[HA]/.test(part.facts.chipset || '');
  return true;
};

const sum = (sel) => Object.values(sel).reduce((s, p) => s + (p ? p.price : 0), 0);
const ORDER = ['cpu', 'board', 'ram', 'gpu', 'storage', 'cooler', 'case', 'psu', 'os'];

export function groupParts(parts) {
  const byCat = Object.fromEntries(STEP_KEYS.map((k) => [k, []]));
  for (const p of parts) if (byCat[p.category]) byCat[p.category].push(p);
  return byCat;
}

/** The parts a guided build may use, per step, for a use and a target. */
function poolsFor(byCat, use, target) {
  const u = USES[use];
  const ramMin = use === 'office' || target < (use === 'work' ? 5000 : 7000) ? 16 : 32;
  const ramMax = use === 'work' && target >= 12000 ? 64 : use === 'office' ? 32 : 32;
  // Rear-connector boards are a choice of looks that also ties the case: the step-by-step list has them, guided builds don't.
  const boards = byCat.board.filter((b) => b.facts.socket && b.facts.memory && b.facts.formFactor && !b.facts.backConnect);
  let cpus = byCat.cpu.filter((c) => c.facts.socket && c.facts.igpu !== null && boards.some((b) => b.facts.socket === c.facts.socket));
  // An office computer: a processor with graphics (no card to buy); nothing unlocked, no 9-series, under 170W.
  if (!u.gpu && cpus.some((c) => c.facts.igpu)) cpus = cpus.filter((c) => c.facts.igpu && (c.facts.watts || 0) < 170 && !/\dKF?$/.test(c.facts.model || '') && !/(?:i|Ultra |Ryzen )9/.test(c.facts.model || ''));
  const rams = byCat.ram.filter((r) => r.facts.memory && r.facts.capacity >= ramMin && r.facts.capacity <= ramMax);
  const nvme = byCat.storage.filter((d) => d.facts.kind === 'NVMe' && d.facts.capacityGb >= u.storage * 0.9 && d.facts.capacityGb <= 4000);
  const gpus = byCat.gpu.filter((g) => g.facts.watts && (u.gpu ? (g.facts.score || 0) >= 20 : true));
  const pools = {
    cpu: cpus,
    board: boards,
    ram: rams.length ? rams : byCat.ram.filter((r) => r.facts.memory && r.facts.capacity),
    gpu: gpus,
    storage: nvme.length ? nvme : byCat.storage.filter((d) => d.facts.capacityGb),
    cooler: byCat.cooler,
    case: byCat.case.filter((c) => c.facts.formFactor),
    psu: byCat.psu.filter((p) => p.facts.watts),
  };
  for (const [k, list] of Object.entries(pools)) pools[k] = list.filter((p) => !p.missing?.length).sort((a, b) => a.price - b.price);
  if (target >= PREMIUM_TARGET) {
    const full = pools.board.filter((b) => !/^[HA]/.test(b.facts.chipset || ''));
    // Only on sockets that keep a board: a socket left without one would just drop out of the build.
    const sockets = new Set(full.map((b) => b.facts.socket));
    if (full.length) pools.board = pools.board.filter((b) => !/^[HA]/.test(b.facts.chipset || '') || !sockets.has(b.facts.socket));
    const gold = pools.psu.filter((p) => (RATING_RANK[p.facts.rating] ?? 0) >= RATING_RANK.Gold);
    if (gold.length) pools.psu = gold;
  }
  const range = {};
  for (const [k, list] of Object.entries(pools)) {
    const s = list.map((p) => scoreOf(p, use));
    range[k] = [Math.min(...s), Math.max(...s)];
  }
  return { pools, range };
}

const needs = (key, sel, use) => {
  if (key === 'gpu') return USES[use].gpu || sel.cpu?.facts.igpu === false;
  if (key === 'cooler') return sel.cpu?.facts.needsCooler !== false;
  return true;
};

/** Replace every part (but `keep`) that is missing, needed and absent, or no longer fits, by the cheapest that fits. */
function repair(sel, pools, use, keep) {
  const out = { ...sel };
  for (const key of ORDER) {
    if (key === 'cpu' || key === 'os' || key === keep) continue;
    if (!needs(key, out, use)) {
      delete out[key];
      continue;
    }
    const rest = { ...out, [key]: undefined };
    if (out[key] && fitOf(out[key], rest).ok && suits(key, out.cpu, out[key])) continue;
    const next = pools[key].find((p) => fitOf(p, rest).ok && suits(key, out.cpu, p));
    if (!next) return null;
    out[key] = next;
  }
  return out;
}

/* With games chosen, closing the gap to their target frame rates is worth more than anything else the budget buys. */
export const AIM_WEIGHT = 800;

function valueOf(sel, use, range, aim) {
  const w = USES[use].weights;
  const norm = {};
  let v = 0;
  for (const [k, p] of Object.entries(sel)) {
    if (!p || !range[k]) continue;
    const [lo, hi] = range[k];
    norm[k] = hi > lo ? ((scoreOf(p, use) - lo) / (hi - lo)) * 100 : 50;
    v += (w[k] || 0) * norm[k];
  }
  // Balance: a strong card held back by a weak processor (or the other way round) is money badly spent.
  if (norm.gpu !== undefined && norm.cpu !== undefined && USES[use].gpu) v -= 3 * Math.max(0, Math.abs(norm.gpu - norm.cpu) - 35);
  if (aim && aim.score) v += AIM_WEIGHT * aim.score(sel);
  return v;
}

/** Keeps taking the upgrade with the most value per shekel while the total stays within `budget`. */
function upgrade(start, pools, range, use, budget, aim) {
  let best = start;
  for (let round = 0; round < 60; round++) {
    const base = valueOf(best, use, range, aim);
    const cost0 = sum(best);
    let pickSel = null;
    let pickRate = 0;
    for (const key of ['cpu', 'gpu', 'ram', 'storage', 'board', 'case', 'cooler', 'psu']) {
      if (!best[key] || !USES[use].weights[key]) continue;
      const cur = scoreOf(best[key], use);
      const seen = new Set();
      for (const cand of pools[key]) {
        const s = scoreOf(cand, use);
        if (s <= cur || seen.has(s) || cand.price - best[key].price > budget - cost0 + 1500) continue;
        seen.add(s); // pools are sorted by price: the first part with a score is the cheapest with it
        const trial = repair({ ...best, [key]: cand }, pools, use, key);
        if (!trial || !fitOf(cand, { ...trial, [key]: undefined }).ok || !suits(key, trial.cpu, cand)) continue;
        const cost = sum(trial);
        if (cost > budget) continue;
        const gain = valueOf(trial, use, range, aim) - base;
        if (gain <= 0) continue;
        const rate = cost <= cost0 ? Infinity : gain / (cost - cost0);
        if (rate > pickRate) {
          pickRate = rate;
          pickSel = trial;
        }
      }
    }
    if (!pickSel) break;
    best = pickSel;
  }
  return best;
}

/** One build for `target` shekels. */
export function planBuild(byCat, { use = 'gaming', target = 6000, includeOs = true, aim = null } = {}) {
  const { pools, range } = poolsFor(byCat, use, target);
  let os = null;
  if (includeOs) {
    const home = byCat.os.filter((o) => o.facts.edition === 'Home');
    const he = home.filter((o) => o.facts.language === 'he');
    os = (he.length ? he : home.length ? home : byCat.os).slice().sort((a, b) => a.price - b.price)[0] || null;
  }
  const withOs = (sel) => (os ? { ...sel, os } : sel);
  // The cheapest complete computer on each socket, and from each the best upgrades: a platform is not chosen by its
  // cheapest processor alone (an AM4 start never pays for the board and memory an AM5 processor needs).
  const starts = new Map();
  for (const cpu of pools.cpu) {
    const sel = repair({ cpu }, pools, use);
    const prev = starts.get(cpu.facts.socket);
    if (sel && (!prev || sum(sel) < sum(prev))) starts.set(cpu.facts.socket, sel);
  }
  if (!starts.size) return withOs({});
  const budget = target - (os ? os.price : 0);
  let best = null;
  let bestValue = -Infinity;
  for (const start of starts.values()) {
    const sel = upgrade(start, pools, range, use, budget, aim);
    // Over the budget whatever we do: the cheapest one wins.
    const value = sum(sel) > budget ? -1e9 - sum(sel) : valueOf(sel, use, range, aim);
    if (value > bestValue || (value === bestValue && sum(sel) < sum(best))) {
      best = sel;
      bestValue = value;
    }
  }
  return withOs(best);
}

/** Three builds (חסכוני / מומלץ / חזק) for a use and a budget; each one passes checkBuild. `aim` (optional):
    { score(sel) → 0…1 }, how close a selection comes to the chosen games' target frame rates (pc-builder-fps.js). */
export function planBuilds(parts, { use = 'gaming', budget = 6000, includeOs = true, aim = null } = {}) {
  const byCat = groupParts(parts);
  return TIERS.map((tier) => {
    const target = budget * tier.factor;
    const sel = planBuild(byCat, { use, target, includeOs, aim });
    const ordered = Object.fromEntries(ORDER.filter((k) => sel[k]).map((k) => [k, sel[k]]));
    return { ...tier, target, parts: ordered, total: sum(ordered), check: checkBuild(ordered) };
  });
}

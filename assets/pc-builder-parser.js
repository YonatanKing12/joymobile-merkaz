/* ==========================================================================
   pc-builder-parser.js — the PC builder's pure logic (no DOM): what a product is, what it fits, and the builds.
   Loaded by assets/pc-builder.js (dynamic import of the URL sections/pc-builder prints) and by the Node harness in
   .github/pc-builder (coverage over the supplier's titles, unit tests, the static preview).

   The supplier's parts (Mor Levi, national drop-ship) arrive with a Hebrew + English title only: no vendor, no product
   type, no compatibility fields. So everything here is read from the title, and a product metafield in the "pcb"
   namespace (else the first name "pc"; written below as pc.*) wins over the title when it is set (sections/pc-builder
   prints those as JSON):
     pc.category      cpu | board | ram | gpu | storage | cooler | psu | case | os | extra | none (hide)
     pc.socket        LGA1851 | LGA1700 | AM5 | AM4                     (CPU, board)
     pc.memory        DDR4 | DDR5                                       (board, RAM)
     pc.form_factor   E-ATX | ATX | mATX | Mini-ITX                     (board; for a case, the largest board it takes)
     pc.watts         number                                            (PSU output; CPU or GPU peak draw)
     pc.cooler_tdp    number                                            (the most a cooler is rated for)
     pc.igpu          true | false                                      (CPU has graphics)
     pc.needs_cooler  true | false                                      (CPU sold without a cooler)
     pc.back_connect  true | false                                      (board with rear connectors; a case for them)
   Quantities (several of a part) read these, all optional (pc.* number metafields):
     pc.ram_slots     number    (board: memory slots)          pc.max_memory  number (board: most memory it takes, GB)
     pc.m2_slots      number    (board: M.2 slots)             pc.sata_ports  number (board: SATA ports)
     pc.pcie_x16      number    (board: PCIe x16 length slots) pc.cpu_sockets number (board: processor sockets, 2 = dual)
     pc.pcie_8pin     number    (PSU: PCIe 8-pin connectors it has; graphics card: the 8-pin inputs it needs)
     pc.pcie_16pin    number    (PSU: 12V-2x6 connectors it has; graphics card: 1 when it takes one)
   Without them a board gets safe defaults (BOARD_DEFAULTS): up to 4 memory modules, 2 M.2, 4 SATA, 2 x16 slots and one
   socket (a Mini-ITX board: 2 modules and one x16 slot, which the size itself fixes). Past what every board has
   (BOARD_SURE) a default is "לא אומת", never a block; a known value that is exceeded blocks.

   Strict compatibility: a part missing a fact its checks need (REQUIRED_FACTS) never fits anything until a pc.*
   metafield gives it; a cooler with no rating fits processors up to UNRATED_COOLER_MAX only. applyChoice() drops the
   chosen parts a new choice no longer fits, sanitize() cleans a selection from a link or a saved build, and
   checkBuild().ok (isOrderable) is what the cart and the quote require.

   Lior's six rules (lior()) add, from SPECS (verified maker data by SKU), a description and the title: card length,
   cooler height and radiators against the case; cooler sockets and RAM clearance; 12V-2x6 cards on ATX 3 PSUs; +100W headroom;
   M.2 length; rear-connector and E-ATX cases. Both sides known and clashing: a hard reason (blocked). Soft advice
   (BIOS update, an entry board under a hot processor, one DDR5 stick, XMP vs EXPO, the card maker's PSU, a Gen5
   drive in a Gen4 slot, no USB-C header): notes. A side unknown: `unverified` ("לא אומת: נציג יאשר לפני ההרכבה"),
   which never blocks the order and travels with it to the cart.
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

/* ---------- verified specs, by the supplier's SKU ----------
   What the titles never say (card length, case clearances, cooler height and sockets, the PSU's ATX version, a
   board's internal headers), copied from the maker's own product page for these exact models (Nov 2026; every URL is
   in .github/pc-builder/spec-sources.json). Only verified values: a model that is not here stays "not verified" in
   the builder, never "fits". A colour variant shares its entry only when the maker's page covers both colours.
     GPU     len, thick (mm), psu (maker's recommended PSU, W), pin16 (12V-2x6 / 16-pin power), rad (own radiator, mm)
     case    gpu (max card length), cooler (max air-cooler height), rad (largest radiator per position), usbc (front
             USB-C: 'gen1' | 'gen2' | 'gen2x2' | false), fans (included), hub (fan/ARGB hub included), ff, back
     cooler  h (height with fans), sockets, ram (RAM height clearance with the front fan)
     psu     atx3 (true: ATX 3.x; false: the maker lists an older ATX12V version)
     board   usbc (front USB-C header), fans (system fan headers), argb (addressable LED headers), m2gen (fastest M.2) */
const S = (o) => Object.freeze(o);
const DESKTOP_SOCKETS = ['LGA1851', 'LGA1700', 'AM5', 'AM4'];
export const SPECS = {
  gpu: {
    GVN50701220: S({ len: 327, thick: 56, psu: 750, pin16: true }), // RTX 5070 GAMING OC
    GVN50701230: S({ len: 324, thick: 56, psu: 750, pin16: true }), // RTX 5070 AERO OC
    GVN50701210: S({ len: 290, thick: 50, psu: 750, pin16: true }), // RTX 5070 EAGLE OC SFF
    GVN50701250: S({ len: 290, thick: 50, psu: 750, pin16: true }), // RTX 5070 EAGLE OC ICE SFF
    GVN50701200: S({ len: 282, thick: 50, psu: 750, pin16: true }), // RTX 5070 WINDFORCE OC SFF
    GVN507T001: S({ len: 304, thick: 50, psu: 750, pin16: true }), // RTX 5070 Ti WINDFORCE SFF
    GVN507T020: S({ len: 304, thick: 50, psu: 750, pin16: true }), // RTX 5070 Ti EAGLE OC SFF
    GVN507T023: S({ len: 304, thick: 50, psu: 750, pin16: true }), // RTX 5070 Ti EAGLE OC ICE SFF
    GVN50801605: S({ len: 304, thick: 50, psu: 850, pin16: true }), // RTX 5080 WINDFORCE OC SFF
    GVN50801640: S({ len: 340, thick: 70, psu: 850, pin16: true }), // RTX 5080 GAMING OC
    GVN50801630: S({ len: 304, thick: 50, psu: 850, pin16: true }), // RTX 5080 AERO OC SFF
    GVN50801660: S({ len: 360, thick: 75, psu: 850, pin16: true }), // AORUS RTX 5080 MASTER
    GVN50801665: S({ len: 360, thick: 75, psu: 850, pin16: true }), // AORUS RTX 5080 MASTER ICE
    GVN50801670: S({ len: 220, thick: 40, psu: 850, pin16: true, rad: 360 }), // AORUS RTX 5080 XTREME WATERFORCE
    'GVN5060-8120': S({ len: 208, thick: 40, psu: 550, pin16: false }), // RTX 5060 EAGLE OC
    'GVN5060-8110': S({ len: 208, thick: 40, psu: 550, pin16: false }), // RTX 5060 EAGLE OC ICE
    'GVN5060-8140': S({ len: 281, thick: 40, psu: 550, pin16: false }), // RTX 5060 GAMING OC
    'GVN5060-8150': S({ len: 281, thick: 40, psu: 550, pin16: false }), // RTX 5060 AERO OC
    'GVN5060-8160': S({ len: 182, thick: 36, psu: 550, pin16: false }), // RTX 5060 OC Low Profile
    'GVN506T-820': S({ len: 215, thick: 40, psu: 650, pin16: false }), // RTX 5060 Ti EAGLE OC 8G
    'GVN506T-830': S({ len: 281, thick: 40, psu: 650, pin16: false }), // RTX 5060 Ti GAMING OC 8G
    'GVN506T-0825': S({ len: 208, thick: 40, psu: 650, pin16: false }), // RTX 5060 Ti WINDFORCE MAX OC 8G
    'GVN506T-1625': S({ len: 208, thick: 40, psu: 650, pin16: false }), // RTX 5060 Ti WINDFORCE MAX OC 16G
    'GVN5050-801': S({ len: 199, thick: 40, psu: 550, pin16: false }), // RTX 5050 WINDFORCE OC
    'GVN5050-821': S({ len: 280, thick: 40, psu: 550, pin16: false }), // RTX 5050 GAMING OC
    GVN30601221: S({ len: 198, thick: 39, psu: 550, pin16: false }), // RTX 3060 WINDFORCE OC 12G rev 2.0
    GVN3050622: S({ len: 191, thick: 36, psu: 300, pin16: false }), // RTX 3050 WINDFORCE OC V2 6G
    GVR9070201: S({ len: 288, thick: 56, psu: 850, pin16: false }), // RX 9070 XT GAMING OC
    GVR9070222: S({ len: 339, thick: 59, psu: 850, pin16: false }), // AORUS RX 9070 XT ELITE
    GVR9070010: S({ len: 288, thick: 50, psu: 750, pin16: false }), // RX 9070 GAMING OC
    GVR9060X1600: S({ len: 281, thick: 40, psu: 450, pin16: false }), // RX 9060 XT GAMING OC 16G
  },
  case: {
    'AN1-FLUX-M': S({ gpu: 405, cooler: 175, rad: { top: 360 }, usbc: 'gen2', fans: 6 }),
    'AN1-C5AR': S({ gpu: 410, cooler: 160, rad: { top: 360, side: 280, bottom: 360 }, usbc: 'gen2', fans: 7 }),
    'AN1-C5CAB': S({ gpu: 410, cooler: 160, rad: { top: 360, side: 280, bottom: 360 }, usbc: 'gen2', fans: 4 }),
    'AN1-C5CAW': S({ gpu: 410, cooler: 160, rad: { top: 360, side: 280, bottom: 360 }, usbc: 'gen2', fans: 4 }),
    'AN1-C3AR': S({ gpu: 415, cooler: 160, rad: { top: 360, side: 240 }, usbc: 'gen2', fans: 4 }),
    'AN1-C3ARW': S({ gpu: 415, cooler: 160, rad: { top: 360, side: 240 }, usbc: 'gen2', fans: 4 }),
    'AN1-C8-W': S({ gpu: 440, cooler: 175, rad: { top: 360, side: 360, bottom: 360 }, usbc: 'gen2' }),
    'AN1-P30ARGB': S({ gpu: 405, cooler: 175, rad: { front: 240, top: 360 }, usbc: 'gen2', fans: 5 }),
    'AN1-P30': S({ gpu: 405, cooler: 175, rad: { front: 240, top: 360 }, usbc: 'gen2', fans: 5 }),
    'AN1-P7': S({ gpu: 405, cooler: 175, rad: { front: 240, top: 360 }, usbc: 'gen2', fans: 4 }),
    'AN1-P20CE': S({ gpu: 375, cooler: 170, rad: { front: 360, top: 360 }, usbc: 'gen2', fans: 3 }),
    'AN1-AX1000': S({ gpu: 420, cooler: 185, rad: { front: 360, top: 360 }, usbc: 'gen2', fans: 4, hub: true }),
    'AN1-CXM': S({ gpu: 415, cooler: 155, rad: { top: 360, side: 240, bottom: 360 }, usbc: 'gen1', fans: 7, hub: true }),
    'AN1-CX300ARB': S({ gpu: 420, cooler: 170, rad: { top: 360, side: 240 }, usbc: false, fans: 4 }),
    'AN1-CX300ARW': S({ gpu: 420, cooler: 170, rad: { top: 360, side: 240 }, usbc: false, fans: 4 }),
    'AN1-CX705A': S({ gpu: 430, cooler: 175, rad: { top: 360 }, usbc: 'gen1', fans: 5 }),
    'AN1-CX200M-RE': S({ gpu: 330, cooler: 164, usbc: false, fans: 5 }),
    'AN1-C2MA': S({ gpu: 415, cooler: 165, rad: { top: 360, side: 240 }, usbc: 'gen2', fans: 2 }),
    'AN1-C2MA-W': S({ gpu: 415, cooler: 165, rad: { top: 360, side: 240 }, usbc: 'gen2', fans: 2 }),
    'AN1-C6WD': S({ gpu: 450, cooler: 180, rad: { top: 360 }, usbc: 'gen2', fans: 3 }),
    'AN1-C6WW': S({ gpu: 450, cooler: 180, rad: { top: 360 }, usbc: 'gen2', fans: 3 }),
    'AN1-FLUX-RR': S({ gpu: 400, cooler: 180, rad: { top: 360 }, usbc: 'gen2', fans: 5 }),
    '94CC500ST': S({ gpu: 410, cooler: 176, rad: { top: 360, side: 360 }, usbc: 'gen2', fans: 4 }),
    '94CC500PI': S({ gpu: 410, cooler: 176 }),
    '94CC201PI': S({ gpu: 410, cooler: 190, rad: { top: 360, side: 240 }, usbc: false, fans: 3 }),
    '94CC102GI': S({ gpu: 410, cooler: 165 }),
    '210-9011347': S({ gpu: 410, rad: { top: 360, side: 240 }, usbc: 'gen2x2', fans: 3, back: true }),
    '210-9011348': S({ gpu: 410, rad: { top: 360, side: 240 }, usbc: 'gen2x2', fans: 3, back: true }),
    '210-9011349': S({ gpu: 405, rad: { top: 360, front: 360, side: 360 }, usbc: 'gen2x2', ff: 'E-ATX', back: true }),
    '210-9011350': S({ gpu: 405, rad: { top: 360, front: 360, side: 360 }, usbc: 'gen2x2', ff: 'E-ATX', back: true }),
    '210-9011265': S({ gpu: 400, cooler: 180, rad: { top: 360, bottom: 360, side: 240 }, usbc: 'gen2', back: true }),
  },
  cooler: {
    'AN3-A450FR': S({ h: 148, sockets: DESKTOP_SOCKETS }),
    'AN3-F400A': S({ h: 157, sockets: DESKTOP_SOCKETS }),
    'AN3-F400AW': S({ h: 157, sockets: DESKTOP_SOCKETS }),
    'AN3-F620DP': S({ h: 157, sockets: DESKTOP_SOCKETS, ram: 40 }),
    'AN3-F620DPW': S({ h: 157, sockets: DESKTOP_SOCKETS, ram: 40 }),
    'CLM-F2127': S({ h: 152, sockets: DESKTOP_SOCKETS }), // Hyper 212 Spectrum V3
    'CLM-F61266': S({ h: 159, sockets: DESKTOP_SOCKETS }), // Hyper 612 APEX
    'DC-AK620DIGW': S({ h: 162, sockets: DESKTOP_SOCKETS }), // AK620 DIGITAL WH
    'DC-AK620DIGSE': S({ sockets: DESKTOP_SOCKETS }), // AK620 DIGITAL SE (manual: sockets only)
    'DC-AK620DIGWHSE': S({ sockets: DESKTOP_SOCKETS }),
    'NH-D15': S({ h: 168, sockets: DESKTOP_SOCKETS }),
    'NH-D15BK': S({ h: 168, sockets: DESKTOP_SOCKETS }),
  },
  psu: {
    'CLM-P7015': S({ atx3: false }), // Elite NEX W700: ATX12V 2.41
    '220-CX650278': S({ atx3: false }), // CX650 (CP-9020278): ATX12V v2.31
    '94P10200': S({ atx3: true }), // GIGABYTE GAMING 750GM PG5 (series 750–1000W: ATX 3.1)
    '94P10201': S({ atx3: true }),
    '94P10202': S({ atx3: true }),
    '94P10203': S({ atx3: true }),
    '94P10206': S({ atx3: true }),
    '94P10207': S({ atx3: true }),
  },
  board: {
    '95B65030': S({ usbc: 'gen1', fans: 2, argb: 2, m2gen: 4 }), // B650M D3HP rev 1.3
  },
};

/* What a platform guarantees for its fastest M.2 slot (AMD and Intel chipset specs), when the board is not listed:
   A620, A520 and B550 have no PCIe 5.0; 12th to 14th gen Intel processors give M.2 PCIe 4.0 at most on H610 / B660 /
   H670 / B760 / H770 boards; X870(E) and B850 boards always have a PCIe 5.0 M.2 slot. */
const M2_GEN_BY_CHIPSET = { A620: 4, A520: 3, B550: 4, H610: 4, B660: 4, H670: 4, B760: 4, H770: 4, B850: 5, X870: 5 };

/* LGA1851 keeps the LGA1700 cooler mounting (Intel), so a cooler listed for one fits the other. */
const coolerFits = (sockets, socket) => sockets.includes(socket) || (socket === 'LGA1851' && sockets.includes('LGA1700')) || (socket === 'LGA1700' && sockets.includes('LGA1851'));

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
  const out = { socket: null, igpu: null, needsCooler: true, watts: null, score: null, model: null, vendor: null, series: null, plus: false };
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
    out.series = 'ultra2';
    // Core Ultra 200S Plus ("250K Plus", "270K Plus"): newer than the first 800-series boards.
    out.plus = /\bplus\b/i.test(t);
  } else if (!isAmd && core) {
    tier = +core[1];
    suffix = core[4].toUpperCase();
    gen = +core[2] - 12;
    out.socket ||= 'LGA1700';
    out.model = `Core i${tier}-${core[2]}${core[3]}${suffix}`;
    out.series = `intel${core[2]}`;
  } else if (ryzen) {
    tier = +ryzen[1];
    const series = +ryzen[2];
    suffix = ryzen[4].toUpperCase();
    gen = { 5: 0, 7: 2, 8: 1.5, 9: 3 }[series] ?? 0;
    out.socket ||= series === 5 ? 'AM4' : 'AM5';
    out.model = `Ryzen ${tier} ${series}${ryzen[3]}${suffix}`;
    out.series = `ryzen${series}000`;
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
  if (out.socket) out.vendor = /^AM/.test(out.socket) ? 'AMD' : 'Intel';
  return out;
}

function parseBoard(t) {
  let m;
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
  // Slot counts, only when the title says them ("4XM.2 Slots", "4 x DIMM", "6 x SATA", "Dual CPU").
  out.ramSlots = (m = t.match(/\b([2468])\s?x\s?(?:ddr[45]\s?)?dimm/i)) ? +m[1] : null;
  out.m2Slots = (m = t.match(/\b([1-8])\s?x\s?m\.?2\b/i)) ? +m[1] : null;
  out.sataPorts = (m = t.match(/\b([1-9])\s?x\s?sata/i)) ? +m[1] : null;
  out.pcieX16 = (m = t.match(/\b([1-4])\s?x\s?pcie?\s?(?:[345]\.0\s?)?x16\b/i)) ? +m[1] : null;
  out.cpuSockets = /\bdual[\s-]?(?:cpu|socket|processor)\b|\b2\s?x\s?(?:lga|sp[35]|socket)/i.test(t) ? 2 : null;
  out.maxMemory = null;
  return out;
}

function parseRam(t) {
  const out = { memory: normalizeMemory(t), capacity: null, modules: 1, speed: null, profile: null };
  // The overclocking profile the title names: XMP (Intel), EXPO (AMD), both, or neither (null).
  const xmp = /\bxmp\b/i.test(t);
  const expo = /\bexpo\b/i.test(t);
  out.profile = xmp && expo ? 'both' : xmp ? 'XMP' : expo ? 'EXPO' : null;
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
  // atx3: true when the title says ATX 3.x / PCIe 5.x / 12V-2x6; null (not known) otherwise, until SPECS says.
  const out = { watts: null, rating: null, atx3: null, modular: null, formFactor: /\bsfx\b/i.test(t) ? 'SFX' : 'ATX' };
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
  if (/atx\s?3(?:\.\d|\.?(?=\s|$))|pcie?\s?5\.\d|12v-?2x6|12vhpwr/i.test(t)) out.atx3 = true;
  out.modular = /full[\s-]?modular|fully modular|semi[\s-]?modular/i.test(t) ? true : /non[\s-]?modular|none modular|לא מודולרי/i.test(t) ? false : null;
  return out;
}

function parseCase(t) {
  const out = { formFactor: null, backConnect: false, gpuMax: null, coolerMax: null, rad: null, usbc: null, fans: null, hub: false, psu: /\bsfx\b/i.test(t) ? 'SFX' : 'ATX' };
  if (/type-?c/i.test(t)) out.usbc = true; // a front USB-C port, generation not given
  const fans = t.match(/\b(\d{1,2})\s?x\s?(?:1[24]0\s?mm\s?)?(?:a?rgb\s?)?(?:pwm\s?)?fans?\b/i);
  if (fans) out.fans = +fans[1];
  const rads = t.match(/\b\d\s?x\s?(240|280|360|420)\s?(?:mm\s?)?radiator/i);
  if (rads) out.rad = { any: +rads[1] };
  if (/\be-?atx\b/i.test(t)) out.formFactor = 'E-ATX';
  else if (/\bmini-?itx\b/i.test(t)) out.formFactor = 'Mini-ITX';
  else if (/\bmicro[\s-]?atx\b|\bm-?atx\b|\bmatx\b|\bmini[\s-]?atx\b/i.test(t)) out.formFactor = 'mATX';
  else if (/\batx\b|\bmid[\s-]?tower|\bfull[\s-]?tower/i.test(t)) out.formFactor = 'ATX';
  else if (/\bmini[\s-]?tower\b/i.test(t)) out.formFactor = 'mATX';
  out.backConnect = /stealth|back[\s-]?connect/i.test(t);
  return out;
}

function parseCooler(t) {
  const out = { type: 'air', tdp: null, radiator: null, height: null, sockets: null, ramClearance: null, dual: false };
  // Two towers (or two fans on one) sit over the memory slots: tall RAM may not fit.
  out.dual = /\bdual\b|\b2\s?x\s?1[24]0\s?mm|\bnh-d15\b|\bak620\b/i.test(t);
  const rad = t.match(/\b(120|240|280|360|420)\b(?!\s*mm\s*(?:fan|pwm))/i);
  if (/נוזלי|liquid|\baio\b/i.test(t)) {
    out.type = 'liquid';
    out.dual = false;
    if (rad) out.radiator = +rad[1];
  }
  const w = t.match(/(\d{2,3})\s?w\b/i);
  if (w) out.tdp = +w[1];
  else if (out.type === 'liquid') out.tdp = out.radiator >= 360 ? 280 : out.radiator >= 240 ? 230 : 180;
  return out;
}

function parseStorage(t) {
  const out = { kind: null, capacityGb: null, gen: null, m2: null };
  const m2 = t.match(/\b(2230|2242|2260|2280|22110)\b/);
  if (m2) out.m2 = +m2[1];
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
  if (/^(מאוורר|מאורר|מאווררים)/.test(t)) return { kind: 'fan', fans: +((t.match(/\b([2-9])\s?(?:pk|pack|fan pack)\b|\b([2-9])\s?x\s?1[24]0/i) || []).slice(1).find(Boolean) || 1) };
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

/* The product description, when the store wrote one ("כרטיס מסך באורך עד 405 מ״מ", "קירור אוויר למעבד עד 175 מ״מ",
   "רדיאטור עד 360 מ״מ"): a case's clearances. */
function readBody(category, facts, body) {
  const t = String(body || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  if (!t.trim() || category !== 'case') return;
  const mm = '\\s?(?:מ״מ|מ"מ|מ\'\'מ|mm)';
  const grab = (re) => { const m = t.match(re); return m ? +m[1] : null; };
  facts.gpuMax ??= grab(new RegExp(`כרטיס מסך באורך עד (\\d{3})${mm}`)) ?? grab(new RegExp(`gpu[^.\\d]{0,30}?(\\d{3})${mm}`, 'i'));
  facts.coolerMax ??= grab(new RegExp(`קירור (?:אוויר )?(?:למעבד )?(?:בגובה )?עד (\\d{3})${mm}`)) ?? grab(new RegExp(`cpu cooler[^.\\d]{0,30}?(\\d{3})${mm}`, 'i'));
  const rad = grab(new RegExp(`רדיאטור(?: בגודל)? עד (\\d{3})${mm}`));
  if (rad && !facts.rad) facts.rad = { any: rad };
}

/* The verified table (SPECS) for this SKU, over what the title said. */
function readSpecs(category, facts, sku) {
  const spec = sku && SPECS[category] && SPECS[category][String(sku).trim()];
  if (!spec) return false;
  switch (category) {
    case 'gpu':
      Object.assign(facts, { length: spec.len, thickness: spec.thick, recPsu: spec.psu, pin16: spec.pin16, radiator: spec.rad || null });
      break;
    case 'case':
      if (spec.gpu) facts.gpuMax = spec.gpu;
      if (spec.cooler) facts.coolerMax = spec.cooler;
      if (spec.rad) facts.rad = { ...spec.rad };
      if (spec.usbc !== undefined) facts.usbc = spec.usbc;
      if (spec.fans !== undefined) facts.fans = spec.fans;
      if (spec.hub) facts.hub = true;
      if (spec.ff) facts.formFactor = spec.ff;
      if (spec.back) facts.backConnect = true;
      break;
    case 'cooler':
      if (spec.h) facts.height = spec.h;
      if (spec.sockets) facts.sockets = [...spec.sockets];
      if (spec.ram) facts.ramClearance = spec.ram;
      break;
    case 'psu':
      if (spec.atx3 !== undefined) facts.atx3 = spec.atx3;
      break;
    case 'board':
      Object.assign(facts, { usbcHeader: spec.usbc ?? null, fanHeaders: spec.fans ?? null, argbHeaders: spec.argb ?? null, m2gen: spec.m2gen ?? null });
      break;
    default:
  }
  return true;
}

/** Reads one title (plus optional pc.* overrides, and the SKU and description when known) into a part's facts. */
export function parseTitle(title, overrides = {}, { sku = null, body = null } = {}) {
  const raw = cleanTitle(title);
  const forced = overrides.category && String(overrides.category).trim().toLowerCase();
  const category = forced ? (forced === 'none' ? 'ignore' : forced) : categorize(raw);
  const facts = READERS[category] ? READERS[category](raw) : {};
  const verified = readSpecs(category, facts, sku);
  readBody(category, facts, body);
  if (category === 'board' && facts.m2gen == null && facts.chipset) facts.m2gen = M2_GEN_BY_CHIPSET[facts.chipset.slice(0, 4)] ?? null;
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
    const count = (v) => { const n = num(v); return n !== null && n >= 0 ? Math.floor(n) : null; };
    if (category === 'board') {
      set('ramSlots', count(overrides.ram_slots) || null);
      set('maxMemory', count(overrides.max_memory) || null);
      set('m2Slots', count(overrides.m2_slots));
      set('sataPorts', count(overrides.sata_ports));
      set('pcieX16', count(overrides.pcie_x16) || null);
      set('cpuSockets', count(overrides.cpu_sockets) || null);
    }
    if (category === 'psu') {
      set('eightPin', count(overrides.pcie_8pin));
      set('pin16Count', count(overrides.pcie_16pin));
    }
    if (category === 'gpu') {
      set('eightPin', count(overrides.pcie_8pin));
      const p16 = count(overrides.pcie_16pin);
      if (p16 !== null) set('pin16', p16 > 0);
    }
  }
  const missing = (REQUIRED_FACTS[category] || []).filter((k) => facts[k] === null || facts[k] === undefined);
  return { category, facts, fromMeta, missing, verified };
}

/** A Shopify product (products.json shape) → a part, or null when it cannot be sold (no available variant). */
export function toPart(product, overrides = {}) {
  const variants = product.variants || [];
  const variant = variants.find((v) => v.available !== false) || null;
  if (!variant) return null;
  const { category, facts, fromMeta, missing, verified } = parseTitle(product.title, overrides, { sku: variant.sku, body: product.body_html });
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
    verified,
  };
}

/* ---------- compatibility ---------- */

export const BASE_WATTS = 60; // board, memory, drives, fans

/* Headroom over the estimated peak draw (Lior: "PSU wattage meets requirements + 100W headroom"). */
export const PSU_HEADROOM = 100;

/** Estimated peak draw of a selection, and the PSU size it calls for: ×1.5 and at least draw + 100 W, rounded up to
    50 W, at least 450 W. `card` is the graphics card maker's own recommendation, when known (advice, not a block).
    Quantities count: two processors or two cards draw twice; drives past the first, memory modules past two and
    added case fans add a few watts each. */
export function powerOf(sel) {
  const q = (key) => (sel[key] ? qtyOf(sel, sel[key]) : 0);
  const cpu = (sel.cpu?.facts?.watts || (sel.cpu ? 125 : 0)) * Math.max(q('cpu'), 1);
  const gpuW = sel.gpu ? sel.gpu.facts.watts || 250 : 0;
  const gpus = q('gpu');
  const gpu = gpuW * gpus;
  const drives = drivesOf(sel).flatMap((d) => Array(qtyOf(sel, d)).fill(d)).slice(1);
  const modules = sel.ram ? (sel.ram.facts.modules || 1) * q('ram') : 0;
  const fans = (sel.extra || []).filter((p) => p.facts?.kind === 'fan').reduce((n, p) => n + (p.facts.fans || 1) * qtyOf(sel, p), 0);
  const more = drives.reduce((w, d) => w + (d.facts.kind === 'HDD' ? 8 : 4), 0) + Math.max(0, modules - 2) * 4 + fans * 2;
  const draw = BASE_WATTS + cpu + gpu + more;
  const up50 = (w) => Math.ceil(w / 50) * 50;
  const recommended = Math.max(450, up50(draw * 1.5), up50(draw + PSU_HEADROOM));
  const rec = sel.gpu?.facts?.recPsu || null;
  return { draw, recommended, card: rec && gpus > 1 ? up50(rec + gpuW * (gpus - 1)) : rec, psu: sel.psu?.facts?.watts || null, gpus };
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

/* What could not be checked for lack of data ("לא אומת"): the builder lets the order through, a representative checks
   it before assembly. Short labels, listed together. */
export const UNVERIFIED = {
  gpuLength: 'אורך כרטיס המסך מול המארז',
  coolerHeight: 'גובה הקירור מול המארז',
  coolerSocket: 'התאמת הקירור לתושבת',
  radiator: 'מקום לרדיאטור במארז',
  ramClearance: 'גובה הזיכרון מתחת לקירור',
  atx3: 'תקן ATX 3 של הספק',
  gpuPower: 'מחבר החשמל של כרטיס המסך מול הספק',
  usbc: 'חיבור USB-C פנימי בלוח',
  fanHeaders: 'מחברי מאווררים ותאורה בלוח',
  m2: 'חריץ M.2 בלוח',
  memProfile: 'פרופיל XMP/EXPO של הזיכרון',
  ramSlots: 'מספר חריצי הזיכרון בלוח',
  maxMemory: 'נפח הזיכרון המרבי של הלוח',
  m2Slots: 'מספר חריצי ה־M.2 בלוח',
  sataPorts: 'מספר חיבורי ה־SATA בלוח',
  pcieX16: 'חריץ PCIe x16 שני בלוח ומקום לשני כרטיסים',
  gpuConnectors: 'מחברי החשמל בספק לשני כרטיסי המסך',
};

/* Processors newer than the first BIOS of a board family: the board may need an update first (we do it before
   assembly). 13th/14th gen Intel on 600-series boards, Core Ultra 200S Plus on any 800-series board, Ryzen 8000/9000
   on 600-series AM5 boards, and the newest Ryzen 9000 X3D parts (9850X3D, 9950X3D2) on any AM5 board. */
function biosNote(cpu, board) {
  const c = cpu.facts;
  const chip = (board.facts.chipset || '').slice(0, 4);
  if (!chip || c.socket !== board.facts.socket) return null;
  const old600 = ['H610', 'B660', 'H670', 'Z690'].includes(chip);
  const am5first = ['A620', 'B650', 'X670'].includes(chip);
  const newest = /9850X3D|9950X3D2/.test(c.model || '');
  if ((c.series === 'intel13' || c.series === 'intel14') && old600) return true;
  if (c.series === 'ultra2' && c.plus) return true;
  if ((c.series === 'ryzen9000' || c.series === 'ryzen8000') && am5first) return true;
  return newest;
}
const BIOS_NOTE = 'ייתכן שהלוח יצטרך עדכון BIOS למעבד הזה. אנחנו מעדכנים לפני ההרכבה';
const ENTRY_CHIPSETS = /^(H610|H810|A520|A620|B840)/;

const RTX_ATX3 = /^RTX [45]0\d0/; // GeForce RTX 40 and 50 series
const BASE_SPEED = { DDR4: 3200, DDR5: 5600 };
const fmtMm = (n) => `${n} מ״מ`;

/* A 12V-2x6 card's adapter (in the box) takes 2 PCIe 8-pin connectors up to about 300W, 3 up to 450W and 4 above
   (NVIDIA's guidance per card class); the card's peak draw when known, else 3. */
const V2X6 = '12V\u20112x6'; // a non-breaking hyphen: the connector's name never breaks across lines
export const ADAPTER_NOTE = `הכרטיס מגיע עם מתאם לחיבורי 8 פין, מומלץ ספק עם חיבור ${V2X6} מקורי`;
export const adapterPins = (gpu) => {
  const w = gpu.facts.watts;
  return !w ? 3 : w <= 300 ? 2 : w <= 450 ? 3 : 4;
};
/* "אין בו מחבר 12V‑2x6, ויש בו רק 2 מחברי PCIe של 8 פין": what a PSU has, for a block reason. */
function connectorsIn(where, native, eight) {
  const e = eight === 0 ? 'אין בו מחברי PCIe של 8 פין' : eight === 1 ? 'מחבר PCIe אחד של 8 פין' : `${eight} מחברי PCIe של 8 פין`;
  if (!native) return `אין ${where} מחבר ${V2X6}, ${eight === 0 ? `ו${e}` : `ויש בו רק ${e}`}`;
  const n16 = native === 1 ? `מחבר ${V2X6} אחד` : `${native} מחברי ${V2X6}`;
  return eight === 0 ? `יש ${where} ${n16}, ו${e}` : `יש ${where} ${n16} ו${/^\d/.test(e) ? '־' : ''}${e}`;
}

/** The checks Lior's six rules add, for `part` against every other chosen part: hard reasons (both sides known and
    they clash), advice (notes) and what could not be checked (unverified labels). */
function lior(part, sel) {
  const reasons = [];
  const notes = [];
  const unv = new Set();
  const k = part.category;
  const pick = (key) => (k === key ? part : sel[key]);
  const cpu = pick('cpu');
  const board = pick('board');
  const ram = pick('ram');
  const gpu = pick('gpu');
  const storage = pick('storage');
  const cooler = pick('cooler');
  const psu = pick('psu');
  const kase = pick('case');
  const me = (key) => k === key;
  const pair = (a, b) => (me(a) || me(b)) && pick(a) && pick(b);

  // 1. CPU ⟷ board: BIOS, and an entry board under a 170W+ processor (no VRM data: the chipset tier is the hint).
  if (pair('cpu', 'board')) {
    if (biosNote(cpu, board)) notes.push(BIOS_NOTE);
    if ((cpu.facts.watts || 0) >= 170 && ENTRY_CHIPSETS.test(board.facts.chipset || ''))
      notes.push(`לוח בסיסי (${board.facts.chipset}) למעבד של ${fmtW(cpu.facts.watts)}: בעומס ממושך המעבד עלול לעבוד לאט יותר. לוח B, X או Z מתאים יותר`);
  }

  // 2. RAM: two sticks for fast DDR5; XMP for Intel, EXPO for AMD.
  if (me('ram')) {
    const f = ram.facts;
    if (f.memory === 'DDR5' && (f.speed || 0) >= 6000 && f.modules === 1)
      notes.push('מקל יחיד עובד בערוץ אחד. ב־DDR5 מהיר ערכה של 2 מקלות יציבה ומהירה יותר');
    if (f.memory === 'DDR5' && (f.speed || 0) >= 6000 && f.modules >= 4)
      notes.push('4 מקלות DDR5 במהירות 6000 ומעלה פחות יציבים. ערכה של 2 מקלות עדיפה');
  }
  if (pair('ram', 'cpu') && cpu.facts.vendor) {
    const f = ram.facts;
    const fast = f.speed && BASE_SPEED[f.memory] && f.speed > BASE_SPEED[f.memory];
    if (cpu.facts.vendor === 'Intel' && f.profile === 'EXPO') notes.push(`הזיכרון מוגדר ל־EXPO של AMD. במעבד אינטל ייתכן שיעבוד במהירות נמוכה מ־${f.speed}MHz`);
    else if (cpu.facts.vendor === 'AMD' && f.profile === 'XMP') notes.push('הזיכרון מוגדר ל־XMP של אינטל. ברוב לוחות AMD הוא עובד, ונגדיר אותו בהרכבה');
    else if (!f.profile && fast) unv.add(UNVERIFIED.memProfile);
  }

  // 3. Graphics card ⟷ case (length, its own radiator) and PSU (the 12V-2x6 connector, the maker's recommendation).
  if (pair('gpu', 'case')) {
    const len = gpu.facts.length;
    const max = kase.facts.gpuMax;
    if (len && max) {
      if (len > max) reasons.push(me('gpu') ? `באורך ${fmtMm(len)}, והמארז שנבחר מקבל עד ${fmtMm(max)}` : `מקבל כרטיס מסך עד ${fmtMm(max)}, והכרטיס שנבחר באורך ${fmtMm(len)}`);
    } else unv.add(UNVERIFIED.gpuLength);
  }
  // A card on a 12VHPWR / 12V-2x6 connector needs it on the PSU: an ATX12V 2.x unit (verified) has none, so it blocks.
  // An RTX 40/50 card on 8-pin connectors works on any PSU with enough watts: an older one gets a notice.
  if (pair('gpu', 'psu')) {
    const pin16 = gpu.facts.pin16;
    const rtx = RTX_ATX3.test(gpu.facts.chip || '');
    const atx3 = psu.facts.atx3;
    if (pin16 === true) {
      if (atx3 === false) reasons.push(me('gpu') ? 'הכרטיס מתחבר במחבר 12V-2x6 (16 פין), והספק שנבחר בתקן ATX ישן בלי המחבר הזה' : 'בתקן ATX ישן בלי מחבר 12V-2x6 (16 פין), וכרטיס המסך שנבחר צריך אותו');
      else if (atx3 !== true && !(psu.facts.pin16Count >= 1)) unv.add(UNVERIFIED.atx3); // a native 12V-2x6 (pc.pcie_16pin) is what the rule asks
    } else if (pin16 === false) {
      if (rtx && atx3 === false) notes.push('הספק בתקן ATX ישן. הכרטיס מתחבר במחברי 8 פין ויעבוד איתו; ספק ATX 3 עמיד יותר לקפיצות הצריכה של RTX 40/50');
    } else if (rtx && atx3 !== true) unv.add(atx3 === false ? UNVERIFIED.gpuPower : UNVERIFIED.atx3);
  }
  if (pair('gpu', 'psu') && gpu.facts.recPsu && psu.facts.watts && psu.facts.watts < gpu.facts.recPsu)
    notes.push(`יצרן כרטיס המסך ממליץ על ספק של ${fmtW(gpu.facts.recPsu)} לפחות`);
  // The power connectors every card needs, times the number of cards, against what the PSU has (pc.pcie_8pin,
  // pc.pcie_16pin). A 12V-2x6 card ships with an adapter to 8-pin connectors (adapterPins), so it takes a native
  // 12V-2x6 or, short of one, enough 8-pin connectors: allowed with a notice. A count not known: "לא אומת", as before.
  // An ATX12V 2.x PSU under a 12V-2x6 card is already blocked above (Lior's rule), so it is not counted again.
  if (pair('gpu', 'psu') && !(gpu.facts.pin16 === true && psu.facts.atx3 === false)) {
    const n = qtyOf(sel, gpu) || 1;
    const both = n > 1 ? `ל־${n} כרטיסי מסך` : 'לכרטיס המסך';
    let known = false;
    if (gpu.facts.pin16 === true && psu.facts.pin16Count != null) {
      const native = psu.facts.pin16Count;
      const eight = psu.facts.eightPin;
      const per = adapterPins(gpu);
      if (native >= n) known = true;
      else if (eight != null) {
        known = true;
        if (native + Math.floor(eight / per) >= n) notes.push(ADAPTER_NOTE);
        else {
          const need = n > 1
            ? `${n} מחברי ${V2X6}, או ${per} מחברי PCIe של 8 פין למתאם של כל כרטיס בלי מחבר כזה`
            : `מחבר ${V2X6}, או ${per} מחברי PCIe של 8 פין למתאם שמגיע איתו`;
          reasons.push(me('psu') ? `${both} צריך ${need}. ${connectorsIn('בו', native, eight)}` : `${n > 1 ? `ל־${n} כרטיסים` : 'לכרטיס'} צריך ${need}. ${connectorsIn('בספק שנבחר', native, eight)}`);
        }
      } else unv.add(n > 1 ? UNVERIFIED.gpuConnectors : UNVERIFIED.gpuPower);
    } else if (gpu.facts.pin16 === false && gpu.facts.eightPin && psu.facts.eightPin != null) {
      known = true;
      const need = gpu.facts.eightPin * n;
      const has = psu.facts.eightPin === 1 ? 'מחבר PCIe אחד של 8 פין' : `${psu.facts.eightPin} מחברי PCIe של 8 פין`;
      if (psu.facts.eightPin < need) reasons.push(me('psu') ? `יש בו ${has}, ו${both} צריך ${need}` : `צריך ${need} מחברי PCIe של 8 פין, ובספק שנבחר יש ${has}`);
    }
    if (n > 1 && !known) unv.add(UNVERIFIED.gpuConnectors);
  }

  // 4. Cooler ⟷ processor (socket, TDP headroom), case (height, radiator) and RAM (clearance under a big tower).
  if (pair('cooler', 'cpu')) {
    const socks = cooler.facts.sockets;
    if (socks && cpu.facts.socket) {
      if (!coolerFits(socks, cpu.facts.socket)) reasons.push(me('cooler') ? `לא תומך בתושבת ${cpu.facts.socket}` : `תושבת ${cpu.facts.socket}, והקירור שנבחר לא תומך בה`);
    } else unv.add(UNVERIFIED.coolerSocket);
    const tdp = cooler.facts.tdp;
    const w = cpu.facts.watts;
    if (tdp && w && tdp + 10 >= w && tdp < w * 1.1) notes.push(`הקירור מדורג ל־${fmtW(tdp)} והמעבד מגיע ל־${fmtW(w)}: מרווח קטן, המאוורר יעבוד חזק בעומס`);
  }
  // Radiators the case must hold: the cooler's (an AIO) and the card's own (a water-cooled card), one place each.
  const aio = cooler && cooler.facts.type === 'liquid' ? cooler.facts.radiator || 0 : null;
  const cardRad = gpu?.facts.radiator || null;
  const mine = me('case') || (me('cooler') && aio !== null) || (me('gpu') && cardRad);
  if (kase && mine && (aio !== null || cardRad)) {
    const wanted = [aio, cardRad].filter((r) => r !== null).sort((a, b) => b - a);
    const rad = kase.facts.rad;
    if (!rad || wanted.includes(0)) unv.add(UNVERIFIED.radiator);
    else {
      const slots = Object.values(rad).sort((a, b) => b - a);
      // A size from a description ("רדיאטור עד 360 מ״מ") is one place, position not given.
      const fits = rad.any ? wanted.length === 1 && wanted[0] <= rad.any : wanted.every((r, i) => (slots[i] || 0) >= r);
      if (!fits) {
        const what = wanted.length > 1 ? `שני רדיאטורים (${wanted.join(' ו־')} מ״מ)` : `רדיאטור ${wanted[0]} מ״מ`;
        reasons.push(me('case') ? `אין מקום ל${what}` : `צריך מקום ל${what}, והמארז שנבחר לא מקבל`);
      }
    }
  }
  if (pair('cooler', 'case') && cooler.facts.type === 'air') {
    const h = cooler.facts.height;
    const max = kase.facts.coolerMax;
    if (h && max) {
      if (h > max) reasons.push(me('cooler') ? `בגובה ${fmtMm(h)}, והמארז שנבחר מקבל קירור עד ${fmtMm(max)}` : `מקבל קירור עד ${fmtMm(max)}, והקירור שנבחר בגובה ${fmtMm(h)}`);
    } else unv.add(UNVERIFIED.coolerHeight);
  }
  if (pair('cooler', 'ram') && cooler.facts.type === 'air' && (cooler.facts.dual || cooler.facts.ramClearance)) {
    const clear = cooler.facts.ramClearance;
    const h = ram.facts.height;
    if (clear && h) {
      if (h > clear) reasons.push(me('cooler') ? `מקבל זיכרון בגובה עד ${fmtMm(clear)}, והזיכרון שנבחר בגובה ${fmtMm(h)}` : `בגובה ${fmtMm(h)}, והקירור שנבחר מקבל עד ${fmtMm(clear)}`);
    } else unv.add(UNVERIFIED.ramClearance);
  }

  // 5. Storage ⟷ board: an M.2 drive's length, and PCIe 5.0 drives on a board without a PCIe 5.0 M.2 slot.
  if (pair('storage', 'board') && storage.facts.kind === 'NVMe') {
    const len = storage.facts.m2;
    // Every desktop board's M.2 M-key slot takes 2280 and the shorter standard lengths; 22110 needs a board that says so.
    if (!len || len > 2280) unv.add(UNVERIFIED.m2);
    const gen = board.facts.m2gen;
    if (storage.facts.gen === 5) {
      if (gen && gen < 5) notes.push('ללוח אין חריץ M.2 בתקן PCIe 5.0: הדיסק יעבוד, במהירות נמוכה מהמרבית שלו');
      else if (!gen) unv.add(UNVERIFIED.m2);
    }
  }

  // 6. Case ⟷ system: PSU size, the board's USB-C header for the front port, fan and ARGB headers.
  if (pair('case', 'psu') && kase.facts.psu === 'SFX' && psu.facts.formFactor === 'ATX')
    reasons.push(me('case') ? 'מקבל ספק SFX בלבד, והספק שנבחר בגודל ATX' : 'ספק בגודל ATX, והמארז שנבחר מקבל SFX בלבד');
  if (pair('case', 'board')) {
    if (kase.facts.usbc) {
      const header = board.facts.usbcHeader;
      if (header === false) notes.push('ללוח אין חיבור פנימי ל־USB-C, ולכן שקע ה־USB-C בחזית המארז לא יעבוד');
      else if (!header) unv.add(UNVERIFIED.usbc);
    }
    const fans = kase.facts.fans;
    if (fans >= 4 && !kase.facts.hub && !(board.facts.fanHeaders >= fans)) unv.add(UNVERIFIED.fanHeaders);
  }
  return { reasons, notes, unverified: [...unv] };
}

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
  const more = lior(part, sel);
  reasons.push(...more.reasons);
  notes.push(...more.notes);
  return { ok: reasons.length === 0, reasons, notes, unverified: more.unverified };
}

/** Which steps the selection still needs. */
export function requiredSteps(sel) {
  const req = ['cpu', 'board', 'ram', 'storage', 'psu', 'case'];
  if (!sel.cpu || sel.cpu.facts.igpu === false || sel.cpu.facts.igpu === null) req.splice(3, 0, 'gpu');
  if (!sel.cpu || sel.cpu.facts.needsCooler !== false) req.push('cooler');
  return req;
}

/** The whole build: problems between chosen parts, what is missing, notes to double-check, and what could not be
    checked for lack of data (`unverified`: a representative confirms it before assembly; the order still goes through). */
export function checkBuild(sel) {
  const problems = [];
  const notes = [];
  const unverified = new Set();
  // Each part against the parts of the steps before it only, so every clashing pair is reported once (the step order
  // puts every part after what it depends on: board after CPU, memory after board, PSU after CPU and card…).
  const before = { qty: sel.qty || {} };
  for (const key of STEP_KEYS) {
    const part = key === 'extra' ? null : sel[key];
    if (part) {
      const fit = fitOf(part, before);
      fit.reasons.forEach((r) => problems.push({ step: key, text: r }));
      fit.notes.forEach((n) => notes.push({ step: key, text: n }));
      fit.unverified.forEach((u) => unverified.add(u));
      before[key] = part;
    }
    if (key === 'storage' && sel.drives?.length) before.drives = sel.drives;
  }
  // Added drives: each against the board (M.2 length, PCIe 5.0 slot), like the main one.
  for (const d of sel.drives || []) {
    const fit = fitOf(d, { board: sel.board, qty: sel.qty });
    fit.reasons.forEach((r) => problems.push({ step: 'storage', text: r }));
    fit.notes.forEach((n) => notes.push({ step: 'storage', text: n }));
    fit.unverified.forEach((u) => unverified.add(u));
  }
  const qc = checkQuantities(sel);
  problems.push(...qc.problems);
  notes.push(...qc.notes);
  qc.unverified.forEach((u) => unverified.add(u));
  // Notes that only show from the later side (memory to confirm on a board that does not say): ask the later part too.
  for (const key of STEP_KEYS) {
    if (key === 'extra' || !sel[key]) continue;
    const fit = fitOf(sel[key], { ...sel, [key]: undefined });
    fit.notes.forEach((n) => notes.push({ step: key, text: n }));
    fit.unverified.forEach((u) => unverified.add(u));
  }
  const missing = requiredSteps(sel).filter((k) => !sel[k]);
  const power = powerOf(sel);
  const order = Object.values(UNVERIFIED);
  return {
    ok: problems.length === 0 && missing.length === 0,
    problems,
    missing,
    notes: [...new Map(notes.map((n) => [n.text, n])).values()],
    unverified: [...unverified].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    power,
  };
}

/** The parts of the steps before `key`: what a part of that step must fit (with the quantities, and the added drives
    once the storage step is behind). */
export function earlierOf(sel, key) {
  const out = { qty: { ...(sel.qty || {}) } };
  for (const k of STEP_KEYS) {
    if (k === key) break;
    if (k !== 'extra' && sel[k]) out[k] = sel[k];
    if (k === 'storage' && sel.drives?.length) out.drives = [...sel.drives];
  }
  return out;
}

/** Keeps, in step order, only the parts that fit everything kept before them (a shared link, a saved build, the
    last check before the cart). Returns the clean selection and what was dropped, with the reason. */
export function sanitize(sel) {
  const kept = { qty: { ...(sel.qty || {}) } };
  const removed = [];
  for (const k of STEP_KEYS) {
    if (k === 'extra' || !sel[k]) continue;
    const fit = fitOf(sel[k], kept);
    if (fit.ok) kept[k] = sel[k];
    else removed.push({ step: k, part: sel[k], reason: fit.reasons[0] });
  }
  // Added drives: storage parts the checks can read, each once, never the main drive again.
  const drives = [];
  for (const d of sel.drives || []) {
    if (!d || d.category !== 'storage' || d === kept.storage || drives.includes(d)) continue;
    if (d.missing?.length) removed.push({ step: 'storage', part: d, reason: fitOf(d, {}).reasons[0] });
    else drives.push(d);
  }
  // A removed main drive: the first added one takes its place.
  if (!kept.storage && drives.length && !removed.some((r) => r.step === 'storage' && r.part === sel.storage)) kept.storage = drives.shift();
  const out = finish(kept, drives, sel.extra);
  return { sel: out.sel, removed, adjusted: out.adjusted };
}

/** The selection object in step order, with the added drives, the extras and the quantities (unused ones pruned,
    the rest held within what the board and the other parts allow). */
function finish(kept, drives, extra) {
  const out = {};
  for (const k of STEP_KEYS) if (k !== 'extra' && kept[k]) out[k] = kept[k];
  out.drives = [...(drives || [])];
  out.extra = [...(extra || [])];
  out.qty = {};
  for (const { part } of lines({ ...out, qty: {} })) {
    const n = Math.floor(Number(kept.qty?.[part.id]) || 1);
    if (n > 1 && QTY_STEPS.includes(qtyKind(part))) out.qty[part.id] = n;
  }
  return clampQty(out);
}

/** Chooses `part` and drops every other chosen part that no longer fits it (the new choice wins). */
export function applyChoice(sel, part) {
  const key = part.category;
  // The new part starts at one; the part it replaces gives up its quantity.
  const qty = { ...(sel.qty || {}) };
  if (sel[key] && sel[key] !== part) delete qty[sel[key].id];
  delete qty[part.id];
  return settle(sel, key, part, qty);
}

/** `part` (of step `key`) wins: every other chosen part that no longer fits it, with the quantities `qty`, is dropped,
    and the quantities are held within the new limits. */
function settle(sel, key, part, qty) {
  const kept = { [key]: part, qty, drives: sel.drives || [] };
  const removed = [];
  for (const k of STEP_KEYS) {
    if (k === key || k === 'extra' || !sel[k]) continue;
    const fit = fitOf(sel[k], kept);
    if (fit.ok) kept[k] = sel[k];
    else removed.push({ step: k, part: sel[k], reason: fit.reasons[0] });
  }
  const drives = (sel.drives || []).filter((d) => d !== kept.storage);
  if (!kept.storage && drives.length) kept.storage = drives.shift();
  const out = finish(kept, drives, sel.extra);
  return { sel: out.sel, removed, adjusted: out.adjusted };
}

/* ---------- quantities ----------
   Several of one part: two processors (a dual-socket board only), memory kits up to the board's slots and capacity,
   two graphics cards (the board's x16 slots, the PSU's watts and connectors), drives up to the board's M.2 slots and
   SATA ports (several different drives too: sel.drives), and fan packs. A selection keeps them in sel.qty, by product
   id (a missing entry is one). */

export const QTY_STEPS = ['cpu', 'ram', 'gpu', 'storage', 'fan'];
/* The kind of quantity a part takes: its step, or 'fan' for an extra that is case fans; null when it is one only. */
export const qtyKind = (part) => (part?.category === 'extra' ? (part.facts?.kind === 'fan' ? 'fan' : null) : QTY_STEPS.includes(part?.category) ? part.category : null);
export const qtyOf = (sel, part) => Math.max(1, Math.floor(Number(sel?.qty?.[part?.id]) || 1));
export const MAX_GPUS = 2;
export const MAX_FAN_PACKS = 6;

/* What a board has when it does not say (pc.* metafields, the title), and what every desktop board has for sure. */
export const BOARD_DEFAULTS = { ramSlots: 4, m2Slots: 2, sataPorts: 4, pcieX16: 2, cpuSockets: 1 };
export const BOARD_SURE = { ramSlots: 2, m2Slots: 1, sataPorts: 2, pcieX16: 1 };
const MEMORY_MAX = { DDR4: 128, DDR5: 192 };

/** The board's limits: { max, known } per kind. No board chosen yet: the defaults, not known. */
export function boardLimits(board) {
  const f = board?.facts || {};
  const itx = f.formFactor === 'Mini-ITX';
  const val = (k, itxValue) => (f[k] != null ? { max: f[k], known: true } : itx && itxValue != null ? { max: itxValue, known: true } : { max: BOARD_DEFAULTS[k], known: false });
  const ramSlots = val('ramSlots', 2);
  const perSlot = (MEMORY_MAX[f.memory] || MEMORY_MAX.DDR5) / 4;
  return {
    ramSlots,
    maxMemory: f.maxMemory ? { max: f.maxMemory, known: true } : { max: perSlot * ramSlots.max, known: false },
    m2Slots: val('m2Slots'),
    sataPorts: val('sataPorts'),
    pcieX16: val('pcieX16', 1),
    cpuSockets: f.cpuSockets ? { max: f.cpuSockets, known: true } : { max: 1, known: false },
  };
}

/** The selection's parts, each with its quantity, in step order: the main drive then the added ones, extras last. */
export function lines(sel) {
  const out = [];
  for (const k of STEP_KEYS) {
    if (k === 'extra') continue;
    if (sel[k]) out.push({ step: k, part: sel[k], qty: qtyOf(sel, sel[k]) });
    if (k === 'storage') for (const d of sel.drives || []) out.push({ step: 'storage', part: d, qty: qtyOf(sel, d), added: true });
  }
  for (const p of sel.extra || []) out.push({ step: 'extra', part: p, qty: qtyOf(sel, p) });
  return out;
}

export const drivesOf = (sel) => [sel.storage, ...(sel.drives || [])].filter(Boolean);
/* An M.2 drive (NVMe, or an M.2 SATA stick) takes an M.2 slot; a 2.5" SSD or a hard disk a SATA port. */
export const isM2 = (d) => d.facts.kind === 'NVMe' || !!d.facts.m2;

/** How many drives, modules, cards… the selection uses. */
export function usageOf(sel) {
  let m2 = 0;
  let sata = 0;
  for (const d of drivesOf(sel)) {
    if (isM2(d)) m2 += qtyOf(sel, d);
    else sata += qtyOf(sel, d);
  }
  const ram = sel.ram;
  return {
    m2,
    sata,
    modules: ram ? (ram.facts.modules || 1) * qtyOf(sel, ram) : 0,
    memoryGb: ram ? (ram.facts.capacity || 0) * qtyOf(sel, ram) : 0,
    gpus: sel.gpu ? qtyOf(sel, sel.gpu) : 0,
    cpus: sel.cpu ? qtyOf(sel, sel.cpu) : 0,
  };
}

const DUAL_CPU = '2 מעבדים אפשר רק בלוח אם עם שתי תושבות (לוח לשרתים ולתחנות עבודה).';

/** The most of `part` the selection allows, the other parts as they are: { max, reason, assumed }. `reason` says
    what sets the limit (in Hebrew, for the customer); `assumed` is true when it comes from a default. A part not yet
    chosen (an added drive) counts from zero. */
export function qtyLimit(sel, part) {
  const kind = qtyKind(part);
  const board = sel.board;
  const L = boardLimits(board);
  switch (kind) {
    case 'cpu': {
      if (L.cpuSockets.max >= 2) return { max: Math.min(L.cpuSockets.max, 2), reason: `ללוח שבחרתם ${L.cpuSockets.max} תושבות.`, assumed: false };
      return { max: 1, reason: `${DUAL_CPU} ${board ? 'הלוח שבחרתם הוא לתושבת אחת.' : 'עדיין לא נבחר לוח כזה.'}`, assumed: false };
    }
    case 'ram': {
      const modules = part.facts.modules || 1;
      const bySlots = Math.floor(L.ramSlots.max / modules);
      const byCap = part.facts.capacity ? Math.floor(L.maxMemory.max / part.facts.capacity) : Infinity;
      const max = Math.max(1, Math.min(bySlots, byCap));
      const slots = L.ramSlots.known
        ? `ללוח ${L.ramSlots.max} חריצי זיכרון`
        : `עד ${L.ramSlots.max} מקלות זיכרון (${board ? 'מספר החריצים בלוח לא ידוע לנו, נציג יאשר' : 'עוד לא נבחר לוח'})`;
      const reason = byCap < bySlots
        ? `הלוח תומך בעד ${L.maxMemory.max}GB זיכרון${L.maxMemory.known ? '' : ' (הערכה, נציג יאשר)'}.`
        : `${slots}${modules > 1 ? `, והערכה היא ${modules} מקלות` : ''}.`;
      return { max, reason, assumed: byCap < bySlots ? !L.maxMemory.known : !L.ramSlots.known };
    }
    case 'gpu': {
      const max = Math.max(1, Math.min(MAX_GPUS, L.pcieX16.max));
      const reason = max < MAX_GPUS
        ? 'ללוח יש חריץ PCIe x16 אחד, ולכן אפשר כרטיס מסך אחד.'
        : `אפשר עד ${MAX_GPUS} כרטיסי מסך${L.pcieX16.known ? '' : ' (חריץ x16 שני בלוח: נציג יאשר)'}.`;
      return { max, reason, assumed: !L.pcieX16.known };
    }
    case 'storage': {
      const u = usageOf(sel);
      const mine = drivesOf(sel).includes(part) ? qtyOf(sel, part) : 0;
      const m2 = isM2(part);
      const lim = m2 ? L.m2Slots : L.sataPorts;
      const used = (m2 ? u.m2 : u.sata) - mine;
      const name = m2 ? 'חריצי M.2' : 'חיבורי SATA';
      const reason = `${lim.known ? `ללוח ${lim.max} ${name}` : `עד ${lim.max} ${name} (${board ? 'הלוח לא מפרט, נציג יאשר' : 'עוד לא נבחר לוח'})`}${used ? `, ו־${used} כבר בשימוש` : ''}.`;
      return { max: Math.max(0, lim.max - used), reason, assumed: !lim.known };
    }
    case 'fan': return { max: MAX_FAN_PACKS, reason: `אפשר עד ${MAX_FAN_PACKS} חבילות.`, assumed: false };
    default: return { max: 1, reason: null, assumed: false };
  }
}

/** Holds every quantity within its limit, from the last drive back; an added drive that has no room left goes.
    Returns the selection and what changed ({ step, part, from, to, reason }). */
export function clampQty(sel) {
  const out = { ...sel, qty: { ...(sel.qty || {}) }, drives: [...(sel.drives || [])] };
  const adjusted = [];
  const set = (step, part, to, reason) => {
    const from = qtyOf(out, part);
    if (to >= 1) {
      if (to > 1) out.qty[part.id] = to;
      else delete out.qty[part.id];
    } else {
      delete out.qty[part.id];
      out.drives = out.drives.filter((d) => d !== part);
    }
    adjusted.push({ step, part, from, to: Math.max(to, 0), reason });
  };
  for (const key of ['cpu', 'ram', 'gpu']) {
    const p = out[key];
    if (!p) continue;
    const lim = qtyLimit(out, p);
    if (qtyOf(out, p) > lim.max) set(key, p, lim.max, lim.reason);
  }
  for (const d of drivesOf(out).reverse()) {
    const lim = qtyLimit(out, d);
    if (qtyOf(out, d) <= lim.max) continue;
    // The main drive stays (at one): if even that does not fit, checkBuild reports it.
    const floor = d === out.storage ? 1 : 0;
    set('storage', d, Math.max(lim.max, floor), lim.reason);
  }
  for (const p of out.extra || []) {
    const lim = qtyLimit(out, p);
    if (qtyOf(out, p) > lim.max) set('extra', p, lim.max, lim.reason);
  }
  return { sel: out, adjusted };
}

/** Sets the quantity of a chosen part. Past its limit it stops at the limit (`limited` holds the reason); a larger
    quantity that a later part no longer fits (two cards and the PSU) drops that part, as a new choice would. */
export function setQty(sel, part, n) {
  const lim = qtyLimit(sel, part);
  const want = Math.max(1, Math.floor(Number(n) || 1));
  const to = Math.min(want, Math.max(lim.max, 1));
  const qty = { ...(sel.qty || {}) };
  if (to > 1) qty[part.id] = to;
  else delete qty[part.id];
  const key = part.category === 'extra' || (part.category === 'storage' && sel.storage !== part) ? null : part.category;
  const res = key ? settle(sel, key, part, qty) : { ...clampQty({ ...sel, qty }), removed: [] };
  return { ...res, qty: to, limited: want > to ? lim.reason : null };
}

/** Whether `part` can be added as one more drive: { ok, reason }. */
export function canAddDrive(sel, part) {
  if (part.category !== 'storage') return { ok: false, reason: null };
  if (drivesOf(sel).includes(part)) return { ok: false, reason: 'הדיסק כבר נבחר. אפשר לשנות את הכמות שלו.' };
  if (part.missing?.length) return { ok: false, reason: fitOf(part, {}).reasons[0] };
  const lim = qtyLimit(sel, part);
  if (lim.max < 1) return { ok: false, reason: `אין מקום לעוד דיסק: ${lim.reason}` };
  return { ok: true, reason: null };
}

/** Adds a drive: the main one when there is none, else one more (sel.drives). */
export function addDrive(sel, part) {
  if (!sel.storage) return applyChoice(sel, part);
  const can = canAddDrive(sel, part);
  if (!can.ok) return { sel, removed: [], adjusted: [], refused: can.reason };
  const out = clampQty({ ...sel, drives: [...(sel.drives || []), part] });
  return { sel: out.sel, removed: [], adjusted: out.adjusted };
}

/** Removes a drive; the first added drive takes the main drive's place. */
export function removeDrive(sel, part) {
  const qty = { ...(sel.qty || {}) };
  delete qty[part.id];
  let drives = (sel.drives || []).filter((d) => d !== part);
  let storage = sel.storage === part ? null : sel.storage;
  if (!storage && drives.length) [storage, ...drives] = drives;
  const out = { ...sel, qty, drives };
  if (storage) out.storage = storage;
  else delete out.storage;
  return clampQty(out).sel;
}

/** What the quantities add to the build check: problems (a known limit exceeded), notes and what to confirm. */
export function checkQuantities(sel) {
  const problems = [];
  const notes = [];
  const unverified = new Set();
  const L = boardLimits(sel.board);
  const u = usageOf(sel);
  for (const { step, part, qty } of lines(sel)) {
    const lim = qtyLimit(sel, part);
    const over = step === 'storage' ? qty > lim.max : qty > Math.max(lim.max, 1);
    if (over && lim.reason) problems.push({ step, text: `${qty > 1 ? `כמות ${qty}: ` : ''}${lim.reason}` });
  }
  if (sel.board) {
    if (u.modules > BOARD_SURE.ramSlots && !L.ramSlots.known) unverified.add(UNVERIFIED.ramSlots);
    if (u.memoryGb > 64 && !L.maxMemory.known) unverified.add(UNVERIFIED.maxMemory);
    if (u.m2 > BOARD_SURE.m2Slots && !L.m2Slots.known) unverified.add(UNVERIFIED.m2Slots);
    if (u.sata > BOARD_SURE.sataPorts && !L.sataPorts.known) unverified.add(UNVERIFIED.sataPorts);
    if (u.gpus > BOARD_SURE.pcieX16 && !L.pcieX16.known) unverified.add(UNVERIFIED.pcieX16);
  }
  if (u.gpus > 1) notes.push({ step: 'gpu', text: 'רוב המשחקים לא מנצלים שני כרטיסי מסך (בכרטיסים החדשים אין SLI או CrossFire). שני כרטיסים מתאימים בעיקר לרינדור, לבינה מלאכותית ולעבודה עם כמה מסכים' });
  if (sel.ram && qtyOf(sel, sel.ram) > 1) {
    notes.push({ step: 'ram', text: 'שתי ערכות נפרדות לא תמיד עובדות יחד במהירות המלאה שלהן. ערכה אחת עם כל המקלות יציבה יותר' });
    const f = sel.ram.facts;
    if (f.memory === 'DDR5' && (f.speed || 0) >= 6000 && u.modules >= 4 && (f.modules || 1) < 4)
      notes.push({ step: 'ram', text: '4 מקלות DDR5 במהירות 6000 ומעלה פחות יציבים. ערכה של 2 מקלות עדיפה' });
  }
  // Added case fans: the board's fan headers (or the case's hub) for them.
  const fans = (sel.extra || []).filter((p) => p.facts?.kind === 'fan').reduce((n, p) => n + (p.facts.fans || 1) * qtyOf(sel, p), 0);
  if (fans && sel.board && !sel.case?.facts.hub && !(sel.board.facts.fanHeaders >= fans + (sel.case?.facts.fans || 0))) unverified.add(UNVERIFIED.fanHeaders);
  return { problems, notes, unverified: [...unverified] };
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

/* ---------- search ----------
   The search box of each step: every word typed must appear in the part's text (title, maker, model, chipset, socket,
   memory, capacity, size…), in Hebrew or English. Case, spaces, dots and dashes do not count ("rtx5070" finds
   "RTX 5070", "m2" finds "M.2", "1 tb" finds "1TB"), nor Hebrew final letters, geresh or gershayim. Makers and common
   words also carry their Hebrew name (אינטל, גיגהבייט, לבן, נוזלי…). */

const HEBREW_NAMES = {
  AMD: 'איי אם די אמד', Intel: 'אינטל', Gigabyte: 'גיגהבייט גיגבייט גיגביט', ASUS: 'אסוס', MSI: 'אם אס איי', ASRock: 'אסרוק',
  Corsair: 'קורסייר קורסר', Kingston: 'קינגסטון', Crucial: 'קרושיאל', KLEVV: 'קלב', ADATA: 'איידאטה', Lexar: 'לקסר',
  Netac: 'נטאק', Samsung: 'סמסונג', WD: 'ווסטרן דיגיטל', Seagate: 'סיגייט', Toshiba: 'טושיבה', SanDisk: 'סנדיסק',
  Antec: 'אנטק', 'Cooler Master': 'קולר מאסטר', DeepCool: 'דיפקול', Noctua: 'נוקטואה', NZXT: 'אנזקסט', 'Lian Li': 'ליאן לי',
  'be quiet!': 'בי קוויט', Thermaltake: 'טרמלטייק', Microsoft: 'מיקרוסופט', PNY: 'פי אן וואי', NVIDIA: 'אנבידיה', SAMA: 'סאמא',
};
const WORDS = [
  [/\bryzen\b/i, 'רייזן'], [/\bcore\b/i, 'קור'], [/\bultra\b/i, 'אולטרה'], [/\bgeforce\b|\brtx\b/i, 'ג׳יפורס'], [/\bradeon\b|\brx\s?\d/i, 'ראדאון'],
  [/\bwhite\b|\bice\b|לבן/i, 'לבן white'], [/\bblack\b|שחור/i, 'שחור black'], [/wi-?fi|\bwf\d|\bax\b/i, 'אלחוטי wifi'], [/\bargb\b|\brgb\b/i, 'תאורה'],
  [/\bwindows\b/i, 'ווינדוס'], [/\bhome\b/i, 'הום'], [/\bpro\b/i, 'פרו'], [/\bgaming\b/i, 'גיימינג'], [/\bgold\b/i, 'זהב'],
  [/\bmodular\b/i, 'מודולרי'], [/\bnvme\b/i, 'נבמי'], [/\bssd\b/i, 'אס אס די'], [/\bhdd\b|rpm/i, 'קשיח hdd'],
];

/** Lower case, no diacritics, Hebrew final letters as regular ones, and none of: spaces, dots, dashes, quotes, slashes. */
export function normalizeSearch(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[֑-ׇ̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c])
    .replace(/[\s.\-_,/\\|()[\]{}"'`״׳׳+:;!?]+/g, '');
}

/** Everything a customer may type to find the part, in Hebrew and English (normalised; cached on the part). */
export function searchText(part) {
  if (part._search) return part._search;
  const f = part.facts || {};
  const bits = [part.title, part.brand, HEBREW_NAMES[part.brand], part.sku];
  for (const [re, words] of WORDS) if (re.test(part.title)) bits.push(words);
  bits.push(f.model, f.chip, f.chipset, f.socket, f.socket && f.socket.replace(/^LGA/, ''), f.memory, f.formFactor, f.kind, f.rating, f.edition);
  if (f.formFactor === 'mATX') bits.push('micro atx matx מיקרו');
  if (f.formFactor === 'Mini-ITX') bits.push('mini itx מיני');
  if (f.capacity) bits.push(`${f.capacity}gb ${f.capacity}גיגה`);
  if (f.modules > 1 && f.capacity) bits.push(`${f.modules}x${f.capacity / f.modules}`);
  if (f.vram) bits.push(`${f.vram}gb ${f.vram}גיגה`);
  if (f.capacityGb) bits.push(f.capacityGb >= 1000 ? `${f.capacityGb / 1000}tb ${f.capacityGb / 1000}טרה ${f.capacityGb}gb` : `${f.capacityGb}gb ${f.capacityGb}גיגה`);
  if (f.speed) bits.push(`${f.speed}mhz`);
  if (f.watts) bits.push(`${f.watts}w ${f.watts}וואט`);
  if (f.tdp) bits.push(`${f.tdp}w`);
  if (f.gen) bits.push(`gen${f.gen} pcie${f.gen}`);
  if (f.type === 'liquid') bits.push(`נוזלי liquid aio ${f.radiator || ''}`);
  if (f.type === 'air') bits.push('אוויר air');
  if (f.language === 'he') bits.push('עברית hebrew');
  if (part.category === 'cpu') bits.push(f.igpu ? 'גרפיקה מובנית igpu' : 'בלי גרפיקה');
  const text = normalizeSearch(bits.filter(Boolean).join(' '));
  Object.defineProperty(part, '_search', { value: text, enumerable: false, configurable: true });
  return text;
}

/* Hebrew words typed for an English name, so that "רייזן 7" reads as "ryzen 7" and finds "Ryzen 7 7700". */
const QUERY_WORDS = Object.fromEntries([
  ['רייזן', 'ryzen'], ['אינטל', 'intel'], ['גיגהבייט', 'gigabyte'], ['גיגבייט', 'gigabyte'], ['גיגביט', 'gigabyte'], ['גפורס', 'geforce'],
  ['ג׳יפורס', 'geforce'], ['גיפורס', 'geforce'], ['ראדאון', 'radeon'], ['רדאון', 'radeon'], ['קור', 'core'], ['אולטרה', 'ultra'],
  ['סמסונג', 'samsung'], ['קינגסטון', 'kingston'], ['קורסייר', 'corsair'], ['אנטק', 'antec'], ['אסוס', 'asus'], ['לקסר', 'lexar'],
  ['סיגייט', 'seagate'], ['טושיבה', 'toshiba'], ['נוקטואה', 'noctua'], ['דיפקול', 'deepcool'], ['ווינדוס', 'windows'], ['פרו', 'pro'],
  ['גיגה', 'gb'], ['טרה', 'tb'], ['וואט', 'w'],
].map(([he, en]) => [normalizeSearch(he), en]));
const UNIT = /^(gb|tb|w|mhz|mm|g|t)$/;

/** The words of a query, normalised: a Hebrew name becomes its English one, and a short number joins its unit or the
    word before it ("1 tb" → "1tb", "ryzen 7" → "ryzen7", "ddr 5" → "ddr5"), so a stray digit does not match anything. */
export function queryWords(query) {
  const raw = String(query ?? '').trim().split(/\s+/).map(normalizeSearch).filter(Boolean).map((w) => QUERY_WORDS[w] || w);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (/^\d{1,2}$/.test(w) && UNIT.test(raw[i + 1] || '')) { out.push(w + raw[++i]); continue; }
    if ((/^\d{1,2}$/.test(w) || UNIT.test(w)) && out.length) { out[out.length - 1] += w; continue; }
    out.push(w);
  }
  return out;
}

/** Whether a part matches what was typed: every word appears (or the whole query, spaces ignored). Empty: all. */
export function matchesQuery(part, query) {
  const words = queryWords(query);
  if (!words.length) return true;
  const text = searchText(part);
  return text.includes(words.join('')) || words.every((w) => text.includes(w));
}

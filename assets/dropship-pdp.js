/* "דרופשיפינג" product page card (snippets/dropship-pdp.liquid).
   1. "אצלך עד …": the server prints "X ימי עסקים"; this counts X business days from today in Israel (Sunday to
      Thursday, without the dates in data-holidays, YYYY-MM-DD) and prints the last one as "יום ה׳, 26.11".
   2. "נתונים עיקריים" for PC parts: the title read by the PC builder's parser (assets/pc-builder-parser.js, its URL in
      data-parser-src). Only facts the title itself states are shown; nothing is estimated. */

const DAY = 86400000;
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** Today's date in Israel as a UTC-midnight Date (so adding days never crosses a DST edge). */
function todayInIsrael(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${parts}T00:00:00Z`);
}

const iso = (d) => d.toISOString().slice(0, 10);

/** The date `days` business days after `from` (Friday, Saturday and the holidays are skipped). */
export function addBusinessDays(from, days, holidays = new Set()) {
  let d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const wd = d.getUTCDay();
    if (wd !== 5 && wd !== 6 && !holidays.has(iso(d))) left -= 1;
  }
  return d;
}

export const formatDate = (d) => `יום ${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;

function showDate(card) {
  const out = card.querySelector('[data-dsp-date]');
  const days = Number(card.dataset.days);
  if (!out || !Number.isFinite(days) || days <= 0) return;
  const holidays = new Set((card.dataset.holidays || '').split(/[,\s]+/).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)));
  const date = addBusinessDays(todayInIsrael(), days, holidays);
  out.textContent = formatDate(date);
  out.title = `${days} ימי עסקים`;
}

/* ---------- key facts (PC parts) ---------- */

const gb = (n) => (n >= 1000 ? `${n / 1000}TB` : `${n}GB`);

/** [label, value] pairs from the parser's facts and the title; only what the title states. */
export function factsOf(title, parsed) {
  const { category, facts: f } = parsed;
  const t = String(title);
  const rows = [];
  const add = (label, value) => value !== undefined && value !== null && value !== '' && value !== false && rows.push([label, String(value)]);
  switch (category) {
    case 'cpu': {
      add('שקע', f.socket);
      const cores = t.match(/(\d{1,2})\s*(?:-?\s*cores?|crs)\b/i) || t.match(/\b(\d{1,2})C\s*\/\s*\d{1,2}T\b/i);
      const threads = t.match(/(\d{1,2})\s*(?:threads?|trd|tr)\b/i) || t.match(/\b\d{1,2}C\s*\/\s*(\d{1,2})T\b/i);
      if (cores && threads) add('ליבות / תהליכונים', `${cores[1]} / ${threads[1]}`);
      else if (cores) add('ליבות', cores[1]);
      const ghz = t.match(/(?:up\s*to|max|עד)\s*([\d.]+)\s*ghz/i);
      if (ghz) add('תדר מרבי', `${ghz[1]}GHz`);
      if (f.igpu === false) add('גרפיקה מובנית', 'ללא');
      break;
    }
    case 'gpu':
      add('שבב', f.chip);
      if (f.vram) add('זיכרון', `${f.vram}GB`);
      break;
    case 'ram':
      add('סוג', f.memory);
      if (f.capacity) add('נפח', f.modules > 1 ? `${f.capacity}GB (${f.modules}×${f.capacity / f.modules}GB)` : `${f.capacity}GB`);
      if (f.speed) add('מהירות', `${f.speed}MHz`);
      break;
    case 'board':
      add('שקע', f.socket);
      add('ערכת שבבים', f.chipset);
      add('זיכרון', f.memory);
      add('גודל', f.formFactor);
      if (f.wifi) add('אלחוטי', 'Wi-Fi');
      break;
    case 'storage':
      add('סוג', f.kind);
      if (f.capacityGb) add('נפח', gb(f.capacityGb));
      if (f.gen) add('ממשק', `PCIe Gen${f.gen}`);
      break;
    case 'psu':
      if (f.watts) add('הספק', `${f.watts}W`);
      if (f.rating) add('תקן', `80 Plus ${f.rating}`);
      if (/semi[\s-]*modular/i.test(t)) add('כבלים', 'חצי מודולרי');
      else if (f.modular) add('כבלים', 'מודולרי');
      break;
    case 'case':
      add('לוח אם עד', f.formFactor);
      break;
    case 'cooler':
      add('סוג', f.type === 'liquid' ? 'קירור נוזלי' : 'קירור אוויר');
      if (f.radiator) add('רדיאטור', `${f.radiator}mm`);
      if (f.tdp && new RegExp(`${f.tdp}\\s?w\\b`, 'i').test(t)) add('TDP', `${f.tdp}W`);
      break;
    default:
      break;
  }
  return rows;
}

async function showFacts(box) {
  const src = box.dataset.parserSrc;
  const list = box.querySelector('.dsp-facts__list');
  if (!src || !list) return;
  try {
    const { parseTitle } = await import(src);
    const rows = factsOf(box.dataset.title || '', parseTitle(box.dataset.title || ''));
    if (rows.length < 2) return;
    list.replaceChildren(
      ...rows.map(([label, value]) => {
        const li = document.createElement('li');
        li.className = 'dsp-facts__item';
        const l = document.createElement('span');
        l.className = 'dsp-facts__label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'dsp-facts__value';
        v.textContent = value;
        li.append(l, v);
        return li;
      }),
    );
    box.hidden = false;
  } catch {
    /* No facts: the box stays hidden. */
  }
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-dropship-pdp]').forEach(showDate);
  document.querySelectorAll('[data-dropship-facts]').forEach(showFacts);
}

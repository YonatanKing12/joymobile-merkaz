// The address check's matching (snippets/address-check, assets/address-check.js): the city and the street against
// Israel Post's lists (assets/il-localities.json, assets/il-streets-NN.json; .github/address-check/generate.mjs).
// Pure, no imports, so node tests it as is (.github/address-check/match.test.mjs).
//
// The street steps are the dashboard's (joyMobile-Online-Dashboard, src/lib/israel-post-street.ts checkStreet, 20/11/2026),
// so the cart accepts what the label accepts: Israel Post refused "הגפן" for "גפן", "עמק דותן" for "עמק דותן צור יגאל"
// and "יעכ בן שמן" for "יער בן שמן". The city steps add to the dashboard's (src/server/shipper/localities.ts) the
// spellings the orders show: "קריית" for "קרית", English names ("Haifa", "Beersheba"), "Jerusalem/ירושלים".

/* ------------------------------------------------------------------------------------------------
 * Cities
 * ---------------------------------------------------------------------------------------------- */

/** Direction marks and zero-width characters (a pasted "באר שבע" can carry them) dropped, spaces as one. */
const clean = (v) => String(v ?? '').replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
/** Quotes and dashes as one form, spaces around a dash dropped. */
const dashKey = (v) => clean(v).replace(/[״“”]/g, '"').replace(/[׳`’]/g, "'").replace(/\s*[-‐‑–—־]\s*/g, '-');
/** The same with a dash read as a space ("פרדס חנה כרכור" = "פרדס חנה-כרכור"). */
const spaceKey = (v) => dashKey(v).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
/** No quotes, double yod and vav as one ("קריית" = "קרית", "תקוה" = "תקווה"). */
const looseKey = (v) => spaceKey(v).replace(/["']/g, '').replace(/יי/g, 'י').replace(/וו/g, 'ו');
/** Latin: lower case, letters and spaces only ("Be'er-Sheva" → "beer sheva"). */
const latinKey = (v) => clean(v).toLowerCase().replace(/['’`".]/g, '').replace(/[^a-z]+/g, ' ').trim();
const compact = (v) => v.replace(/ /g, '');

/** Short names typed for a locality whose listed name is longer (the dashboard's, by spaceKey). */
const ALIASES = {
  'תל אביב': 'תל אביב - יפו',
  'ת"א': 'תל אביב - יפו',
  'תא': 'תל אביב - יפו',
  'יפו': 'תל אביב - יפו',
  'מודיעין': 'מודיעין-מכבים-רעות',
  'פרדס חנה': 'פרדס חנה-כרכור',
  'כרכור': 'פרדס חנה-כרכור',
  'נצרת עילית': 'נוף הגליל',
  'יהוד': 'יהוד-מונוסון',
  'ב"ש': 'באר שבע',
  'פ"ת': 'פתח תקווה',
  'ראשל"צ': 'ראשון לציון',
  'קדימה': 'קדימה-צורן',
};

/** English spellings people type, beside the registry's ("be'er sheva", "petah tiqwa"). By latinKey. */
const LATIN = {
  'tel aviv': 'תל אביב - יפו', 'tel aviv yafo': 'תל אביב - יפו', 'tel aviv jaffa': 'תל אביב - יפו', 'tlv': 'תל אביב - יפו', 'jaffa': 'תל אביב - יפו', 'yafo': 'תל אביב - יפו',
  'beersheba': 'באר שבע', 'beer sheba': 'באר שבע', 'beersheva': 'באר שבע', 'beer sheva': 'באר שבע', 'be er sheva': 'באר שבע',
  'petah tikva': 'פתח תקווה', 'petach tikva': 'פתח תקווה', 'petah tiqva': 'פתח תקווה', 'petach tikvah': 'פתח תקווה',
  'rishon lezion': 'ראשון לציון', 'rishon le zion': 'ראשון לציון', 'rishon letzion': 'ראשון לציון', 'rishon': 'ראשון לציון',
  'herzliya': 'הרצליה', 'herzlia': 'הרצליה', 'raanana': 'רעננה', 'ra anana': 'רעננה', 'kfar saba': 'כפר סבא', 'hod hasharon': 'הוד השרון',
  'ramat gan': 'רמת גן', 'givatayim': 'גבעתיים', 'bnei brak': 'בני ברק', 'bne brak': 'בני ברק', 'holon': 'חולון', 'bat yam': 'בת ים',
  'netanya': 'נתניה', 'ashdod': 'אשדוד', 'ashkelon': 'אשקלון', 'rehovot': 'רחובות', 'nes ziona': 'נס ציונה', 'ness ziona': 'נס ציונה',
  'modiin': 'מודיעין-מכבים-רעות', 'modi in': 'מודיעין-מכבים-רעות', 'kiryat gat': 'קרית גת', 'kiryat ono': 'קרית אונו', 'kiryat ata': 'קרית אתא',
  'kiryat motzkin': 'קרית מוצקין', 'kiryat bialik': 'קרית ביאליק', 'kiryat yam': 'קרית ים', 'kiryat shmona': 'קרית שמונה', 'kiryat malachi': 'קרית מלאכי',
  'nazareth': 'נצרת', 'nazareth illit': 'נוף הגליל', 'umm al fahm': 'אום אל-פחם', 'um el fahem': 'אום אל-פחם', 'um al fahem': 'אום אל-פחם', 'umm el fahem': 'אום אל-פחם',
  'taibe': 'טייבה', 'tayibe': 'טייבה', 'tira': 'טירה', 'sakhnin': 'סח\'נין', 'shefaram': 'שפרעם', 'shfaram': 'שפרעם', 'tamra': 'טמרה',
  'yehud': 'יהוד-מונוסון', 'or yehuda': 'אור יהודה', 'rosh haayin': 'ראש העין', 'rosh ha ayin': 'ראש העין', 'el ad': 'אלעד', 'elad': 'אלעד',
  'beit shemesh': 'בית שמש', 'bet shemesh': 'בית שמש', 'karmiel': 'כרמיאל', 'nahariya': 'נהריה', 'acre': 'עכו', 'akko': 'עכו', 'afula': 'עפולה',
  'tiberias': 'טבריה', 'safed': 'צפת', 'tzfat': 'צפת', 'eilat': 'אילת', 'dimona': 'דימונה', 'arad': 'ערד', 'ofakim': 'אופקים', 'sderot': 'שדרות',
  'netivot': 'נתיבות', 'yavne': 'יבנה', 'yavneh': 'יבנה', 'lod': 'לוד', 'ramla': 'רמלה', 'hadera': 'חדרה', 'zichron yaakov': 'זכרון יעקב',
  'zikhron yaakov': 'זכרון יעקב', 'kfar yona': 'כפר יונה', 'even yehuda': 'אבן יהודה', 'kadima': 'קדימה-צורן', 'ramat hasharon': 'רמת השרון',
  'givat shmuel': 'גבעת שמואל', 'kiryat tivon': 'קרית טבעון', 'nesher': 'נשר', 'maale adumim': 'מעלה אדומים', 'ariel': 'אריאל', 'gedera': 'גדרה',
  'mazkeret batya': 'מזכרת בתיה', 'shoham': 'שוהם', 'caesarea': 'קיסריה', 'omer': 'עומר', 'mevaseret zion': 'מבשרת ציון', 'beit shean': 'בית שאן',
};

/** A note typed after the locality: "והסביבה", "ו הסביבה", "והאזור", or a bracketed remark at the end (the dashboard's). */
const TRAILING_NOTE = /(?:[\s,]+ו\s?(?:ה)?(?:סביבה|אזור)|\s*\([^()]*\))\s*[.,]?\s*$/;

function unique(list, key) {
  const m = new Map();
  for (const item of list) {
    const k = key(item.name);
    if (!k) continue;
    // Two localities on one key: never guessed between.
    m.set(k, m.has(k) && m.get(k) !== item ? null : item);
  }
  return m;
}

/** The index of the localities file (`[name, english, shard?]` rows). */
export function cityIndex(rows) {
  const list = rows.map(([name, en, shard]) => ({ name, en: latinKey(en || ''), shard: shard ?? null }));
  const byName = new Map(list.map((c) => [c.name, c]));
  const latin = new Map();
  for (const c of list) {
    if (!c.en) continue;
    for (const k of [c.en, compact(c.en)]) latin.set(k, latin.has(k) && latin.get(k) !== c ? null : c);
  }
  for (const [k, name] of Object.entries(LATIN)) if (byName.has(name)) latin.set(k, byName.get(name)), latin.set(compact(k), byName.get(name));
  const aliases = new Map(Object.entries(ALIASES).filter(([, name]) => byName.has(name)).map(([k, name]) => [spaceKey(k), byName.get(name)]));
  return { list, byName, byDash: unique(list, dashKey), bySpace: unique(list, spaceKey), byLoose: unique(list, looseKey), latin, aliases, loose: list.map((c) => ({ c, k: looseKey(c.name) })) };
}

function listedCity(typed, ix) {
  if (ix.byName.has(typed)) return { city: ix.byName.get(typed), kind: 'exact' };
  const hit = ix.byDash.get(dashKey(typed)) || ix.bySpace.get(spaceKey(typed)) || ix.aliases.get(spaceKey(typed)) || ix.byLoose.get(looseKey(typed));
  if (hit) return { city: hit, kind: 'spelling' };
  const lat = latinKey(typed);
  if (lat && /[a-z]/.test(lat)) {
    const l = ix.latin.get(lat) || ix.latin.get(compact(lat));
    if (l) return { city: l, kind: 'english' };
  }
  return null;
}

/**
 * The typed city against the list: `city` the listed locality (or null), `confident` when it may replace the typed name,
 * `candidates` when several are near. Steps: as listed; the same spelling apart (dashes, quotes, "קריית"/"קרית"), the
 * short names and the English names; a trailing note dropped ("אשקלון והסביבה"); the parts of "Jerusalem/ירושלים";
 * an English name one or two letters apart; a Hebrew name one letter apart (only a suggestion).
 */
export function matchCity(raw, ix) {
  const typed = clean(raw);
  const none = { city: null, confident: false, kind: null, candidates: [] };
  if (!typed) return none;
  let found = listedCity(typed, ix);
  for (let rest = typed; !found && TRAILING_NOTE.test(rest); ) {
    rest = clean(rest.replace(TRAILING_NOTE, ''));
    if (!rest) break;
    found = listedCity(rest, ix);
  }
  if (!found && /[/|,]/.test(typed)) {
    const parts = typed.split(/[/|,]/).map(clean).filter(Boolean).map((p) => listedCity(p, ix)).filter(Boolean);
    const names = [...new Set(parts.map((p) => p.city.name))];
    if (names.length === 1) found = { city: parts[0].city, kind: 'spelling' };
  }
  // "קיבוץ X", "מושב X", "כפר סולם" for "סולם".
  const kind = /^(?:קיבוץ|קבוץ|מושב|ישוב|יישוב|כפר)\s+(.+)$/.exec(typed);
  if (!found && kind) found = listedCity(kind[1], ix);
  // A listed name that starts with the typed one, alone ("קדימה" → "קדימה-צורן").
  if (!found && looseKey(typed).replace(/ /g, '').length >= 4) {
    const k = looseKey(typed);
    const longer = ix.loose.filter((x) => x.k.startsWith(`${k} `));
    if (longer.length === 1) found = { city: longer[0].c, kind: 'prefix' };
  }
  if (found) return { city: found.city, confident: true, kind: found.kind, candidates: [] };
  // A listed name and one more word ("יפיע נצרת"): a suggestion.
  const words = typed.split(' ');
  if (words.length > 1) {
    const head = listedCity(words.slice(0, -1).join(' '), ix);
    if (head) return { city: head.city, confident: false, kind: 'note', candidates: [] };
  }

  const lat = compact(latinKey(typed));
  if (lat.length >= 5 && /^[a-z]+$/.test(lat)) {
    const max = lat.length >= 8 ? 2 : 1;
    const near = new Map();
    for (const [k, c] of ix.latin) {
      if (!c || k.includes(' ')) continue;
      const d = editDistance(lat, k, max);
      if (d <= max && (!near.has(c) || d < near.get(c))) near.set(c, d);
    }
    const best = Math.min(...near.values());
    const top = [...near].filter(([, d]) => d === best).map(([c]) => c);
    if (top.length === 1) return { city: top[0], confident: true, kind: 'english', candidates: [] };
    if (top.length > 1) return { ...none, candidates: top.slice(0, 5).map((c) => c.name) };
    return none;
  }

  const k = looseKey(typed);
  if (k.replace(/ /g, '').length < 4) return none;
  const near = ix.loose.filter((x) => editDistance(k, x.k, 1) <= 1).map((x) => x.c);
  if (near.length === 1) return { city: near[0], confident: false, kind: 'typo', candidates: [] };
  return { ...none, candidates: near.slice(0, 5).map((c) => c.name) };
}

/** Localities for the list under the field: names that start with the typed text first, then names that hold it. */
export function searchCities(q, ix, limit = 8) {
  const k = looseKey(q);
  if (!k) return [];
  const lat = latinKey(q);
  const starts = [], holds = [];
  for (const x of ix.loose) {
    if (x.k.startsWith(k) || x.k.split(' ').some((w) => w.startsWith(k))) starts.push(x.c);
    else if (x.k.includes(k)) holds.push(x.c);
  }
  const out = [...starts.sort((a, b) => a.name.length - b.name.length), ...holds];
  if (!out.length && /[a-z]/.test(lat)) {
    const m = matchCity(q, ix);
    if (m.city) out.push(m.city);
  }
  return [...new Set(out)].slice(0, limit);
}

/* ------------------------------------------------------------------------------------------------
 * Streets (the dashboard's checkStreet, src/lib/israel-post-street.ts)
 * ---------------------------------------------------------------------------------------------- */

const CONFIDENCE = { exact: 1, spelling: 0.95, way_word: 0.9, word_order: 0.9, prefix: 0.85, typo: 0.8 };
export const STREET_CONFIDENT = 0.75;

/** The kinds of way, as written in full and in the list's short forms, each to one form. */
const WAY_WORDS = { רחוב: 'רח', רח: 'רח', שדרות: 'שד', שדרת: 'שד', שדרה: 'שד', שד: 'שד', כיכר: 'ככר', ככר: 'ככר', סמטת: 'סמ', סמטה: 'סמ', סמ: 'סמ', שכונת: 'שכ', שכונה: 'שכ', שכ: 'שכ' };
/** The kinds dropped in step 3 (a square or a neighbourhood is another place than the street of the same name). */
const DROPPED_WAYS = new Set(['רח', 'שד', 'דרך']);
/** A word without its leading ה ("הגפן" = "גפן"); two letter words stay ("הר", "הס"). */
const noHe = (w) => (w.length > 2 && w.startsWith('ה') ? w.slice(1) : w);

export function streetWords(name) {
  return String(name ?? '')
    .replace(/["'`״׳“”’]/g, '')
    .replace(/[-‐-―־.,()/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WAY_WORDS[w] ?? noHe(w));
}

const keyOf = (words) => words.join(' ');
const bareOf = (words) => keyOf(words.length > 1 && DROPPED_WAYS.has(words[0]) ? words.slice(1) : words);
const sortedOf = (bare) => bare.split(' ').sort().join(' ');

const indexes = new WeakMap();
function push(m, k, name) {
  const list = m.get(k);
  if (!list) m.set(k, [name]);
  else if (!list.includes(name)) list.push(name);
}
function indexOf(names) {
  let ix = indexes.get(names);
  if (!ix) {
    ix = { exact: new Set(names), byKey: new Map(), byBare: new Map(), bySorted: new Map(), bares: [] };
    for (const name of names) {
      const words = streetWords(name);
      if (!words.length) continue;
      const bare = bareOf(words);
      push(ix.byKey, keyOf(words), name);
      push(ix.byBare, bare, name);
      push(ix.bySorted, sortedOf(bare), name);
      ix.bares.push({ bare, name });
    }
    indexes.set(names, ix);
  }
  return ix;
}

/** Optimal string alignment distance (a swap of two letters counts as one), or `max + 1` once it is beyond `max`. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

const NONE = { known: false, suggestion: null, confidence: 0, confident: false, kind: null, candidates: [] };
function found(kind, names) {
  if (names.length !== 1) return { ...NONE, candidates: names.slice(0, 5) };
  const confidence = CONFIDENCE[kind];
  return { known: false, suggestion: names[0], confidence, confident: confidence >= STREET_CONFIDENT, kind, candidates: [] };
}

/** The typed street (without its house number) against the locality's listed streets. */
export function checkStreet(typed, names) {
  const t = String(typed ?? '').replace(/\s+/g, ' ').trim();
  if (!t || !names.length) return NONE;
  const ix = indexOf(names);
  if (ix.exact.has(t)) return { known: true, suggestion: null, confidence: 1, confident: true, kind: 'exact', candidates: [] };
  const words = streetWords(t);
  if (!words.length) return NONE;
  const key = keyOf(words);
  const bare = bareOf(words);

  const spelling = ix.byKey.get(key);
  if (spelling) return found('spelling', spelling);
  const way = ix.byBare.get(bare);
  if (way) return found('way_word', way);
  const order = bare.includes(' ') ? ix.bySorted.get(sortedOf(bare)) : undefined;
  if (order) return found('word_order', order);
  if (bare.replace(/ /g, '').length >= 3) {
    const hits = ix.bares.filter((x) => x.bare.startsWith(`${bare} `));
    const longer = [...new Set(hits.map((x) => x.name))];
    if (longer.length) {
      const r = found('prefix', longer);
      const more = hits[0].bare.slice(bare.length + 1).split(' ').length;
      if (r.suggestion && !bare.includes(' ') && more > 1) return { ...r, confidence: 0.7, confident: false };
      return r;
    }
  }

  const letters = bare.replace(/ /g, '').length;
  const max = letters >= 8 ? 2 : letters >= 4 ? 1 : 0;
  if (!max) return NONE;
  const by = new Map();
  for (const x of ix.bares) {
    const d = editDistance(bare, x.bare, max);
    if (d <= max && (!by.has(x.name) || d < by.get(x.name))) by.set(x.name, d);
  }
  if (!by.size) return NONE;
  const best = Math.min(...by.values());
  const nearest = [...by].filter(([, d]) => d === best).map(([n]) => n);
  if (nearest.length !== 1) return { ...NONE, candidates: nearest.slice(0, 5) };
  const alone = [...by.values()].filter((d) => d <= 2).length === 1;
  const confident = best === 1 && letters >= 5 && alone;
  const confidence = confident ? CONFIDENCE.typo : best === 1 ? 0.65 : 0.5;
  return { known: false, suggestion: nearest[0], confidence, confident, kind: 'typo', candidates: [] };
}

/** Streets for the list under the field: by the words as checkStreet reads them, names that start with them first. */
export function searchStreets(q, names, limit = 8) {
  const bare = bareOf(streetWords(q));
  if (!bare) return [];
  const ix = indexOf(names);
  const starts = [], holds = [];
  for (const x of ix.bares) {
    if (x.bare.startsWith(bare) || x.bare.split(' ').some((w) => w.startsWith(bare))) starts.push(x.name);
    else if (x.bare.includes(bare)) holds.push(x.name);
  }
  return [...new Set([...starts.sort((a, b) => a.length - b.length), ...holds])].slice(0, limit);
}

/** "הגפן 50" → הגפן, 50; "50 הגפן" → הגפן, 50; "7" → (no street), 7; "הגפן" → הגפן, (no number). The dashboard's. */
export function splitStreetLine(line) {
  const s = String(line ?? '').replace(/\s+/g, ' ').trim();
  const only = /^(\d{1,5}\s?[א-ת]?)$/u.exec(s);
  if (only) return { street: '', number: only[1].replace(/\s/g, '') };
  const last = /^(.*?\D)[\s,]*(\d{1,5}[א-ת]?)$/u.exec(s);
  if (last && last[1].replace(/[\s,]/g, '')) return { street: last[1].replace(/[\s,]+$/, '').trim(), number: last[2] };
  const first = /^(\d{1,5}[א-ת]?)[\s,]+(\D.*)$/u.exec(s);
  if (first) return { street: first[2].trim(), number: first[1] };
  return { street: s, number: '' };
}

/** A house number as Israel Post takes it: digits, and one Hebrew letter after them ("12", "12א"). */
export const HOUSE_NUMBER = /^\d{1,5}\s?[א-ת]?$/u;

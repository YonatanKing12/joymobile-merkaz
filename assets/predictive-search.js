// /search/suggest rejects Hebrew on this store (HTTP 417), so this renders the search page's section instead.
import { routes, debounce, fetchSectionHTML, parseHTML, announce, t, define } from '@theme/global';

const PARAMS = '&type=product,article,page&options[prefix]=last&options[unavailable_products]=last';

/* Search tolerance: a query typed in the wrong keyboard layout ("ןפיםמק" for iphone, "thhpui" for אייפון) and a few
   Hebrew names the store's search reads badly ("כיסוי איירפודס" finds 0 products, "כיסוי airpods" 97).
   Decided on the query itself, before searching: the store's search never answers gibberish with "no results" but with
   wrong ones (ןפיםמק: 249 products, a Pokémon card first), so "retry when nothing is found" cannot work.
   A word is replaced by its other-layout reading only when the catalogue lexicon (assets/search-lexicon.json: words of
   the product titles, vendors, types and tags) does not know it and does know the reading. Text that reads as Hebrew
   (no final letter inside a word) may be a word the lexicon lacks, so it is remapped only from 4 letters on and only
   when no other word of the query is known. Measured on the catalogue: 93% of the lexicon's words typed in the wrong
   layout are fixed (99% of their 4+ letter prefixes); of 22,000 real queries (title, description and common English
   words, title openings, and every prefix of them) one is misread: "cer", a step of typing "ceramic", is read as בקר.
   A 3-letter Latin name typed in Hebrew ("חנך" for jbl) is left alone: it is also Hebrew. */
const KEYS_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const KEYS_HE = "/'קראטוןםפ][שדגכעיחלךף,זסבהנמצתץ.";
const EN2HE = new Map([...KEYS_EN].map((c, i) => [c, KEYS_HE[i]]));
const HE2EN = new Map([...KEYS_HE].map((c, i) => [c, KEYS_EN[i]]));
const HEB = /[א-ת]/, LAT = /[a-z]/, HEB_LETTER = /[א-ת']/, WORD = /[0-9a-zא-ת]+/g;
const FINAL_INSIDE = /[ךםןףץ](?=[א-ת])/; // final forms end Hebrew words: inside one, it is not Hebrew
const MIN = 3;
let lexicon = null, lexiconLoad = null;

// One small file (~3KB gzipped), fetched once per page on the first focus of a search field and shared by every field,
// so it is never aborted. If it fails, search works exactly as without it.
function loadLexicon(url) {
  return (lexiconLoad ||= (url ? fetch(url).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
    .catch(() => null)
    .then((data) => {
      const words = Array.isArray(data?.words) ? data.words.filter((w) => typeof w === 'string').sort() : [];
      lexicon = { words, synonyms: new Map(Object.entries(data?.synonyms || {})) };
    }));
}

function lowerBound(w) {
  const { words } = lexicon;
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid] < w) lo = mid + 1;
    else hi = mid;
  }
  return words[lo];
}
const hasPrefix = (w) => !!lowerBound(w)?.startsWith(w); // a prefix: suggestions run mid-word
const hasWord = (w) => lowerBound(w) === w;
const wordsOf = (text) => (text.match(WORD) || []).filter((w) => w.length >= MIN && !/^\d+$/.test(w));
const known = (text) => wordsOf(text).some(hasPrefix);

// The same keys in the other layout, or null: both scripts (the shopper's choice, "מגן ל-iphone") or none (a SKU),
// a reading that needs punctuation, or Hebrew with a final letter inside a word.
function otherLayout(token) {
  const heb = HEB.test(token);
  if (heb === LAT.test(token)) return null;
  const table = heb ? HE2EN : EN2HE, letter = heb ? LAT : HEB_LETTER;
  let out = '';
  for (const c of token) {
    const m = table.get(c) ?? c;
    if (m !== c && !letter.test(m)) return null;
    out += m;
  }
  return heb || !FINAL_INSIDE.test(out) ? out : null;
}

function fixLayout(token, othersKnown) {
  if (known(token)) return token;
  const alt = otherLayout(token), words = alt ? wordsOf(alt) : [];
  if (!words.length) return token;
  if (HEB.test(token)) {
    if (!FINAL_INSIDE.test(token) && (othersKnown || words[0].length <= MIN)) return token;
    return words.some(hasPrefix) ? alt : token;
  }
  return words.some((w) => (w.length > MIN ? hasPrefix(w) : hasWord(w))) ? alt : token;
}

// "אייפון" → "iphone", also "לאייפון" (accessory titles say "ל-iPhone"): only names measured to search better in English.
const synonym = (token) =>
  lexicon.synonyms.get(token) || (/^[לה]/.test(token) && lexicon.synonyms.get(token.slice(1))) || token;

// The query to search instead of `query`, or null (also while the lexicon is not loaded).
function correctQuery(query) {
  if (!lexicon?.words.length) return null;
  const q = query.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const tokens = q.split(' '), isKnown = tokens.map(known);
  const fixed = tokens.map((tok, i) => synonym(fixLayout(tok, isKnown.some((k, j) => k && j !== i)))).join(' ');
  return q && fixed !== q ? fixed : null;
}

// Puts `node` where the Liquid `t` call left the "[[terms]]" placeholder (no braces: Shopify's Liquid parser ends an output tag at the first "}", even inside a string) (the text itself comes from the locale).
function fillTerms(el, node) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const at = text.data.indexOf('[[terms]]');
    if (at < 0) continue;
    const rest = text.splitText(at);
    rest.data = rest.data.slice('[[terms]]'.length);
    text.after(node);
    return;
  }
}
const bdi = (text) => Object.assign(document.createElement('bdi'), { textContent: text });

/* --vv-height: the bottom of the visible viewport, measured from the top of the layout viewport, i.e. what 100dvh means
   until a phone's keyboard opens. The keyboard shrinks only the visual viewport, so the suggestion list and the phone's
   search panel (component-predictive-search.css, section-header.css) use this, with 100dvh as the fallback. Not under
   pinch zoom: the visual viewport is small then because it is magnified, not covered. */
const vv = window.visualViewport;
let vvUsers = 0, vvFrame = 0;
function publishViewport() {
  vvFrame = 0;
  const { style } = document.documentElement;
  if (vv.scale > 1.01) style.removeProperty('--vv-height');
  else style.setProperty('--vv-height', `${Math.round(vv.offsetTop + vv.height)}px`);
}
const onViewport = () => (vvFrame ||= requestAnimationFrame(publishViewport));
function watchViewport(on) {
  if (!vv) return;
  vvUsers += on ? 1 : -1;
  if (on && vvUsers === 1) {
    vv.addEventListener('resize', onViewport);
    vv.addEventListener('scroll', onViewport);
    publishViewport();
  } else if (!on && !vvUsers) {
    vv.removeEventListener('resize', onViewport);
    vv.removeEventListener('scroll', onViewport);
    cancelAnimationFrame(vvFrame);
    vvFrame = 0;
    document.documentElement.style.removeProperty('--vv-height');
  }
}

class PredictiveSearch extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input[name="q"]');
    this.results = this.querySelector('[data-results]');
    if (!this.input || !this.results) return;
    this.status = this.querySelector('[data-status]');
    this.soon = debounce(() => this.search(), 250);
    ['input', 'keydown', 'focusin', 'focusout', 'submit'].forEach((type) => this.addEventListener(type, this));
    this.results.addEventListener('mousedown', this); // keep focus in the input
    watchViewport((this.watching = true));
  }

  disconnectedCallback() {
    this.ctrl?.abort();
    clearTimeout(this.sayTimer);
    if (this.watching) watchViewport((this.watching = false));
  }

  get query() { return this.input.value.trim(); }
  get options() { return [...this.results.querySelectorAll('[role="option"]')]; }

  handleEvent(e) {
    const { type, target } = e;
    if (type === 'input') this.query.length < 2 ? this.close(true) : this.soon();
    else if (type === 'mousedown') e.preventDefault();
    else if (type === 'focusin') loadLexicon(this.dataset.lexicon);
    else if (type === 'focusout') this.contains(e.relatedTarget) || this.close();
    else if (type === 'submit') this.onSubmit(e);
    else if (target === this.input) this.onKey(e);
  }

  // Enter searches what the suggestions showed: the corrected query, with the typed one in `typed` so the results page
  // offers it back (<search-correction> in sections/main-search).
  onSubmit(e) {
    const form = e.target, typed = this.query, fixed = correctQuery(typed);
    if (!fixed || !(form instanceof HTMLFormElement)) return;
    e.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    params.set('q', fixed);
    params.set('typed', typed);
    location.assign(`${form.action}?${params}`);
  }

  onKey(e) {
    const options = this.options, n = options.length, isOpen = !this.results.hidden;
    const current = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      this.open();
      this.select(current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n);
    } else if (e.key === 'Enter') {
      if (!isOpen || current < 0) return;
      const option = options[current];
      (option.closest('a') || option.querySelector('a') || option).click();
    } else if (e.key === 'Escape') {
      if (isOpen) this.close();
      else if (this.input.value) this.input.value = '';
      else return;
    } else return;
    e.preventDefault();
  }

  select(i) {
    this.options.forEach((o, j) => o.setAttribute('aria-selected', i === j));
    const option = this.options[i];
    if (!option) return this.input.removeAttribute('aria-activedescendant');
    option.id ||= `${this.results.id}-${i}`;
    this.input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  open() {
    this.results.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  close(clear) {
    if (clear) {
      this.ctrl?.abort();
      this.results.replaceChildren();
    }
    this.select(-1);
    this.results.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
  }

  // The live region sits inside the component, so it still speaks while the phone's search panel is an aria-modal
  // dialog (VoiceOver ignores live regions outside an open modal). Clearing first re-announces a repeated sentence.
  say(message) {
    if (!message) return;
    if (!this.status) return announce(message);
    clearTimeout(this.sayTimer);
    this.status.textContent = '';
    this.sayTimer = setTimeout(() => (this.status.textContent = message), 100);
  }

  // The panel's stylesheet loads without blocking (sections/header.liquid: it held up the hero). Results
  // wait for it, so a search typed on a slow connection before it lands is never drawn unstyled over the page.
  styled() {
    const links = [...document.querySelectorAll('link[href*="component-predictive-search"]')];
    const pending = links.filter((link) => link.media === 'print');
    if (!pending.length || pending.length < links.length) return Promise.resolve();
    // At most 4s: a sheet that failed (or errored before this listened) must not hold the results for good.
    return new Promise((resolve) => {
      setTimeout(resolve, 4000);
      pending.forEach((link) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
      });
    });
  }

  async search() {
    const typed = this.query;
    if (typed.length < 2) return;
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    this.setAttribute('aria-busy', 'true');
    try {
      await loadLexicon(this.dataset.lexicon);
      if (ctrl.signal.aborted) return;
      const fixed = correctQuery(typed);
      const url = `${routes.search}?q=${encodeURIComponent(fixed || typed)}${PARAMS}`;
      const doc = parseHTML(await fetchSectionHTML(url, 'predictive-search', { signal: ctrl.signal }));
      const section = doc.querySelector('.shopify-section') || doc;
      const message = this.prepare(section, fixed ? typed : '');
      await this.styled();
      if (ctrl.signal.aborted) return;
      this.results.replaceChildren(...section.childNodes);
      this.say(message);
    } catch (err) {
      if (err.name === 'AbortError') return;
      const p = Object.assign(document.createElement('p'), { className: 'predictive-search__error', textContent: t('error') });
      this.results.replaceChildren(p);
      this.say(t('error'));
    } finally {
      if (ctrl === this.ctrl) this.removeAttribute('aria-busy');
    }
    if (this.contains(document.activeElement)) this.open();
  }

  // The section renders the sentence to announce ([data-announce]: one / many / none) and a hidden correction row
  // ([data-fix]: "מציג תוצאות עבור „iphone”" + a link that searches what was typed). Returns the announcement.
  prepare(section, typed) {
    const status = section.querySelector('[data-announce]'), fix = section.querySelector('[data-fix]');
    const message = status?.textContent.trim() || '';
    status?.remove();
    if (!fix) return message;
    if (!typed) {
      fix.remove();
      return message;
    }
    fillTerms(fix, bdi(typed));
    fix.setAttribute('href', `${routes.search}?q=${encodeURIComponent(typed)}&options%5Bprefix%5D=last&exact=1`);
    fix.hidden = false;
    const all = section.querySelector('[data-all-results]');
    all?.setAttribute('href', `${all.getAttribute('href')}&typed=${encodeURIComponent(typed)}`);
    const lead = fix.querySelector('[data-fix-lead]')?.textContent.trim();
    return lead ? `${lead}. ${message}` : message;
  }
}

/* The results page: "מציג תוצאות עבור „iphone”. לחיפוש „ןפיםמק” במקום זאת" after a corrected search (?typed=), or
   "האם התכוונת ל„iphone”?" when the page was opened with a query this script would have corrected (a form without this
   script, a link, the history). Links only: the page never redirects itself, so nothing can loop. */
class SearchCorrection extends HTMLElement {
  connectedCallback() {
    const params = new URLSearchParams(location.search);
    const query = (params.get('q') || '').trim(), typed = (params.get('typed') || '').trim();
    if (!query) return;
    if (typed && typed !== query) return this.show('[data-corrected]', '[data-original]', bdi(typed), this.url(typed, true));
    if (params.has('exact')) return; // the shopper chose the query as typed
    loadLexicon(this.dataset.lexicon).then(() => {
      const fixed = this.isConnected && correctQuery(query);
      if (!fixed) return;
      const link = Object.assign(document.createElement('a'), { href: this.url(fixed) });
      link.append(bdi(fixed));
      this.show('[data-suggest]', '[data-suggest]', link);
    });
  }

  url(term, exact) {
    const params = new URLSearchParams(location.search);
    ['page', 'typed', 'exact'].forEach((key) => params.delete(key));
    params.set('q', term);
    if (exact) params.set('exact', '1');
    return `${location.pathname}?${params}`;
  }

  show(lineSelector, slotSelector, node, href) {
    const line = this.querySelector(lineSelector);
    const slot = line?.matches(slotSelector) ? line : line?.querySelector(slotSelector);
    if (!slot) return;
    fillTerms(slot, node);
    if (href) slot.setAttribute('href', href);
    line.hidden = false;
    this.hidden = false;
  }
}

define('predictive-search', PredictiveSearch);
define('search-correction', SearchCorrection);

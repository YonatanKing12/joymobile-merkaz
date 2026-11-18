/* ==========================================================================
   pc-builder.js — "מרכיב מחשבים" (sections/pc-builder). Vanilla ES module, no dependencies.

   Data: every product of the section's collection, read page by page from /collections/<handle>/products.json
   (250 a page) and turned into parts by assets/pc-builder-parser.js; frame-rate estimates come from
   assets/pc-builder-fps.js (both URLs in data-*-src, so the versioned assets are the ones imported). Metafield
   overrides (pc.*) come from the section's JSON block.

   Two modes: guided (use, games and screen, budget → three compatible builds) and step by step (each step lists the
   parts that fit the steps before it; a part that clashes with a later choice says what it will replace).
   Compatibility is strict: an incompatible part can never be chosen, a new choice removes the later parts it no
   longer fits (notice + undo), a shared link or a saved build is cleaned on load, and the cart and the quote need a
   complete build that passes every check (validated again right before /cart/add.js).
   The summary (a slim bar on phones) holds the parts, the total with its payments (section settings: interest-free
   payments, most payments), the power estimate, an FPS estimate, the cart, WhatsApp and a "more" menu: printable quote, save for comparison (localStorage, up to 3), compare, link, clear.
   The selection lives in the URL (?build=<variant ids>), so a link brings back the same computer.
   ========================================================================== */

const html = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const fmt = (n) => money.format(Math.round(n || 0));
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

/* The supplier's titles open with the Hebrew kind ("מעבד", "לוח אם למעבדי"): the short name starts at the first Latin word. */
const shortName = (title) => {
  const i = title.search(/[A-Za-z0-9]/);
  return i > 0 ? title.slice(i).trim() : title;
};

/* The name after the maker, which the row prints on its own ("Gigabyte" + "B850M DS3H…"). */
const withoutBrand = (part) => {
  const name = shortName(part.title);
  const i = name.toLowerCase().indexOf(`${part.brand.toLowerCase()} `);
  return i >= 0 && i < 16 ? name.slice(i + part.brand.length + 1).trim() : name;
};

/* Each step's name with the article, and "to" it: "לוח האם הוסר כי אינו מתאים למעבד החדש". */
const DEFINITE = { cpu: 'המעבד', board: 'לוח האם', ram: 'הזיכרון', gpu: 'כרטיס המסך', storage: 'האחסון', cooler: 'הקירור', psu: 'ספק הכוח', case: 'המארז', os: 'מערכת ההפעלה' };
const TO = { cpu: 'למעבד', board: 'ללוח האם', ram: 'לזיכרון', gpu: 'לכרטיס המסך', storage: 'לאחסון', cooler: 'לקירור', psu: 'לספק הכוח', case: 'למארז' };
const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ו${items[items.length - 1]}`);

/* Shopify CDN pictures can be asked for at the size shown. */
const sized = (src, w) => {
  if (!src) return '';
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}width=${w}`;
};

const PAGE_SIZE = 24;
const SAVED_KEY = 'pcb-compare-v1';
const SAVED_MAX = 3;
const QUOTE_HOURS = 24;
/* Shown on the cards and in the summary when the customer picked no games. */
const DEFAULT_GAMES = ['fortnite', 'cs2', 'cyberpunk'];

const store = {
  read() {
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      return Array.isArray(list) ? list.filter((s) => s && Array.isArray(s.ids)).slice(0, SAVED_MAX) : [];
    } catch {
      return [];
    }
  },
  write(list) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  },
};

class PcBuilder {
  constructor(el) {
    this.el = el;
    this.d = el.dataset;
    this.uid = el.id || 'pcb';
    this.parts = [];
    this.byVariant = new Map();
    this.sel = { extra: [] };
    this.step = 'cpu';
    this.filters = {};
    this.showBlocked = {};
    this.shown = {};
    this.guided = { use: 'gaming', budget: Number(this.d.budgetDefault) || 6000, includeOs: this.d.includeOs !== 'false', games: [], res: '1080p' };
    this.builds = [];
    this.notice = null;
    this.saved = store.read();
    this.$ = (s) => el.querySelector(s);
    this.status = this.$('[data-status]');
    // The quote prints alone: its dialog lives directly under <body> (the print stylesheet hides every other child).
    this.quote = this.$('[data-quote-dialog]');
    if (this.quote) {
      document.getElementById(`${this.uid}-quote`)?.remove();
      this.quote.id = `${this.uid}-quote`;
      document.body.append(this.quote);
      this.quote.addEventListener('click', (e) => {
        if (e.target === this.quote || e.target.closest('[data-quote-close]')) this.quote.close();
        else if (e.target.closest('[data-quote-print]')) window.print();
      });
    }
    this.compare = this.$('[data-compare-dialog]');
    this.compare?.addEventListener('click', (e) => { if (e.target === this.compare) this.compare.close(); });
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('change', (e) => this.onChange(e));
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('keydown', (e) => this.onKeydown(e));
    document.addEventListener('click', (e) => { if (!e.target.closest('.pcb-more')) this.toggleMore(false); });
    this.start();
  }

  async start() {
    try {
      // The parts download alongside the two modules (the section preloads them), not after them.
      let products;
      [this.P, this.F, products] = await Promise.all([import(this.d.parserSrc), import(this.d.fpsSrc), this.fetchProducts()]);
      this.load(products);
    } catch (err) {
      console.error('[pc-builder]', err);
      this.say('לא הצלחנו לטעון את רשימת הרכיבים. אפשר לרענן את העמוד או לפנות אלינו בוואטסאפ.', true);
      this.el.classList.add('pcb--error');
      return;
    }
    this.el.classList.add('pcb--ready');
    this.renderGames();
    this.restore();
    this.renderAll();
  }

  /* ---------- data ---------- */

  /**
   * Every product of the collection, 250 a page. The pages the collection's count calls for (data-pages) are fetched
   * at once, with the same URLs as the section's preload links (so no extra header: it would not match them); pages
   * past those, if the count was low, follow one by one until a page comes back short or brings nothing new.
   */
  async fetchProducts() {
    const source = this.d.source;
    if (!source) throw new Error('no collection');
    const get = async (page) => {
      const res = await fetch(source.replace('{page}', page));
      if (!res.ok) throw new Error(`products.json ${res.status}`);
      return (await res.json()).products || [];
    };
    const seen = new Map();
    const add = (products) => {
      let added = 0;
      for (const p of products) if (!seen.has(p.id)) { seen.set(p.id, p); added++; }
      return added;
    };
    const first = Math.min(Math.max(Number(this.d.pages) || 1, 1), 40);
    const pages = await Promise.all(Array.from({ length: first }, (_, i) => get(i + 1)));
    let more = true;
    for (const products of pages) more = add(products) > 0 && products.length >= 250;
    for (let page = first + 1; more && page <= 40; page++) {
      const products = await get(page);
      more = add(products) > 0 && products.length >= 250;
    }
    return seen;
  }

  load(seen) {
    const overrides = JSON.parse(this.$('[data-pcb-overrides]')?.textContent || '{}');
    for (const product of seen.values()) {
      const part = this.P.toPart(product, overrides[product.id] || {});
      if (!part || !this.P.STEP_KEYS.includes(part.category)) continue;
      this.parts.push(part);
      this.byVariant.set(String(part.variantId), part);
    }
    this.byCat = this.P.groupParts(this.parts);
    for (const list of Object.values(this.byCat)) list.sort((a, b) => a.price - b.price);
    if (!this.parts.length) throw new Error('empty collection');
    this.say('');
  }

  /** Variant ids → a clean selection: unknown or sold-out ids are skipped, clashing parts dropped in step order. */
  fromIds(ids) {
    const raw = { extra: [] };
    let gone = 0;
    for (const id of ids) {
      const part = this.byVariant.get(String(id));
      if (!part) { gone++; continue; }
      if (part.category === 'extra') { if (!raw.extra.includes(part)) raw.extra.push(part); }
      else raw[part.category] = part;
    }
    const { sel, removed } = this.P.sanitize(raw);
    return { sel, removed, gone };
  }

  restore() {
    const q = new URLSearchParams(location.search);
    const ids = (q.get('build') || '').split(/[,\s]+/).filter(Boolean);
    if (ids.length) {
      const { sel, removed, gone } = this.fromIds(ids);
      this.sel = sel;
      const lines = [];
      if (gone) lines.push('חלק מהרכיבים בקישור כבר לא זמינים באתר.');
      if (removed.length) lines.push(`בקישור היו רכיבים שלא מתאימים זה לזה: ${this.removedText(removed)}`);
      if (lines.length) this.setNotice(lines.join(' '));
    }
    const mode = q.get('mode') || (ids.length ? 'steps' : this.d.defaultMode || 'guided');
    this.mode = mode === 'steps' ? 'steps' : 'guided';
    const use = q.get('use');
    if (use && this.P.USES[use]) this.guided.use = use;
    const budget = Number(q.get('budget'));
    if (budget) this.guided.budget = budget;
    const games = (q.get('games') || '').split(',').filter((g) => this.F.gameOf(g));
    if (games.length) this.guided.games = games;
    const res = q.get('res');
    if (this.F.RESOLUTIONS.some((r) => r.key === res)) this.guided.res = res;
    const form = this.$('[data-guided-form]');
    if (form) {
      const radio = form.querySelector(`input[name="use"][value="${this.guided.use}"]`);
      if (radio) radio.checked = true;
      const resRadio = form.querySelector(`input[name="res"][value="${this.guided.res}"]`);
      if (resRadio) resRadio.checked = true;
      for (const box of form.querySelectorAll('input[name="game"]')) box.checked = this.guided.games.includes(box.value);
      form.budget.value = this.guided.budget;
      form.include_os.checked = this.guided.includeOs;
      this.showBudget();
    }
    this.step = this.firstOpenStep() || 'cpu';
  }

  selectedList(sel = this.sel) {
    return [...this.P.STEP_KEYS.filter((k) => k !== 'extra').map((k) => sel[k]).filter(Boolean), ...(sel.extra || [])];
  }

  total(sel = this.sel) {
    return this.selectedList(sel).reduce((s, p) => s + p.price, 0);
  }

  firstOpenStep() {
    return this.P.requiredSteps(this.sel).find((k) => !this.sel[k]);
  }

  syncUrl() {
    const u = new URL(location.href);
    const ids = this.selectedList().map((p) => p.variantId);
    if (ids.length) u.searchParams.set('build', ids.join(','));
    else u.searchParams.delete('build');
    u.searchParams.set('mode', this.mode);
    for (const k of ['use', 'budget', 'games', 'res']) u.searchParams.delete(k);
    if (this.mode === 'guided') {
      u.searchParams.set('use', this.guided.use);
      u.searchParams.set('budget', this.guided.budget);
      if (this.guided.use === 'gaming' && this.guided.games.length) u.searchParams.set('games', this.guided.games.join(','));
      if (this.guided.use === 'gaming' && this.guided.res !== '1080p') u.searchParams.set('res', this.guided.res);
    }
    history.replaceState(history.state, '', u);
  }

  say(text, error = false) {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.hidden = !text;
    this.status.classList.toggle('pcb__status--error', error);
  }

  announce(text) {
    const live = this.$('[data-live]');
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }

  /** "לוח האם והזיכרון הוסרו כי אינם מתאימים למעבד החדש." (after a choice), or "…לשאר הרכיבים." (a link, a saved build). */
  removedText(removed, key = null) {
    const names = andList(removed.map((r) => DEFINITE[r.step] || this.label(r.step)));
    const one = removed.length === 1;
    return `${names} ${one ? 'הוסר כי אינו מתאים' : 'הוסרו כי אינם מתאימים'} ${key ? `${TO[key] || this.label(key)} החדש` : 'לשאר הרכיבים'}.`;
  }

  setNotice(text, undo = null) {
    this.notice = text ? { text, undo } : null;
    this.renderNotice();
  }

  renderNotice() {
    const box = this.$('[data-notice]');
    if (!box) return;
    box.hidden = !this.notice;
    box.innerHTML = this.notice
      ? `<p>${html(this.notice.text)}</p>
         <div class="pcb-notice__actions">
           ${this.notice.undo ? '<button type="button" class="link" data-action="undo">ביטול השינוי</button>' : ''}
           <button type="button" class="link" data-action="dismiss">הבנתי</button>
         </div>`
      : '';
  }

  /* ---------- rendering ---------- */

  renderAll() {
    this.renderMode();
    if (this.mode === 'guided') this.renderGuided();
    else this.renderSteps();
    this.renderSummary();
    this.renderNotice();
    this.syncUrl();
  }

  renderMode() {
    for (const tab of this.el.querySelectorAll('[data-mode-tab]')) {
      const on = tab.dataset.modeTab === this.mode;
      tab.setAttribute('aria-selected', on);
      tab.tabIndex = on ? 0 : -1;
    }
    for (const panel of this.el.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== this.mode;
  }

  renderGames() {
    const box = this.$('[data-games]');
    if (!box) return;
    box.innerHTML = this.F.GAMES.map((g) => `
      <label class="pcb-chip"><input type="checkbox" name="game" value="${html(g.key)}"><span>${html(g.short || g.label)}</span></label>`).join('');
  }

  aim() {
    const g = this.guided;
    if (g.use !== 'gaming' || !g.games.length) return null;
    return { score: (sel) => this.F.aimScore(sel, g.games, g.res) };
  }

  /** The games whose estimate is shown: the customer's, or a short default list. */
  shownGames() {
    return this.guided.use === 'gaming' && this.guided.games.length ? this.guided.games : DEFAULT_GAMES;
  }

  resLabel(res = this.guided.res) {
    return this.F.RESOLUTIONS.find((r) => r.key === res)?.label || res;
  }

  /** One discreet line: "Fortnite 135 · CS2 245 · Cyberpunk 90 FPS", with how many games reach their target. */
  fpsLine(sel) {
    if (!this.F.graphicsOf(sel)) return '';
    const res = this.guided.use === 'gaming' ? this.guided.res : '1080p';
    const rows = this.F.estimateBuild(sel, this.shownGames(), res).filter((r) => r.fps !== null);
    if (!rows.length) return '';
    const chosen = this.guided.use === 'gaming' && this.guided.games.length;
    const met = rows.filter((r) => r.meets).length;
    const list = rows.map((r) => `<span class="pcb-fps__g${chosen && !r.meets ? ' is-under' : ''}">${html(r.label)} <b>${this.F.fpsText(r.fps)}</b></span>`).join('');
    return `<p class="pcb-fps">
      <span class="pcb-fps__head">הערכת FPS בלבד, ${html(this.resLabel(res))}${chosen ? ` · ${met === rows.length ? 'עומד ביעד' : met ? `ביעד ב־${met} מתוך ${rows.length}` : 'מתחת ליעד'}` : ''}</span>
      <span class="pcb-fps__list">${list}</span></p>`;
  }

  renderGuided() {
    const box = this.$('[data-builds]');
    if (!box) return;
    const gaming = this.guided.use === 'gaming';
    for (const f of this.el.querySelectorAll('[data-games-field], [data-res-field]')) f.hidden = !gaming;
    this.builds = this.P.planBuilds(this.parts, { ...this.guided, aim: this.aim() });
    const idsOf = (list) => list.map((p) => p.variantId).sort().join(',');
    const chosenIds = idsOf(this.selectedList());
    // Tiers that came out the same computer (a low budget) are shown once.
    const seen = new Set();
    const unique = this.builds.filter((b) => {
      const ids = Object.values(b.parts).map((p) => p.variantId).join(',');
      if (seen.has(ids)) return false;
      seen.add(ids);
      return true;
    });
    const floor = Math.min(...this.builds.map((b) => b.total));
    const note = unique.length < this.builds.length && floor > this.guided.budget
      ? `<p class="pcb-builds__note">המחשב המשתלם ביותר ל${html(this.P.USES[this.guided.use].label)} שאפשר להרכיב כרגע עולה ${fmt(floor)}.</p>`
      : '';
    const KEY_ROWS = ['cpu', 'gpu', 'ram', 'storage'];
    box.innerHTML = note + unique
      .map((b) => {
        const selected = idsOf(Object.values(b.parts)) === chosenIds;
        const over = b.total > this.guided.budget;
        const row = (k) => `<div class="pcb-build__row"><dt>${html(this.label(k))}</dt><dd>${html(this.brief(b.parts[k]))}</dd></div>`;
        const main = KEY_ROWS.filter((k) => b.parts[k]).map(row).join('');
        const gfx = !b.parts.gpu && b.parts.cpu?.facts.igpu ? '<div class="pcb-build__row"><dt>גרפיקה</dt><dd>מובנית במעבד</dd></div>' : '';
        const rest = ['board', 'psu', 'case', 'cooler', 'os'].filter((k) => b.parts[k]);
        const fps = this.guided.use !== 'office' ? this.fpsLine(b.parts) : '';
        return `
          <article class="pcb-build${b.key === 'recommended' ? ' is-featured' : ''}${selected ? ' is-selected' : ''}" aria-labelledby="${this.uid}-b-${b.key}">
            <h3 class="pcb-build__tier" id="${this.uid}-b-${b.key}">${html(b.label)}</h3>
            <p class="pcb-build__price">${fmt(b.total)}${over ? ' <span class="pcb-build__over">מעל התקציב</span>' : ''}</p>
            ${this.pay(b.total) ? `<p class="pcb-pay pcb-build__pay">${this.payText(b.total)}</p>` : ''}
            <dl class="pcb-build__specs">${main}${gfx}</dl>
            ${rest.length ? `<details class="pcb-build__more"><summary>ועוד ${rest.length} רכיבים <span class="visually-hidden">(${html(rest.map((k) => this.label(k)).join(', '))})</span></summary><dl class="pcb-build__specs">${rest.map(row).join('')}</dl></details>` : ''}
            ${fps}
            <div class="pcb-build__actions">
              <button type="button" class="button button--full${selected ? ' is-on' : ''}" data-action="use-build" data-build="${b.key}" aria-pressed="${selected}">
                ${selected ? 'נבחר' : 'בחירה'}
              </button>
              <button type="button" class="link pcb-build__edit" data-action="edit-build" data-build="${b.key}">שינוי רכיבים</button>
            </div>
          </article>`;
      })
      .join('');
    box.style.setProperty('--pcb-builds', unique.length);
    if (!this.builds.some((b) => Object.keys(b.parts).length)) box.innerHTML = '<p class="pcb-empty">אין עדיין מספיק רכיבים כדי להציע מחשב. אפשר לפנות אלינו בוואטסאפ ונרכיב לכם הצעה.</p>';
  }

  label(key) {
    return this.P.STEPS.find((s) => s.key === key)?.label || key;
  }

  /** Payments for a total (section settings: interest-free payments, most payments), or null. */
  pay(total) {
    return this.P.installmentsOf(total, this.d.installmentsFree, this.d.installmentsMax);
  }

  /** "או 4 תשלומים של ₪1,481 ללא ריבית", and under it, smaller, "אפשר גם עד 12 תשלומים (בריבית)". */
  payText(total) {
    const p = this.pay(total);
    if (!p) return '';
    return `או ${p.count} תשלומים של <span class="pcb-pay__n">${fmt(p.each)}</span> ללא ריבית${p.max ? `<span class="pcb-pay__more">אפשר גם עד ${p.max} תשלומים (בריבית)</span>` : ''}`;
  }

  brief(part) {
    const f = part.facts;
    switch (part.category) {
      case 'cpu': return f.model ? `${part.brand === 'Intel' ? 'Intel ' : 'AMD '}${f.model}` : shortName(part.title);
      case 'gpu': return f.chip ? `${f.chip}${f.vram ? ` ${f.vram}GB` : ''}` : shortName(part.title);
      case 'ram': return `${f.capacity || '?'}GB ${f.memory || ''}${f.speed ? ` ${f.speed}MHz` : ''}`;
      case 'storage': return `${f.capacityGb >= 1000 ? `${f.capacityGb / 1000}TB` : `${f.capacityGb}GB`} ${f.kind || ''}`;
      case 'psu': return `${f.watts}W${f.rating ? ` ${f.rating}` : ''}`;
      case 'board': return `${part.brand} ${f.chipset || ''} ${f.formFactor || ''}`.trim();
      case 'os': return `Windows 11 ${f.edition}${f.language === 'he' ? ' עברית' : ''}`;
      default: return `${part.brand} ${withoutBrand(part).split(/\s+/).slice(0, 3).join(' ')}`.trim();
    }
  }

  /** At most three key facts, in words. */
  specs(part) {
    const f = part.facts;
    let chips = [];
    switch (part.category) {
      case 'cpu': chips = [f.socket, f.igpu ? 'גרפיקה מובנית' : 'בלי גרפיקה', f.needsCooler === false ? 'כולל קירור' : 'בלי קירור']; break;
      case 'board': chips = [f.socket, f.memory || 'זיכרון לא צוין', f.formFactor, f.backConnect && 'מחברים מאחור']; break;
      case 'ram': chips = [f.memory, f.modules > 1 && `${f.modules}×${f.capacity / f.modules}GB`, f.speed && `${f.speed}MHz`]; break;
      case 'gpu': chips = [f.vram && `${f.vram}GB`, f.watts && `${f.watts}W`, f.length && `${f.length} מ״מ`]; break;
      case 'storage': chips = [f.kind, f.gen && `Gen${f.gen}`]; break;
      case 'cooler': chips = [f.type === 'liquid' ? `נוזלי${f.radiator ? ` ${f.radiator}mm` : ''}` : 'אוויר', f.tdp ? `עד ${f.tdp}W` : 'דירוג לא צוין', f.type === 'air' && f.height && `גובה ${f.height} מ״מ`]; break;
      case 'psu': chips = [f.rating && `80 Plus ${f.rating}`, f.atx3 && 'ATX 3']; break;
      case 'case': chips = [f.formFactor && `עד ${f.formFactor}`, f.gpuMax && `כרטיס עד ${f.gpuMax} מ״מ`, f.backConnect && 'מחברים מאחור']; break;
      case 'os': chips = [f.language === 'he' ? 'עברית' : f.language === 'en' ? 'אנגלית' : null]; break;
      default:
    }
    return chips.filter(Boolean).slice(0, 3);
  }

  stepState(key) {
    if (key === 'extra') return this.sel.extra.length ? `${this.sel.extra.length} נבחרו` : 'לא חובה';
    if (this.sel[key]) return 'נבחר';
    return this.P.requiredSteps(this.sel).includes(key) ? 'חובה' : 'לא חובה';
  }

  renderSteps() {
    const nav = this.$('[data-stepnav]');
    const box = this.$('[data-step-body]');
    if (!nav || !box) return;
    const req = this.P.requiredSteps(this.sel);
    nav.innerHTML = `<ol class="pcb-progress__list" role="list">${this.P.STEPS.map((s) => {
      const current = s.key === this.step;
      const done = s.key === 'extra' ? this.sel.extra.length > 0 : !!this.sel[s.key];
      const optional = s.key !== 'extra' && !req.includes(s.key) && !done;
      return `<li><button type="button" class="pcb-progress__step${done ? ' is-done' : ''}${optional ? ' is-optional' : ''}" data-action="go-step" data-step="${s.key}"${current ? ' aria-current="step"' : ''}>
        <span class="pcb-progress__label">${html(s.label)}</span><span class="visually-hidden">, ${html(this.stepState(s.key))}</span></button></li>`;
    }).join('')}</ol>`;
    const cur = nav.querySelector('[aria-current]');
    if (cur && nav.scrollWidth > nav.clientWidth) {
      // Centre the current step inside the strip only (scrollIntoView would also scroll the page sideways).
      const n = nav.getBoundingClientRect();
      const c = cur.getBoundingClientRect();
      nav.scrollBy({ left: c.left + c.width / 2 - (n.left + n.width / 2) });
    }
    box.innerHTML = this.stepHtml(this.step);
  }

  /** The parts of a step: those that fit the steps before it (with what each would replace among the later choices),
      and those that cannot be chosen, with the reason. */
  candidates(key) {
    const list = this.byCat[key] || [];
    const earlier = this.P.earlierOf(this.sel, key);
    const ok = [];
    const blocked = [];
    for (const part of list) {
      if (key === 'extra') { ok.push({ part, drops: [] }); continue; }
      const fit = this.P.fitOf(part, earlier);
      if (!fit.ok) { blocked.push({ part, fit }); continue; }
      const drops = this.sel[key] === part ? [] : this.P.applyChoice(this.sel, part).removed;
      ok.push({ part, drops, fit });
    }
    return { ok, blocked };
  }

  stepHtml(key) {
    const step = this.P.STEPS.find((s) => s.key === key);
    const index = this.P.STEPS.indexOf(step);
    const required = this.P.requiredSteps(this.sel).includes(key);
    const { ok, blocked } = this.candidates(key);
    const f = (this.filters[key] ||= { brand: '', max: '', sort: 'popular' });
    const brands = [...new Set(ok.map((c) => c.part.brand))].sort((a, b) => a.localeCompare(b));
    const prices = ok.map((c) => c.part.price).sort((a, b) => a - b);
    const caps = this.priceCaps(prices);
    let shown = ok.filter((c) => (!f.brand || c.part.brand === f.brand) && (!f.max || c.part.price <= Number(f.max)));
    if (f.sort === 'price-asc') shown.sort((a, b) => a.part.price - b.part.price);
    else if (f.sort === 'price-desc') shown.sort((a, b) => b.part.price - a.part.price);
    else shown.sort((a, b) => this.rank(b.part) - this.rank(a.part) || a.part.price - b.part.price);
    const matching = shown.length;
    const limit = this.shown[key] || PAGE_SIZE;
    const more = matching - limit;
    shown = shown.slice(0, limit);
    const hint = this.stepHint(key, required);
    const id = `${this.uid}-${key}`;
    const optional = !required
      ? `<button type="button" class="link pcb-step__skip" data-action="skip">${this.sel[key] ? 'הסרת הבחירה' : 'דילוג'}</button>`
      : '';
    return `
      <div class="pcb-step" aria-labelledby="${id}-h">
        <div class="pcb-step__head">
          <h2 class="pcb-step__title" id="${id}-h" tabindex="-1">${html(step.title)}${required ? '' : ' <span class="pcb-step__opt">לא חובה</span>'}</h2>
          ${hint ? `<p class="pcb-step__hint">${html(hint)}</p>` : ''}
        </div>
        ${ok.length > 6 ? `
        <div class="pcb-filters" role="group" aria-label="סינון ${html(step.label)}">
          <div class="pcb-filters__field">
            <label class="visually-hidden" for="${id}-brand">מותג</label>
            <div class="select"><select id="${id}-brand" data-filter="brand">
              <option value="">מותג</option>
              ${brands.map((b) => `<option value="${html(b)}"${b === f.brand ? ' selected' : ''}>${html(b)}</option>`).join('')}
            </select></div>
          </div>
          <div class="pcb-filters__field">
            <label class="visually-hidden" for="${id}-max">מחיר</label>
            <div class="select"><select id="${id}-max" data-filter="max">
              <option value="">מחיר</option>
              ${caps.map((c) => `<option value="${c}"${String(c) === String(f.max) ? ' selected' : ''}>עד ${fmt(c)}</option>`).join('')}
            </select></div>
          </div>
          <div class="pcb-filters__field">
            <label class="visually-hidden" for="${id}-sort">מיון</label>
            <div class="select"><select id="${id}-sort" data-filter="sort">
              <option value="popular"${f.sort === 'popular' ? ' selected' : ''}>מומלץ</option>
              <option value="price-asc"${f.sort === 'price-asc' ? ' selected' : ''}>מחיר עולה</option>
              <option value="price-desc"${f.sort === 'price-desc' ? ' selected' : ''}>מחיר יורד</option>
            </select></div>
          </div>
        </div>` : ''}
        <p class="pcb-step__meta" aria-live="polite">${matching} מתאימים${f.brand || f.max ? ' לסינון' : ''}</p>
        ${shown.length ? `<ul class="pcb-list" role="list">${shown.map((c) => this.partHtml(c.part, key, null, c.drops, c.fit)).join('')}</ul>` : '<p class="pcb-empty">אין מוצרים שמתאימים לסינון. אפשר לנקות את הסינון או לשנות רכיב קודם.</p>'}
        ${more > 0 ? `<button type="button" class="button button--outline pcb-list__more" data-action="more">עוד ${Math.min(more, PAGE_SIZE)}</button>` : ''}
        ${blocked.length ? `
          <div class="pcb-blocked">
            <button type="button" class="pcb-blocked__toggle" data-action="toggle-blocked" aria-expanded="${!!this.showBlocked[key]}" aria-controls="${id}-blocked">
              ${blocked.length} לא מתאימים לרכיבים שבחרתם · <span class="pcb-blocked__why">${this.showBlocked[key] ? 'הסתרה' : 'למה?'}</span>
            </button>
            <ul class="pcb-list pcb-list--blocked" role="list" id="${id}-blocked"${this.showBlocked[key] ? '' : ' hidden'}>
              ${this.showBlocked[key] ? blocked.map((c) => this.partHtml(c.part, key, c.fit.reasons)).join('') : ''}
            </ul>
          </div>` : ''}
        <div class="pcb-step__nav">
          ${index > 0 ? `<button type="button" class="button button--outline" data-action="prev"><span class="visually-hidden">הקודם: </span>${html(this.P.STEPS[index - 1].label)}</button>` : '<span></span>'}
          ${optional}
          ${index < this.P.STEPS.length - 1 ? `<button type="button" class="button" data-action="next">הבא: ${html(this.P.STEPS[index + 1].label)}</button>` : ''}
        </div>
      </div>`;
  }

  stepHint(key, required) {
    const cpu = this.sel.cpu;
    switch (key) {
      case 'cpu': return 'מתחילים במעבד. בשלבים הבאים מוצגים רק רכיבים שמתאימים לו.';
      case 'board': return cpu ? `לוחות לתושבת ${cpu.facts.socket}.` : 'כדאי לבחור קודם מעבד.';
      case 'ram': return this.sel.board?.facts.memory ? `הלוח עובד עם ${this.sel.board.facts.memory}.` : cpu ? `המעבד עובד עם ${({ AM4: 'DDR4', AM5: 'DDR5', LGA1851: 'DDR5' })[cpu.facts.socket] || 'DDR4 או DDR5, לפי הלוח'}.` : '';
      case 'gpu': return cpu && cpu.facts.igpu === false ? 'למעבד אין גרפיקה מובנית, ולכן צריך כרטיס מסך.' : required ? '' : 'למעבד יש גרפיקה מובנית. כרטיס מסך נדרש למשחקים ולעבודה גרפית.';
      case 'cooler': return cpu ? (cpu.facts.needsCooler === false ? 'המעבד מגיע עם קירור.' : `המעבד מגיע בלי קירור. מוצגים קירורים שמתאימים ל־${cpu.facts.watts}W.`) : '';
      case 'psu': {
        const p = this.P.powerOf(this.sel);
        return `צריכה משוערת ${p.draw}W, ולכן ספק של ${p.recommended}W ומעלה.`;
      }
      case 'case': return this.sel.board ? `מארזים ללוח ${this.sel.board.facts.formFactor}.` : '';
      case 'extra': return 'אפשר לבחור כמה.';
      default: return '';
    }
  }

  rank(part) {
    const f = part.facts;
    if (part.category === 'gpu' || part.category === 'cpu') return (f.score || 0) / Math.max(part.price, 1) * 1000;
    return -part.price;
  }

  priceCaps(prices) {
    if (prices.length < 4) return [];
    const out = new Set();
    for (const q of [0.25, 0.5, 0.75]) {
      const v = prices[Math.floor(q * (prices.length - 1))];
      const step = v >= 2000 ? 500 : v >= 500 ? 100 : 50;
      out.add(Math.ceil(v / step) * step);
    }
    return [...out].sort((a, b) => a - b);
  }

  partHtml(part, key, reasons, drops = [], fit = null) {
    const isExtra = key === 'extra';
    const selected = isExtra ? this.sel.extra.includes(part) : this.sel[key] === part;
    const blocked = !!reasons;
    const id = `${this.uid}-p-${part.id}`;
    const chips = this.specs(part);
    const img = part.image
      ? `<img class="pcb-row__img" src="${html(sized(part.image, 120))}" alt="" width="56" height="56" loading="lazy" decoding="async">`
      : '<span class="pcb-row__img pcb-row__img--empty" aria-hidden="true"></span>';
    const dropText = drops.length ? `בחירה תסיר את ${drops.map((d) => this.label(d.step)).join(', ')}` : '';
    // One calm line of advice against the parts chosen so far, or what could not be checked ("לא אומת").
    // A row names only what decides whether the part physically fits; headers and memory profiles wait for the summary.
    const U = this.P.UNVERIFIED;
    const fitChecks = fit ? fit.unverified.filter((u) => u !== U.usbc && u !== U.fanHeaders && u !== U.memProfile) : [];
    const note = blocked || !fit ? '' : fit.notes[0] || (fitChecks.length ? `לא אומת: ${fitChecks.join(', ')}` : '');
    return `
      <li class="pcb-row${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}">
        ${img}
        <div class="pcb-row__info">
          <h3 class="pcb-row__name" id="${id}"><span class="pcb-row__brand">${html(part.brand)}</span> ${html(withoutBrand(part))}</h3>
          ${chips.length ? `<p class="pcb-row__specs">${chips.map(html).join(' · ')}</p>` : ''}
          ${blocked ? `<p class="pcb-row__why"><span class="visually-hidden">לא מתאים: </span>${reasons.map(html).join('. ')}</p>` : ''}
          ${note ? `<p class="pcb-row__note${fit.notes[0] ? '' : ' is-unverified'}">${html(note)}</p>` : ''}
          ${dropText ? `<p class="pcb-row__drop" id="${id}-d">${html(dropText)}</p>` : ''}
        </div>
        <p class="pcb-row__price">${fmt(part.price)}</p>
        ${blocked
          ? ''
          : `<button type="button" class="pcb-row__pick${selected ? ' is-on' : ''}" data-action="choose" data-id="${part.id}" aria-pressed="${selected}" aria-describedby="${id}${dropText ? ` ${id}-d` : ''}">
              ${selected ? (isExtra ? 'נוסף' : 'נבחר') : isExtra ? 'הוספה' : 'בחירה'}</button>`}
      </li>`;
  }

  /** Advice about the build (BIOS, memory profile, the card maker's PSU…) and, in one line, what a representative
      confirms before assembly because the data to check it is missing. */
  notesHtml(check) {
    const notes = check.notes.map((n) => n.text);
    if (!notes.length && !check.unverified.length) return '';
    return `<div class="pcb-sum__notes">
      ${notes.length ? `<ul class="pcb-sum__advice" role="list">${notes.map((n) => `<li>${html(n)}</li>`).join('')}</ul>` : ''}
      ${check.unverified.length ? `<p class="pcb-sum__unverified"><strong>לא אומת: נציג יאשר לפני ההרכבה</strong> <span>${html(check.unverified.join(' · '))}</span></p>` : ''}
    </div>`;
  }

  fpsTable(sel) {
    if (!this.F.graphicsOf(sel)) return '';
    const games = this.guided.use === 'gaming' && this.guided.games.length ? this.guided.games : this.F.GAMES.map((g) => g.key);
    const resList = ['1080p', '1440p', ...(this.guided.res === '4k' ? ['4k'] : [])];
    const est = Object.fromEntries(resList.map((r) => [r, this.F.estimateBuild(sel, games, r)]));
    const rows = games.map((g, i) => `<tr><th scope="row">${html(est['1080p'][i].label)}</th>${resList.map((r) => {
      const e = est[r][i];
      return `<td>${this.F.fpsText(e.fps)}${e.bound === 'cpu' ? '<span class="pcb-fps__cpu" aria-label="מוגבל על ידי המעבד">*</span>' : ''}</td>`;
    }).join('')}</tr>`).join('');
    const cpuBound = resList.some((r) => est[r].some((e) => e.bound === 'cpu'));
    const gfx = this.F.graphicsOf(sel);
    return `<details class="pcb-sum__fps">
      <summary>ביצועים במשחקים <span class="pcb-sum__fps-tag">הערכה בלבד</span></summary>
      <table class="pcb-fps-table"><thead><tr><th scope="col"><span class="visually-hidden">משחק</span></th>${resList.map((r) => `<th scope="col">${html(this.resLabel(r))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <p class="pcb-sum__fine">ממוצע FPS משוער בהגדרות גבוהות, בלי DLSS/FSR, לפי מבחנים פומביים${gfx.integrated ? ', בגרפיקה המובנית במעבד' : ''}.${cpuBound ? ' * המעבד מגביל כאן.' : ''} בפועל זה תלוי בגרסת המשחק ובהגדרות.</p>
    </details>`;
  }

  renderSummary() {
    const box = this.$('[data-summary-body]');
    if (!box) return;
    const check = this.P.checkBuild(this.sel);
    const required = this.P.requiredSteps(this.sel);
    const count = this.selectedList().length;
    const total = this.total();
    const orderable = count > 0 && check.ok;
    const rows = this.P.STEPS.filter((s) => s.key !== 'extra')
      .filter((s) => this.sel[s.key] || required.includes(s.key))
      .map((s) => {
        const p = this.sel[s.key];
        const bad = check.problems.some((x) => x.step === s.key);
        return `<li><button type="button" class="pcb-sum__row${bad ? ' is-bad' : ''}${p ? '' : ' is-empty'}" data-action="go-step" data-step="${s.key}">
          <span class="pcb-sum__k">${html(s.label)}</span>
          <span class="pcb-sum__v">${p ? html(this.brief(p)) : 'לבחירה'}</span>
          <span class="pcb-sum__p">${p ? fmt(p.price) : ''}</span>
        </button></li>`;
      })
      .concat(this.sel.extra.map((p) => `<li class="pcb-sum__extra">
          <span class="pcb-sum__k">תוספת</span>
          <span class="pcb-sum__v">${html(shortName(p.title))}</span>
          <span class="pcb-sum__p">${fmt(p.price)}</span>
          <button type="button" class="pcb-sum__x" data-action="remove-extra" data-id="${p.id}" aria-label="הסרת ${html(shortName(p.title))}">
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </li>`))
      .join('');
    const pw = check.power;
    let state;
    if (!count) state = '<p class="pcb-sum__state-line">בחרו מפרט מוכן או רכיבים, והבדיקה תופיע כאן.</p>';
    else if (check.ok) state = `<p class="pcb-sum__state-line is-ok">${check.unverified.length ? 'לא נמצאה אי־התאמה' : 'כל הרכיבים תואמים'}</p>`;
    else if (check.problems.length) state = `<div class="pcb-sum__state-line is-warn"><p>יש רכיבים שלא מתאימים</p><ul role="list">${check.problems.map((p) => `<li>${html(this.label(p.step))}: ${html(p.text)}</li>`).join('')}</ul></div>`;
    else state = `<p class="pcb-sum__state-line">חסר: ${html(check.missing.map((k) => this.label(k)).join(', '))}</p>`;
    box.innerHTML = `
      ${rows ? `<ul class="pcb-sum__list" role="list">${rows}</ul>` : ''}
      ${state}
      ${count ? this.notesHtml(check) : ''}
      ${count && this.sel.cpu ? `<p class="pcb-sum__power">צריכה משוערת ${pw.draw}W${pw.psu ? ` מתוך ספק ${pw.psu}W` : ` · מומלץ ספק ${pw.recommended}W`}</p>` : ''}
      ${count && this.sel.cpu ? this.fpsTable(this.sel) : ''}`;
    const totalText = fmt(total);
    for (const t of this.el.querySelectorAll('[data-total]')) t.textContent = totalText;
    // Payments: the full line (and the 12-payment note) under the total, the short one in the phone bar.
    const pay = count ? this.pay(total) : null;
    const payBox = this.$('[data-pay]');
    if (payBox) {
      payBox.innerHTML = pay ? this.payText(total) : '';
      payBox.hidden = !pay;
    }
    const payBar = this.$('[data-pay-bar]');
    if (payBar) {
      payBar.textContent = pay ? `או ${pay.count} תשלומים של ${fmt(pay.each)} ללא ריבית` : '';
      payBar.hidden = !pay;
    }
    const chip = this.$('[data-summary-chip]');
    if (chip) {
      chip.textContent = !count ? 'עוד לא נבחרו רכיבים' : check.ok ? 'מוכן להזמנה' : check.problems.length ? 'יש אי־התאמה' : `חסרים ${check.missing.length} רכיבים`;
      chip.className = `pcb-sum__state${count && check.ok ? ' is-ok' : ''}`;
    }
    const countEl = this.$('[data-count]');
    if (countEl) countEl.textContent = count ? `${count} רכיבים` : '';
    for (const b of this.el.querySelectorAll('[data-action="add-to-cart"], [data-action="quote"]')) b.disabled = !orderable;
    for (const b of this.el.querySelectorAll('[data-action="whatsapp"], [data-action="share"], [data-action="save"]')) b.disabled = !count;
    const cmp = this.$('[data-action="compare"]');
    if (cmp) cmp.disabled = !this.saved.length;
    const savedCount = this.$('[data-saved-count]');
    if (savedCount) savedCount.textContent = this.saved.length ? `(${this.saved.length})` : '';
    const cartNote = this.$('[data-cart-note]');
    if (cartNote) {
      cartNote.textContent = count && check.problems.length ? 'יש להחליף את הרכיבים שלא מתאימים לפני ההזמנה.' : '';
      cartNote.hidden = !cartNote.textContent;
    }
  }

  /* ---------- actions ---------- */

  choose(part) {
    const key = part.category;
    if (key === 'extra') {
      const i = this.sel.extra.indexOf(part);
      if (i >= 0) this.sel.extra.splice(i, 1);
      else this.sel.extra.push(part);
      this.announce(i >= 0 ? 'התוספת הוסרה' : 'התוספת נוספה');
      this.renderSteps();
      this.renderSummary();
      this.syncUrl();
      return;
    }
    // Never choose what does not fit the earlier steps (the button is not there, but a stale page could still ask).
    if (!this.P.fitOf(part, this.P.earlierOf(this.sel, key)).ok) return;
    const before = this.sel;
    const { sel, removed } = this.P.applyChoice(this.sel, part);
    this.sel = sel;
    if (removed.length) {
      const text = this.removedText(removed, key);
      this.setNotice(text, before);
      this.announce(text);
    } else {
      this.setNotice(null);
      this.announce(`${this.label(key)} נבחר: ${shortName(part.title)}`);
    }
    const next = removed.length ? removed[0].step : this.nextStep(key);
    if (next) this.goStep(next, true);
    else this.renderSteps();
    this.renderSummary();
    this.syncUrl();
  }

  nextStep(from) {
    const order = this.P.STEP_KEYS;
    const req = this.P.requiredSteps(this.sel);
    const after = order.slice(order.indexOf(from) + 1);
    return after.find((k) => req.includes(k) && !this.sel[k]) || after[0] || null;
  }

  goStep(key, focus) {
    this.mode = 'steps';
    this.step = key;
    this.renderMode();
    this.renderSteps();
    this.syncUrl();
    if (focus) {
      const h = this.$('.pcb-step__title');
      if (h) {
        h.focus({ preventScroll: true });
        const top = h.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0) - 72;
        if (h.getBoundingClientRect().top < 0 || h.getBoundingClientRect().top > innerHeight * 0.6) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
  }

  useBuild(key, edit) {
    const b = this.builds.find((x) => x.key === key);
    if (!b) return;
    const { sel, removed } = this.P.sanitize({ ...b.parts, extra: [] });
    this.sel = sel;
    this.setNotice(removed.length ? this.removedText(removed) : null);
    this.announce(`נבחר המפרט ה${b.label}: ${fmt(b.total)}`);
    if (edit) this.goStep('cpu', true);
    else this.renderGuided();
    this.renderSummary();
    this.syncUrl();
    if (!edit && matchMedia('(max-width: 991px)').matches) this.toggleSummary(true);
  }

  toggleSummary(open) {
    const btn = this.$('[data-action="toggle-summary"]');
    const body = this.$('[data-summary-panel]');
    if (!btn || !body) return;
    const next = open ?? btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', next);
    this.el.classList.toggle('pcb--summary-open', next);
    if (next) body.focus({ preventScroll: true });
    else this.toggleMore(false);
  }

  toggleMore(open) {
    const btn = this.$('[data-action="toggle-more"]');
    const list = this.$('.pcb-more__list');
    if (!btn || !list) return;
    const next = open ?? btn.getAttribute('aria-expanded') !== 'true';
    if (!next && list.hidden) return;
    btn.setAttribute('aria-expanded', next);
    list.hidden = !next;
    if (next) list.querySelector('button:not(:disabled)')?.focus();
  }

  buildId() {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `PC-${Date.now().toString(36).toUpperCase()}-${rand}`;
  }

  /** The last check before an order or a quote: the selection is cleaned again and must be complete. */
  revalidate() {
    const { sel, removed } = this.P.sanitize(this.sel);
    if (removed.length) {
      this.sel = sel;
      this.setNotice(this.removedText(removed));
      this.renderAll();
    }
    return this.P.isOrderable(this.sel) && this.selectedList().length > 0;
  }

  async addToCart(btn) {
    const err = this.$('[data-cart-error]');
    if (err) err.hidden = true;
    if (!this.revalidate()) {
      if (err) {
        err.textContent = 'המחשב עוד לא שלם או שיש בו רכיבים שלא מתאימים, ולכן לא נוסף לסל.';
        err.hidden = false;
      }
      return;
    }
    const parts = this.selectedList();
    const id = this.buildId();
    const unverified = this.P.checkBuild(this.sel).unverified;
    // What could not be checked travels with the order (hidden from the customer, shown to the team in the admin).
    const items = parts.map((p, i) => ({ id: p.variantId, quantity: 1, properties: { _build_id: id, 'הרכבה': 'כן', ...(i === 0 && unverified.length ? { _unverified: unverified.join(', ') } : {}) } }));
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      const root = (window.theme?.routes?.cart_add || '/cart/add').replace(/\.js$/, '');
      const res = await fetch(`${root}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.description || data.message || `cart ${res.status}`);
      location.href = window.theme?.routes?.cart || '/cart';
    } catch (e) {
      console.error('[pc-builder] cart', e);
      if (err) {
        err.textContent = `לא הצלחנו להוסיף לסל${e.message && !/^cart \d/.test(e.message) ? `: ${e.message}` : ''}. אפשר לנסות שוב או לשאול נציג בוואטסאפ.`;
        err.hidden = false;
      }
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  shareUrl(sel = this.sel) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('build', this.selectedList(sel).map((p) => p.variantId).join(','));
    u.searchParams.set('mode', 'steps');
    return u.toString();
  }

  whatsapp() {
    const phone = this.d.whatsapp;
    if (!phone) return;
    const lines = this.selectedList().map((p) => `• ${p.category === 'extra' ? 'תוספת' : this.label(p.category)}: ${shortName(p.title)} (${fmt(p.price)})`);
    const check = this.P.checkBuild(this.sel);
    const text = [
      'שלום, אשמח לעזרה עם מחשב שהרכבתי באתר:',
      ...lines,
      `סה״כ: ${fmt(this.total())}`,
      check.ok ? (check.unverified.length ? `לפי האתר אין אי־התאמה. לא אומת: ${check.unverified.join(', ')}.` : 'לפי האתר הכל תואם.') : `לפי האתר חסר: ${check.missing.map((k) => this.label(k)).join(', ') || 'בדיקת התאמה'}.`,
      this.shareUrl(),
    ].join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async share(btn) {
    const url = this.shareUrl();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: document.title, text: 'המחשב שהרכבתי ב־JOY Mobile', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      const label = btn.querySelector('[data-share-label]') || btn;
      const old = label.textContent;
      label.textContent = 'הקישור הועתק';
      this.announce('הקישור הועתק');
      setTimeout(() => { label.textContent = old; }, 2500);
    } catch (e) {
      if (e?.name !== 'AbortError') prompt('הקישור למחשב שלכם:', url);
    }
  }

  /* ---------- quote ---------- */

  openQuote() {
    if (!this.quote || !this.revalidate()) return;
    const now = new Date();
    const until = new Date(now.getTime() + QUOTE_HOURS * 3600e3);
    const total = this.total();
    const vatRate = Number(this.d.vat) || 0;
    const vat = vatRate ? total - total / (1 + vatRate / 100) : 0;
    const pay = this.pay(total);
    const number = `${now.getFullYear() % 100}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const rows = this.selectedList().map((p) => `<tr>
        <th scope="row">${html(p.category === 'extra' ? 'תוספת' : this.label(p.category))}</th>
        <td>${html(shortName(p.title))}${p.sku ? `<span class="pcb-quote__sku">מק״ט ${html(p.sku)}</span>` : ''}</td>
        <td class="pcb-quote__num">${fmt(p.price)}</td>
      </tr>`).join('');
    const fps = this.F.graphicsOf(this.sel) && this.guided.use === 'gaming'
      ? this.F.estimateBuild(this.sel, this.shownGames(), this.guided.res).filter((r) => r.fps !== null)
      : [];
    const wa = this.d.whatsappDisplay;
    const quoteCheck = this.P.checkBuild(this.sel);
    const service = this.d.service || 'הרכבה, בדיקה ומשלוח עד הבית';
    this.quote.querySelector('[data-quote-body]').innerHTML = `
      <header class="pcb-quote__head">
        <p class="pcb-quote__shop">${html(this.d.shopName || 'JOY Mobile')}</p>
        <h2 class="pcb-quote__title" id="${this.uid}-quote-h">הצעת מחיר: מחשב בהרכבה</h2>
        <dl class="pcb-quote__meta">
          <div><dt>תאריך</dt><dd>${dateFmt.format(now)}</dd></div>
          <div><dt>מספר הצעה</dt><dd dir="ltr">${number}</dd></div>
          <div><dt>בתוקף עד</dt><dd>${dateFmt.format(until)}, ${timeFmt.format(until)} (${QUOTE_HOURS} שעות)</dd></div>
        </dl>
      </header>
      <table class="pcb-quote__table">
        <thead><tr><th scope="col">רכיב</th><th scope="col">פריט</th><th scope="col" class="pcb-quote__num">מחיר</th></tr></thead>
        <tbody>${rows}
          <tr class="pcb-quote__service"><th scope="row">שירות</th><td>${html(service)}</td><td class="pcb-quote__num">ללא תשלום</td></tr>
        </tbody>
        <tfoot>
          <tr class="pcb-quote__total"><th scope="row" colspan="2">סה״כ לתשלום, כולל מע״מ</th><td class="pcb-quote__num">${fmt(total)}</td></tr>
          ${vat ? `<tr class="pcb-quote__vat"><th scope="row" colspan="2">מתוך הסכום מע״מ ${vatRate}%</th><td class="pcb-quote__num">${fmt(vat)}</td></tr>` : ''}
          ${pay ? `<tr class="pcb-quote__vat pcb-quote__pay"><th scope="row" colspan="2">או ${pay.count} תשלומים ללא ריבית</th><td class="pcb-quote__num">${pay.count} × ${fmt(pay.each)}</td></tr>` : ''}
        </tfoot>
      </table>
      <ul class="pcb-quote__terms" role="list">
        <li>${html(this.d.delivery || 'אספקה עד 7 ימי עסקים')}, מיום התשלום.</li>
        <li>המחשב מורכב ונבדק אצלנו לפני המשלוח. ${quoteCheck.unverified.length ? `הרכיבים נבדקו להתאמה זה לזה. נציג יאשר לפני ההרכבה: ${html(quoteCheck.unverified.join(', '))}.` : 'כל הרכיבים נבדקו להתאמה זה לזה.'}</li>
        ${pay ? `<li>תשלום: עד ${pay.count} תשלומים ללא ריבית${pay.max ? `, או עד ${pay.max} תשלומים בריבית` : ''}.</li>` : ''}
        <li>ההצעה בתוקף ${QUOTE_HOURS} שעות ובכפוף למלאי. המחירים כוללים מע״מ.</li>
        ${wa ? `<li>להזמנה ולשאלות בוואטסאפ: <span dir="ltr">${html(wa)}</span></li>` : ''}
      </ul>
      ${fps.length ? `<p class="pcb-quote__fps">הערכת FPS ב־${html(this.resLabel())} (הערכה בלבד, הגדרות גבוהות): ${fps.map((r) => `${html(r.label)} ${this.F.fpsText(r.fps)}`).join(' · ')}</p>` : ''}
      <p class="pcb-quote__link">קישור למחשב: <span dir="ltr">${html(decodeURIComponent(this.shareUrl()))}</span></p>`;
    if (matchMedia('(max-width: 991px)').matches) this.toggleSummary(false);
    this.toggleMore(false);
    this.quote.showModal();
    this.quote.querySelector('[data-quote-print]')?.focus();
  }

  /* ---------- compare ---------- */

  saveForCompare() {
    const ids = this.selectedList().map((p) => String(p.variantId));
    if (!ids.length) return;
    const key = ids.slice().sort().join(',');
    let list = this.saved.filter((s) => s.ids.slice().sort().join(',') !== key);
    list.unshift({ ids, at: Date.now() });
    let dropped = false;
    if (list.length > SAVED_MAX) { list = list.slice(0, SAVED_MAX); dropped = true; }
    this.saved = list;
    const ok = store.write(list);
    const text = !ok
      ? 'הדפדפן לא מאפשר שמירה. אפשר להעתיק קישור למחשב במקום.'
      : `נשמר להשוואה (${list.length} מתוך ${SAVED_MAX})${dropped ? '. המחשב הישן ביותר הוסר מההשוואה' : ''}.`;
    this.announce(text);
    this.setNotice(text);
    this.toggleMore(false);
    this.renderSummary();
  }

  removeSaved(i) {
    this.saved.splice(i, 1);
    store.write(this.saved);
    this.renderSummary();
    if (this.saved.length) this.renderCompare();
    else this.compare?.close();
  }

  loadSaved(i) {
    const s = this.saved[i];
    if (!s) return;
    const { sel, removed, gone } = this.fromIds(s.ids);
    this.sel = sel;
    const lines = [];
    if (gone) lines.push('חלק מהרכיבים כבר לא זמינים באתר.');
    if (removed.length) lines.push(this.removedText(removed));
    this.setNotice(lines.length ? lines.join(' ') : null);
    this.compare?.close();
    this.goStep(this.firstOpenStep() || 'cpu', true);
    this.renderSummary();
  }

  openCompare() {
    if (!this.compare || !this.saved.length) return;
    this.toggleMore(false);
    if (matchMedia('(max-width: 991px)').matches) this.toggleSummary(false);
    this.renderCompare();
    this.compare.showModal();
  }

  renderCompare() {
    const body = this.compare?.querySelector('[data-compare-body]');
    if (!body) return;
    const builds = this.saved.map((s) => {
      const { sel, removed, gone } = this.fromIds(s.ids);
      return { s, sel, removed, gone, check: this.P.checkBuild(sel), total: this.total(sel) };
    });
    const keys = this.P.STEPS.map((s) => s.key).filter((k) => k !== 'extra' && builds.some((b) => b.sel[k]));
    const cell = (b, k) => (b.sel[k] ? html(this.brief(b.sel[k])) : '<span class="pcb-cmp__none">—</span>');
    const row = (label, cells, same) => `<tr${same ? ' class="is-same"' : ''}><th scope="row">${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const partRows = keys.map((k) => {
      const vals = builds.map((b) => (b.sel[k] ? b.sel[k].variantId : null));
      return row(html(this.label(k)), builds.map((b) => cell(b, k)), builds.length > 1 && vals.every((v) => v === vals[0]));
    }).join('');
    const extras = builds.some((b) => b.sel.extra.length) ? row('תוספות', builds.map((b) => (b.sel.extra.length ? `${b.sel.extra.length}` : '—'))) : '';
    const games = this.shownGames();
    const res = this.guided.use === 'gaming' ? this.guided.res : '1080p';
    const fpsRows = games.map((g) => {
      const label = this.F.gameOf(g);
      return row(html(label.short || label.label), builds.map((b) => {
        const e = this.F.estimateFps(b.sel, g, res);
        return e ? this.F.fpsText(e.fps) : '—';
      }));
    }).join('');
    const status = row('מצב', builds.map((b) => {
      const lines = [];
      if (b.check.ok) lines.push('<span class="pcb-cmp__ok">מוכן להזמנה</span>');
      else lines.push(`חסר: ${html(b.check.missing.map((k) => this.label(k)).join(', '))}`);
      if (b.removed.length || b.gone) lines.push(`<span class="pcb-cmp__sub">${b.gone ? 'רכיבים שאזלו הוסרו. ' : ''}${b.removed.length ? 'רכיבים שלא מתאימים הוסרו.' : ''}</span>`);
      return lines.join('<br>');
    }));
    body.innerHTML = `
      <div class="pcb-cmp" role="region" aria-label="טבלת ההשוואה" tabindex="0">
        <table class="pcb-cmp__table" style="--n: ${builds.length}">
          <thead><tr><td></td>${builds.map((b, i) => `<th scope="col"><span class="pcb-cmp__n">מחשב ${i + 1}</span><span class="pcb-cmp__total">${fmt(b.total)}</span><span class="pcb-cmp__sub">נשמר ${dateFmt.format(new Date(b.s.at || Date.now()))}</span></th>`).join('')}</tr></thead>
          <tbody>${partRows}${extras}${status}
            <tr class="pcb-cmp__group"><th scope="rowgroup" colspan="${builds.length + 1}">הערכת FPS בלבד, ${html(this.resLabel(res))}</th></tr>
            ${fpsRows}
          </tbody>
          <tfoot><tr><td></td>${builds.map((b, i) => `<td>
            <a class="button pcb-cmp__load" href="${html(this.shareUrl(b.sel))}" data-action="load-saved" data-index="${i}">טעינה</a>
            <button type="button" class="link pcb-cmp__remove" data-action="remove-saved" data-index="${i}">הסרה</button>
          </td>`).join('')}</tr></tfoot>
        </table>
      </div>
      <p class="pcb-sum__fine">המחשבים נשמרים בדפדפן הזה בלבד. כל מחשב נבדק שוב להתאמה ולמלאי כשהוא נטען.</p>`;
  }

  /* ---------- events ---------- */

  onClick(e) {
    if (this.el.classList.contains('pcb--summary-open') && !e.target.closest('.pcb-sum, .pcb-dialog')) {
      this.toggleSummary(false);
      return;
    }
    const t = e.target.closest('[data-action], [data-mode-tab]');
    if (!t || !this.el.contains(t)) return;
    if (t.dataset.modeTab) {
      this.mode = t.dataset.modeTab;
      if (this.mode === 'steps' && !this.step) this.step = 'cpu';
      this.renderAll();
      return;
    }
    const part = () => this.parts.find((p) => String(p.id) === t.dataset.id);
    switch (t.dataset.action) {
      case 'choose': { const p = part(); if (p) this.choose(p); break; }
      case 'go-step':
        this.goStep(t.dataset.step, true);
        if (matchMedia('(max-width: 991px)').matches) this.toggleSummary(false);
        break;
      case 'prev': this.goStep(this.P.STEP_KEYS[this.P.STEP_KEYS.indexOf(this.step) - 1], true); break;
      case 'next': this.goStep(this.P.STEP_KEYS[this.P.STEP_KEYS.indexOf(this.step) + 1], true); break;
      case 'skip':
        if (this.sel[this.step]) delete this.sel[this.step];
        this.renderSummary();
        this.goStep(this.nextStep(this.step) || this.step, true);
        break;
      case 'more':
        this.shown[this.step] = (this.shown[this.step] || PAGE_SIZE) + PAGE_SIZE;
        this.renderSteps();
        break;
      case 'toggle-blocked':
        this.showBlocked[this.step] = !this.showBlocked[this.step];
        this.renderSteps();
        this.$('[data-action="toggle-blocked"]')?.focus();
        break;
      case 'use-build': this.useBuild(t.dataset.build, false); break;
      case 'edit-build': this.useBuild(t.dataset.build, true); break;
      case 'remove-extra': {
        const p = part();
        this.sel.extra = this.sel.extra.filter((x) => x !== p);
        this.renderSummary();
        if (this.mode === 'steps') this.renderSteps();
        this.syncUrl();
        break;
      }
      case 'undo':
        if (this.notice?.undo) {
          this.sel = this.notice.undo;
          this.setNotice(null);
          this.announce('השינוי בוטל');
          this.renderAll();
        }
        break;
      case 'dismiss': this.setNotice(null); break;
      case 'toggle-summary': this.toggleSummary(); break;
      case 'toggle-more': this.toggleMore(); break;
      case 'add-to-cart': this.addToCart(t); break;
      case 'whatsapp': this.whatsapp(); break;
      case 'share': this.share(t); break;
      case 'quote': this.openQuote(); break;
      case 'save': this.saveForCompare(); break;
      case 'compare': this.openCompare(); break;
      case 'close-compare': this.compare?.close(); break;
      case 'load-saved': e.preventDefault(); this.loadSaved(Number(t.dataset.index)); break;
      case 'remove-saved': this.removeSaved(Number(t.dataset.index)); break;
      case 'clear':
        this.sel = { extra: [] };
        this.setNotice(null);
        this.toggleMore(false);
        this.renderAll();
        this.announce('הבחירה נוקתה');
        break;
      default:
    }
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.filter) {
      (this.filters[this.step] ||= {})[t.dataset.filter] = t.value;
      this.shown[this.step] = PAGE_SIZE;
      const id = t.id;
      this.renderSteps();
      this.el.querySelector(`#${CSS.escape(id)}`)?.focus();
      return;
    }
    if (t.form?.hasAttribute('data-guided-form')) this.readGuided(t.form);
  }

  onInput(e) {
    if (e.target.name === 'budget') {
      this.showBudget();
      clearTimeout(this.budgetTimer);
      this.budgetTimer = setTimeout(() => this.readGuided(e.target.form), 250);
    }
  }

  onKeydown(e) {
    if (e.key === 'Escape') {
      const more = this.$('[data-action="toggle-more"]');
      if (more?.getAttribute('aria-expanded') === 'true') {
        this.toggleMore(false);
        more.focus();
        return;
      }
      if (this.el.classList.contains('pcb--summary-open')) {
        this.toggleSummary(false);
        this.$('[data-action="toggle-summary"]')?.focus();
        return;
      }
    }
    // Tabs: arrow keys move between the two modes (RTL: the right arrow goes to the previous tab).
    const tab = e.target.closest('[data-mode-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...this.el.querySelectorAll('[data-mode-tab]')];
    let i = tabs.indexOf(tab);
    const rtl = getComputedStyle(this.el).direction === 'rtl';
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = tabs.length - 1;
    else i = (i + ((e.key === 'ArrowLeft') === rtl ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[i].focus();
    tabs[i].click();
  }

  showBudget() {
    const form = this.$('[data-guided-form]');
    if (!form) return;
    const v = Number(form.budget.value);
    const out = form.querySelector('[data-budget-out]');
    if (out) out.textContent = fmt(v);
    form.budget.setAttribute('aria-valuetext', fmt(v));
    const min = Number(form.budget.min);
    const max = Number(form.budget.max);
    form.budget.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    const [lo, hi] = form.querySelectorAll('.pcb-range__scale span');
    if (lo && hi) { lo.textContent = fmt(min); hi.textContent = fmt(max); }
  }

  readGuided(form) {
    this.guided = {
      use: form.querySelector('input[name="use"]:checked')?.value || 'gaming',
      budget: Number(form.budget.value),
      includeOs: form.include_os.checked,
      games: [...form.querySelectorAll('input[name="game"]:checked')].map((i) => i.value),
      res: form.querySelector('input[name="res"]:checked')?.value || '1080p',
    };
    this.renderGuided();
    this.renderSummary();
    this.syncUrl();
  }
}

export function initPcBuilders(scope = document) {
  for (const el of scope.querySelectorAll('[data-pc-builder]:not([data-pcb-init])')) {
    el.setAttribute('data-pcb-init', '');
    new PcBuilder(el);
  }
}

initPcBuilders();
document.addEventListener('shopify:section:load', (e) => initPcBuilders(e.target));

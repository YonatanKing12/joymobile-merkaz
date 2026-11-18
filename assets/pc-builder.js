/* ==========================================================================
   pc-builder.js — "מרכיב מחשבים" (sections/pc-builder). Vanilla ES module, no dependencies.

   Data: every product of the section's collection, read page by page from /collections/<handle>/products.json
   (250 a page) and turned into parts by assets/pc-builder-parser.js (the URL comes in data-parser-src, so the
   versioned asset is the one imported). Metafield overrides (pc.*) come from the section's JSON block.

   Two modes: guided (use + budget → three compatible builds) and step by step (each step lists only what fits the
   parts already chosen; the rest behind a "why" toggle). The summary (a bottom bar on phones) holds the parts, the
   total, the power estimate against the PSU, the compatibility verdict, the cart button, WhatsApp and a share link.
   The selection lives in the URL (?build=<variant ids>), so a link brings back the same computer.
   ========================================================================== */

const html = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const fmt = (n) => money.format(Math.round(n || 0));

/* The supplier's titles open with the Hebrew kind ("מעבד", "לוח אם למעבדי"): the short name starts at the first Latin word. */
const shortName = (title) => {
  const i = title.search(/[A-Za-z0-9]/);
  return i > 0 ? title.slice(i).trim() : title;
};

/* Shopify CDN pictures can be asked for at the size shown. */
const sized = (src, w) => {
  if (!src) return '';
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}width=${w}`;
};

const PAGE_SIZE = 24;

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
    this.guided = { use: 'gaming', budget: Number(this.d.budgetDefault) || 6000, includeOs: this.d.includeOs !== 'false' };
    this.builds = [];
    this.$ = (s) => el.querySelector(s);
    this.status = this.$('[data-status]');
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('change', (e) => this.onChange(e));
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('keydown', (e) => this.onKeydown(e));
    this.start();
  }

  async start() {
    try {
      this.P = await import(this.d.parserSrc);
      await this.load();
    } catch (err) {
      console.error('[pc-builder]', err);
      this.say('לא הצלחנו לטעון את רשימת הרכיבים. אפשר לרענן את העמוד או לפנות אלינו בוואטסאפ.', true);
      this.el.classList.add('pcb--error');
      return;
    }
    this.el.classList.add('pcb--ready');
    this.restore();
    this.renderAll();
  }

  /* ---------- data ---------- */

  async load() {
    const overrides = JSON.parse(this.$('[data-pcb-overrides]')?.textContent || '{}');
    const source = this.d.source;
    if (!source) throw new Error('no collection');
    const seen = new Map();
    for (let page = 1; page <= 40; page++) {
      const res = await fetch(source.replace('{page}', page), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`products.json ${res.status}`);
      const { products = [] } = await res.json();
      let added = 0;
      for (const p of products) if (!seen.has(p.id)) { seen.set(p.id, p); added++; }
      if (products.length < 250 || !added) break;
    }
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

  restore() {
    const q = new URLSearchParams(location.search);
    const ids = (q.get('build') || '').split(/[,\s]+/).filter(Boolean);
    for (const id of ids) {
      const part = this.byVariant.get(id);
      if (!part) continue;
      if (part.category === 'extra') this.sel.extra.push(part);
      else this.sel[part.category] = part;
    }
    const mode = q.get('mode') || (ids.length ? 'steps' : this.d.defaultMode || 'guided');
    this.mode = mode === 'steps' ? 'steps' : 'guided';
    const use = q.get('use');
    if (use && this.P.USES[use]) this.guided.use = use;
    const budget = Number(q.get('budget'));
    if (budget) this.guided.budget = budget;
    const form = this.$('[data-guided-form]');
    if (form) {
      const radio = form.querySelector(`input[name="use"][value="${this.guided.use}"]`);
      if (radio) radio.checked = true;
      form.budget.value = this.guided.budget;
      form.include_os.checked = this.guided.includeOs;
      this.showBudget();
    }
    if (ids.length && ids.length > this.selectedList().length) this.say('חלק מהרכיבים בקישור כבר לא זמינים באתר. אפשר לבחור חלופה בשלב המתאים.');
    this.step = this.firstOpenStep() || 'cpu';
  }

  selectedList() {
    return [...this.P.STEP_KEYS.filter((k) => k !== 'extra').map((k) => this.sel[k]).filter(Boolean), ...this.sel.extra];
  }

  total() {
    return this.selectedList().reduce((s, p) => s + p.price, 0);
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
    if (this.mode === 'guided') {
      u.searchParams.set('use', this.guided.use);
      u.searchParams.set('budget', this.guided.budget);
    } else {
      u.searchParams.delete('use');
      u.searchParams.delete('budget');
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

  /* ---------- rendering ---------- */

  renderAll() {
    this.renderMode();
    if (this.mode === 'guided') this.renderGuided();
    else this.renderSteps();
    this.renderSummary();
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

  renderGuided() {
    const box = this.$('[data-builds]');
    if (!box) return;
    this.builds = this.P.planBuilds(this.parts, this.guided);
    const chosenIds = this.selectedList().map((p) => p.variantId).join(',');
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
    box.innerHTML = note + unique
      .map((b) => {
        const parts = Object.values(b.parts);
        const ids = parts.map((p) => p.variantId).join(',');
        const selected = ids === chosenIds;
        const over = b.total > this.guided.budget;
        const rows = ['cpu', 'gpu', 'ram', 'storage', 'board', 'psu', 'case', 'cooler', 'os']
          .filter((k) => b.parts[k])
          .map((k) => `<li><span class="pcb-build__k">${html(this.label(k))}</span> <span class="pcb-build__v">${html(this.brief(b.parts[k]))}</span></li>`)
          .join('');
        const verdict = b.check.ok
          ? '<p class="pcb-ok">הכל תואם <span aria-hidden="true">✓</span></p>'
          : `<p class="pcb-warn">${html(b.check.missing.length ? `חסר: ${b.check.missing.map((k) => this.label(k)).join(', ')}` : 'יש לבדוק התאמה')}</p>`;
        return `
          <article class="pcb-build${b.key === 'recommended' ? ' pcb-build--featured' : ''}${selected ? ' is-selected' : ''}" aria-labelledby="${this.uid}-b-${b.key}">
            <header class="pcb-build__head">
              <h3 class="pcb-build__title" id="${this.uid}-b-${b.key}">${html(b.label)}</h3>
              ${b.key === 'recommended' ? '<span class="pcb-build__badge">ההמלצה שלנו</span>' : ''}
            </header>
            <p class="pcb-build__price">${fmt(b.total)}${over ? ' <span class="pcb-build__over">מעל התקציב</span>' : ''}</p>
            <ul class="pcb-build__list" role="list">${rows}</ul>
            ${verdict}
            <p class="pcb-build__power">צריכה משוערת ${b.check.power.draw}W, ספק ${b.parts.psu ? `${b.parts.psu.facts.watts}W` : 'לא נבחר'}</p>
            <div class="pcb-build__actions">
              <button type="button" class="button button--accent button--full" data-action="use-build" data-build="${b.key}" aria-pressed="${selected}">
                ${selected ? 'המפרט נבחר <span aria-hidden="true">✓</span>' : 'בחירת המפרט הזה'}
              </button>
              <button type="button" class="link pcb-build__edit" data-action="edit-build" data-build="${b.key}">התאמה אישית של הרכיבים</button>
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

  brief(part) {
    const f = part.facts;
    switch (part.category) {
      case 'cpu': return f.model ? `${part.brand === 'Intel' ? 'Intel ' : 'AMD '}${f.model}` : shortName(part.title);
      case 'gpu': return f.chip ? `${f.chip}${f.vram ? ` ${f.vram}GB` : ''}` : shortName(part.title);
      case 'ram': return `${f.capacity || '?'}GB ${f.memory || ''}${f.speed ? ` ${f.speed}MHz` : ''}`;
      case 'storage': return `${f.capacityGb >= 1000 ? `${f.capacityGb / 1000}TB` : `${f.capacityGb}GB`} ${f.kind || ''}`;
      case 'psu': return `${f.watts}W${f.rating ? ` ${f.rating}` : ''}`;
      case 'board': return `${part.brand} ${f.chipset || ''} ${f.formFactor || ''}`.trim();
      default: return shortName(part.title);
    }
  }

  specs(part) {
    const f = part.facts;
    const chips = [];
    switch (part.category) {
      case 'cpu':
        chips.push(f.socket, f.igpu ? 'כולל גרפיקה מובנית' : 'צריך כרטיס מסך', f.needsCooler === false ? 'כולל קירור' : 'צריך קירור', f.watts && `עד ${f.watts}W`);
        break;
      case 'board':
        chips.push(f.socket, f.memory || 'סוג זיכרון לא צוין', f.formFactor, f.wifi && 'Wi-Fi', f.backConnect && 'מחברים מאחור');
        break;
      case 'ram':
        chips.push(f.memory, f.capacity && `${f.capacity}GB`, f.modules > 1 && `${f.modules} יחידות`, f.speed && `${f.speed}MHz`);
        break;
      case 'gpu':
        chips.push(f.chip, f.vram && `${f.vram}GB`, f.watts && `${f.watts}W`);
        break;
      case 'storage':
        chips.push(f.kind, f.capacityGb && (f.capacityGb >= 1000 ? `${f.capacityGb / 1000}TB` : `${f.capacityGb}GB`), f.gen && `Gen${f.gen}`);
        break;
      case 'cooler':
        chips.push(f.type === 'liquid' ? 'קירור נוזלי' : 'קירור אוויר', f.radiator && `${f.radiator}mm`, f.tdp && `עד ${f.tdp}W`);
        break;
      case 'psu':
        chips.push(f.watts && `${f.watts}W`, f.rating && `80 Plus ${f.rating}`, f.atx3 && 'ATX 3');
        break;
      case 'case':
        chips.push(f.formFactor && `לוחות עד ${f.formFactor}`, f.backConnect && 'תומך מחברים מאחור');
        break;
      case 'os':
        chips.push(`Windows 11 ${f.edition}`, f.language === 'he' ? 'עברית' : f.language === 'en' ? 'אנגלית' : null);
        break;
      default:
    }
    return chips.filter(Boolean);
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
    nav.innerHTML = `<ol class="pcb-steps" role="list">${this.P.STEPS.map((s, i) => {
      const state = this.stepState(s.key);
      const current = s.key === this.step;
      const done = s.key === 'extra' ? this.sel.extra.length > 0 : !!this.sel[s.key];
      return `<li><button type="button" class="pcb-steps__btn${done ? ' is-done' : ''}" data-action="go-step" data-step="${s.key}"${current ? ' aria-current="step"' : ''}>
        <span class="pcb-steps__n" aria-hidden="true">${done ? '✓' : i + 1}</span>
        <span class="pcb-steps__label">${html(s.label)}</span>
        <span class="pcb-steps__state">${html(state)}</span></button></li>`;
    }).join('')}</ol>`;
    const cur = nav.querySelector('[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    box.innerHTML = this.stepHtml(this.step);
  }

  candidates(key) {
    const list = this.byCat[key] || [];
    const rest = { ...this.sel, [key]: undefined, extra: [] };
    const ok = [];
    const blocked = [];
    for (const part of list) {
      const fit = key === 'extra' ? { ok: true, reasons: [] } : this.P.fitOf(part, rest);
      (fit.ok ? ok : blocked).push({ part, fit });
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
    const limit = this.shown[key] || PAGE_SIZE;
    const more = shown.length - limit;
    shown = shown.slice(0, limit);
    const hint = this.stepHint(key, required);
    const id = `${this.uid}-${key}`;
    const optional = !required
      ? `<button type="button" class="button button--outline button--small" data-action="skip">${this.sel[key] ? 'הסרת הבחירה' : 'דילוג על השלב'}</button>`
      : '';
    return `
      <div class="pcb-step" aria-labelledby="${id}-h">
        <div class="pcb-step__head">
          <p class="pcb-step__count">שלב ${index + 1} מתוך ${this.P.STEPS.length}</p>
          <h2 class="pcb-step__title" id="${id}-h" tabindex="-1">${html(step.title)}${required ? '' : ' <span class="pcb-step__opt">(לא חובה)</span>'}</h2>
          ${hint ? `<p class="pcb-step__hint">${html(hint)}</p>` : ''}
        </div>
        ${ok.length > 3 ? `
        <div class="pcb-filters" role="group" aria-label="סינון ${html(step.label)}">
          <div class="field pcb-filters__field">
            <label class="field__label" for="${id}-brand">מותג</label>
            <div class="select"><select id="${id}-brand" data-filter="brand">
              <option value="">כל המותגים</option>
              ${brands.map((b) => `<option value="${html(b)}"${b === f.brand ? ' selected' : ''}>${html(b)}</option>`).join('')}
            </select></div>
          </div>
          <div class="field pcb-filters__field">
            <label class="field__label" for="${id}-max">מחיר</label>
            <div class="select"><select id="${id}-max" data-filter="max">
              <option value="">כל המחירים</option>
              ${caps.map((c) => `<option value="${c}"${String(c) === String(f.max) ? ' selected' : ''}>עד ${fmt(c)}</option>`).join('')}
            </select></div>
          </div>
          <div class="field pcb-filters__field">
            <label class="field__label" for="${id}-sort">מיון</label>
            <div class="select"><select id="${id}-sort" data-filter="sort">
              <option value="popular"${f.sort === 'popular' ? ' selected' : ''}>מומלץ</option>
              <option value="price-asc"${f.sort === 'price-asc' ? ' selected' : ''}>מחיר: מהנמוך לגבוה</option>
              <option value="price-desc"${f.sort === 'price-desc' ? ' selected' : ''}>מחיר: מהגבוה לנמוך</option>
            </select></div>
          </div>
        </div>` : ''}
        <p class="pcb-step__meta" aria-live="polite">${shown.length + Math.max(more, 0)} מוצרים מתאימים${f.brand || f.max ? ' לסינון' : ''}</p>
        ${shown.length ? `<ul class="pcb-parts" role="list">${shown.map((c) => this.partHtml(c.part, key)).join('')}</ul>` : '<p class="pcb-empty">אין מוצרים שמתאימים לסינון. אפשר לנקות את הסינון או לשנות רכיב קודם.</p>'}
        ${more > 0 ? `<button type="button" class="button button--outline pcb-more" data-action="more">הצגת עוד ${Math.min(more, PAGE_SIZE)} מוצרים</button>` : ''}
        ${blocked.length ? `
          <div class="pcb-blocked">
            <button type="button" class="pcb-blocked__toggle" data-action="toggle-blocked" aria-expanded="${!!this.showBlocked[key]}" aria-controls="${id}-blocked">
              ${blocked.length} מוצרים לא מוצגים כי הם לא מתאימים לרכיבים שבחרתם. <span class="pcb-blocked__why">למה?</span>
            </button>
            <ul class="pcb-parts pcb-parts--blocked" role="list" id="${id}-blocked"${this.showBlocked[key] ? '' : ' hidden'}>
              ${this.showBlocked[key] ? blocked.map((c) => this.partHtml(c.part, key, c.fit.reasons)).join('') : ''}
            </ul>
          </div>` : ''}
        <div class="pcb-step__nav">
          ${index > 0 ? `<button type="button" class="button button--outline" data-action="prev">הקודם: ${html(this.P.STEPS[index - 1].label)}</button>` : '<span></span>'}
          ${optional}
          ${index < this.P.STEPS.length - 1 ? `<button type="button" class="button" data-action="next">הבא: ${html(this.P.STEPS[index + 1].label)}</button>` : ''}
        </div>
      </div>`;
  }

  stepHint(key, required) {
    const cpu = this.sel.cpu;
    switch (key) {
      case 'cpu': return 'בוחרים מעבד, ובשלבים הבאים מוצגים רק רכיבים שמתאימים לו.';
      case 'board': return cpu ? `מוצגים לוחות לתושבת ${cpu.facts.socket} בלבד.` : 'כדאי לבחור קודם מעבד: אז יוצגו רק לוחות שמתאימים לו.';
      case 'ram': return this.sel.board?.facts.memory ? `הלוח שבחרתם עובד עם ${this.sel.board.facts.memory}.` : '';
      case 'gpu': return cpu && cpu.facts.igpu === false ? 'למעבד שבחרתם אין גרפיקה מובנית, ולכן צריך כרטיס מסך.' : required ? '' : 'למעבד שבחרתם יש גרפיקה מובנית: כרטיס מסך נדרש רק למשחקים ולעבודה גרפית.';
      case 'cooler': return cpu ? (cpu.facts.needsCooler === false ? 'המעבד מגיע עם קירור משלו.' : `המעבד מגיע בלי קירור. מוצגים קירורים שמתאימים ל-${cpu.facts.watts}W לפחות.`) : '';
      case 'psu': {
        const p = this.P.powerOf(this.sel);
        return `צריכה משוערת ${p.draw}W: מוצגים ספקים של ${p.recommended}W ומעלה.`;
      }
      case 'case': return this.sel.board ? `מוצגים מארזים שמתאימים ללוח ${this.sel.board.facts.formFactor}.` : '';
      case 'extra': return 'אפשר לבחור כמה תוספות.';
      default: return '';
    }
  }

  rank(part) {
    const f = part.facts;
    if (part.category === 'gpu') return (f.score || 0) / Math.max(part.price, 1) * 1000;
    if (part.category === 'cpu') return (f.score || 0) / Math.max(part.price, 1) * 1000;
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

  partHtml(part, key, reasons) {
    const isExtra = key === 'extra';
    const selected = isExtra ? this.sel.extra.includes(part) : this.sel[key] === part;
    const blocked = !!reasons;
    const id = `${this.uid}-p-${part.id}`;
    const chips = this.specs(part);
    const img = part.image
      ? `<img class="pcb-part__img" src="${html(sized(part.image, 160))}" alt="" width="80" height="80" loading="lazy" decoding="async">`
      : '<span class="pcb-part__img pcb-part__img--empty" aria-hidden="true"></span>';
    return `
      <li class="pcb-part${selected ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}">
        ${img}
        <div class="pcb-part__info">
          <p class="pcb-part__brand">${html(part.brand)}</p>
          <h3 class="pcb-part__title" id="${id}">${html(part.title)}</h3>
          ${chips.length ? `<ul class="pcb-part__specs" role="list">${chips.map((c) => `<li>${html(c)}</li>`).join('')}</ul>` : ''}
          ${blocked ? `<p class="pcb-part__why"><span class="visually-hidden">לא מתאים: </span>${reasons.map(html).join('. ')}</p>` : ''}
        </div>
        <div class="pcb-part__buy">
          <p class="pcb-part__price">${fmt(part.price)}</p>
          ${blocked
            ? `<button type="button" class="button button--small button--outline" disabled aria-describedby="${id}">לא מתאים</button>`
            : `<button type="button" class="button button--small${selected ? ' button--accent' : ''}" data-action="choose" data-id="${part.id}" aria-pressed="${selected}" aria-describedby="${id}">
                ${selected ? (isExtra ? 'נוסף <span aria-hidden="true">✓</span>' : 'נבחר <span aria-hidden="true">✓</span>') : isExtra ? 'הוספה' : 'בחירה'}</button>`}
        </div>
      </li>`;
  }

  renderSummary() {
    const box = this.$('[data-summary-body]');
    if (!box) return;
    const check = this.P.checkBuild(this.sel);
    const required = this.P.requiredSteps(this.sel);
    const count = this.selectedList().length;
    const total = this.total();
    const rows = this.P.STEPS.filter((s) => s.key !== 'extra')
      .filter((s) => this.sel[s.key] || required.includes(s.key))
      .map((s) => {
        const p = this.sel[s.key];
        const bad = check.problems.some((x) => x.step === s.key);
        return `<li class="pcb-sum__row${bad ? ' is-bad' : ''}">
          <span class="pcb-sum__k">${html(s.label)}</span>
          <span class="pcb-sum__v">${p ? html(this.brief(p)) : '<span class="pcb-sum__missing">עוד לא נבחר</span>'}</span>
          <span class="pcb-sum__p">${p ? fmt(p.price) : ''}</span>
          <button type="button" class="pcb-sum__edit" data-action="go-step" data-step="${s.key}" aria-label="${p ? 'החלפת' : 'בחירת'} ${html(s.label)}">${p ? 'החלפה' : 'בחירה'}</button>
        </li>`;
      })
      .concat(this.sel.extra.map((p) => `<li class="pcb-sum__row">
          <span class="pcb-sum__k">תוספת</span>
          <span class="pcb-sum__v">${html(shortName(p.title))}</span>
          <span class="pcb-sum__p">${fmt(p.price)}</span>
          <button type="button" class="pcb-sum__edit" data-action="remove-extra" data-id="${p.id}" aria-label="הסרת ${html(shortName(p.title))}">הסרה</button>
        </li>`))
      .join('');
    const pw = check.power;
    const ratio = pw.psu ? Math.min(100, Math.round((pw.draw / pw.psu) * 100)) : 0;
    let verdict;
    if (!count) verdict = '<p class="pcb-sum__verdict">בחרו רכיבים או מפרט מוכן, והבדיקה תופיע כאן.</p>';
    else if (check.ok) verdict = '<p class="pcb-sum__verdict pcb-ok">הכל תואם <span aria-hidden="true">✓</span></p>';
    else {
      const items = [
        ...check.problems.map((p) => `<li>${html(this.label(p.step))}: ${html(p.text)}</li>`),
        ...(check.missing.length ? [`<li>חסר: ${html(check.missing.map((k) => this.label(k)).join(', '))}</li>`] : []),
      ];
      verdict = `<div class="pcb-sum__verdict pcb-warn"><p>${check.problems.length ? 'יש רכיבים שלא מתאימים' : 'המחשב עוד לא שלם'}</p><ul role="list">${items.join('')}</ul></div>`;
    }
    const notes = check.notes.length ? `<ul class="pcb-sum__notes" role="list">${check.notes.map((n) => `<li>${html(n.text)}. נציג יאשר לפני ההרכבה.</li>`).join('')}</ul>` : '';
    box.innerHTML = `
      ${rows ? `<ul class="pcb-sum__list" role="list">${rows}</ul>` : ''}
      ${count ? `<div class="pcb-power">
        <p class="pcb-power__text">צריכת חשמל משוערת <strong>${pw.draw}W</strong>${pw.psu ? `, ספק <strong>${pw.psu}W</strong>` : `, מומלץ ספק של ${pw.recommended}W לפחות`}</p>
        ${pw.psu ? `<div class="pcb-power__bar${pw.psu < pw.recommended ? ' is-low' : ''}" role="meter" aria-label="ניצול הספק" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}" aria-valuetext="${ratio}% מהספק"><span style="inline-size:${ratio}%"></span></div>` : ''}
      </div>` : ''}
      ${verdict}
      ${notes}`;
    const totalText = fmt(total);
    for (const t of this.el.querySelectorAll('[data-total]')) t.textContent = totalText;
    const chip = this.$('[data-summary-chip]');
    if (chip) {
      chip.textContent = !count ? 'עוד לא נבחרו רכיבים' : check.ok ? 'הכל תואם ✓' : check.problems.length ? 'יש אי־התאמה' : `חסרים ${check.missing.length} רכיבים`;
      chip.className = `pcb-sum__chip${count && check.ok ? ' is-ok' : count ? ' is-warn' : ''}`;
    }
    const countEl = this.$('[data-count]');
    if (countEl) countEl.textContent = count ? `${count} רכיבים` : '';
    for (const b of this.el.querySelectorAll('[data-action="add-to-cart"], [data-action="whatsapp"], [data-action="share"]')) {
      const off = !count || (b.dataset.action === 'add-to-cart' && check.problems.length > 0);
      b.disabled = off;
    }
    const cartNote = this.$('[data-cart-note]');
    if (cartNote) {
      cartNote.textContent = count && check.problems.length ? 'יש להחליף את הרכיבים שלא מתאימים לפני ההוספה לסל.' : count && check.missing.length ? 'אפשר להוסיף לסל גם כך, אבל המחשב עוד לא שלם.' : '';
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
    this.sel[key] = part;
    // The CPU decides whether a card and a cooler are needed: drop a card the build no longer needs? Keep it, the
    // customer chose it. Only the summary changes.
    this.announce(`${this.label(key)} נבחר: ${shortName(part.title)}`);
    const next = this.nextStep(key);
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
        const top = h.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0) - 16;
        if (h.getBoundingClientRect().top < 0 || h.getBoundingClientRect().top > innerHeight * 0.6) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
  }

  useBuild(key, edit) {
    const b = this.builds.find((x) => x.key === key);
    if (!b) return;
    this.sel = { ...b.parts, extra: [] };
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
  }

  buildId() {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `PC-${Date.now().toString(36).toUpperCase()}-${rand}`;
  }

  async addToCart(btn) {
    const parts = this.selectedList();
    if (!parts.length) return;
    const id = this.buildId();
    const items = parts.map((p) => ({ id: p.variantId, quantity: 1, properties: { _build_id: id, 'הרכבה': 'כן' } }));
    const err = this.$('[data-cart-error]');
    if (err) err.hidden = true;
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
        err.textContent = `לא הצלחנו להוסיף לסל${e.message && !/^cart \d/.test(e.message) ? `: ${e.message}` : ''}. אפשר לנסות שוב או לשלוח לנציג בוואטסאפ.`;
        err.hidden = false;
      }
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  shareUrl() {
    const u = new URL(location.href);
    u.searchParams.set('build', this.selectedList().map((p) => p.variantId).join(','));
    u.searchParams.set('mode', 'steps');
    u.searchParams.delete('use');
    u.searchParams.delete('budget');
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
      check.ok ? 'לפי האתר הכל תואם.' : 'האתר מצא דברים לבדוק, אשמח לעזרה.',
      this.shareUrl(),
    ].join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async share(btn) {
    const url = this.shareUrl();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: document.title, text: 'המחשב שהרכבתי ב-JOY Mobile', url });
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

  /* ---------- events ---------- */

  onClick(e) {
    if (this.el.classList.contains('pcb--summary-open') && !e.target.closest('.pcb-sum')) {
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
      case 'toggle-summary': this.toggleSummary(); break;
      case 'add-to-cart': this.addToCart(t); break;
      case 'whatsapp': this.whatsapp(); break;
      case 'share': this.share(t); break;
      case 'clear':
        this.sel = { extra: [] };
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
    if (e.key === 'Escape' && this.el.classList.contains('pcb--summary-open')) {
      this.toggleSummary(false);
      this.$('[data-action="toggle-summary"]')?.focus();
      return;
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
  }

  readGuided(form) {
    this.guided = {
      use: form.querySelector('input[name="use"]:checked')?.value || 'gaming',
      budget: Number(form.budget.value),
      includeOs: form.include_os.checked,
    };
    this.renderGuided();
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


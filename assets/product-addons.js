/* "השלימו את הערכה" — snippets/product-addons.liquid (the shell) + sections/product-addons.liquid (tiles).
 *
 * The product's own buttons are the add-ons' buttons. Ticked tiles ride along with the device: the
 * product form (assets/product.js) asks this element for selectedItems() and sends the device and
 * every ticked accessory in one /cart/add call, then calls clear(). While something is ticked the
 * section root carries [data-pa-count] and --pa-count, which the buy buttons read for their "+N"
 * badge — on the section root because the buttons themselves are re-rendered on every variant change.
 * Only when the device is sold out does this element add on its own (its standalone button).
 *
 * Each panel carries a search query. The panel's tiles are the same section rendered against
 * /search for that query, so the matching happens in Shopify's search index over the whole
 * catalogue instead of in Liquid over a collection the page cannot filter.
 *
 * Nothing is fetched until a panel is first shown: the opening panel loads when the module scrolls
 * into view, the rest when their pill is pressed. A product page that nobody scrolls costs nothing.
 *
 * Every price on a tile is server-rendered. The running total has to add numbers, so it cannot be,
 * and it is printed with the shop's own money_format string handed over in data-pa-money — which is
 * what the theme's "no money in JS" rule is actually protecting: a format that cannot drift from the
 * shop's. The authoritative total is still the cart drawer's, which the note under the sum says.
 */
import { define, on, sectionIdOf, searchSection } from '@theme/global';
import { addItems } from '@theme/cart';

const SECTION = 'product-addons';

class ProductAddons extends HTMLElement {
  connectedCallback() {
    /* [role=tablist], not a data hook: the markup moved to a snippet and the hook did not come with
       it, so the pills had no listener at all and nothing happened when one was pressed. The role is
       the thing that actually has to be there. */
    this.tablist = this.querySelector('[role="tablist"]');
    this.panels = [...this.querySelectorAll('[data-pa-panel]')];
    this.bar = this.querySelector('[data-pa-bar]');
    this.submit = this.querySelector('[data-pa-submit]');
    this.label = this.querySelector('[data-pa-submit-label]');
    this.hint = this.querySelector('[data-pa-hint]');
    this.live = this.querySelector('[data-pa-live]');
    this.errorBox = this.querySelector('[data-pa-error]');
    if (!this.panels.length || !this.bar) return;

    this.str = this.bar.dataset;
    this.sectionId = sectionIdOf(this);
    this.root = this.closest('.shopify-section') || document.body;
    this.mainVariant = String(this.dataset.paMainVariant || '');
    this.base = Number(this.dataset.paBase) || 0;
    this.available = this.dataset.paAvailable !== 'false';
    this.moneyFormat = this.dataset.paMoney || '{{amount_no_decimals_with_comma_separator}} ₪';
    this.totalBox = this.querySelector('[data-pa-total]');
    this.addEventListener('change', this);
    this.tablist?.addEventListener('click', this);
    this.tablist?.addEventListener('keydown', this);
    this.onSubmit = () => this.add();
    this.submit?.addEventListener('click', this.onSubmit);

    /* The device's price and availability follow the variant picker; the quantity follows the
       stepper. Both live outside this element, in regions the section re-renders. */
    this.offVariant = on('variant:changed', ({ detail: { variant, sectionId } }) => {
      if (sectionId !== this.sectionId || !variant) return;
      this.mainVariant = String(variant.id);
      this.base = Number(variant.price) || 0;
      this.available = variant.available !== false;
      this.refresh();
    });
    this.onQuantity = (e) => {
      if (e.target.matches?.('input[name="quantity"]')) this.refresh();
    };
    this.root.addEventListener('change', this.onQuantity);

    /* The first panel loads when the module is near the viewport, not on page load. */
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this.observer.disconnect();
      this.load(this.panels.find((p) => !p.hidden) || this.panels[0]);
    }, { rootMargin: '300px' });
    this.observer.observe(this);
    this.refresh();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.controllers?.forEach((c) => c.abort());
    this.offVariant?.();
    this.root?.removeEventListener('change', this.onQuantity);
    this.submit?.removeEventListener('click', this.onSubmit);
    this.publish(0);
  }

  /* What the product form adds alongside the device. */
  selectedItems() {
    return this.checked.map((c) => ({ id: Number(c.closest('[data-pa-item]').dataset.paVariant), quantity: 1 }));
  }

  /* After a successful add: untick everything, so a second press adds the device alone. */
  clear() {
    this.checked.forEach((c) => { c.checked = false; });
    this.refresh();
    this.say(this.str.paStrAdded);
  }

  /* An add that failed part-way: the cart drawer already shows what really went in. */
  fail(message) {
    this.showError(message || this.str.paStrError);
  }

  get quantity() {
    const input = this.root.querySelector('input[name="quantity"]');
    return Math.max(1, Number(input?.value) || 1);
  }

  /* The badge on the buy buttons reads these from the section root, which survives the
     re-render of the button regions. */
  publish(n) {
    if (!this.root) return;
    this.root.toggleAttribute('data-pa-count', n > 0);
    if (n > 0) this.root.style.setProperty('--pa-count', String(n));
    else this.root.style.removeProperty('--pa-count');
  }

  say(text) {
    if (!this.live || !text) return;
    this.live.textContent = '';
    clearTimeout(this.sayTimer);
    this.sayTimer = setTimeout(() => { this.live.textContent = text; }, 120);
  }

  get tabs() { return this.tablist ? [...this.tablist.querySelectorAll('[role="tab"]')] : []; }
  get checked() { return [...this.querySelectorAll('[data-pa-check]')].filter((c) => c.checked); }

  handleEvent(e) {
    if (e.type === 'change' && e.target.matches('[data-pa-check]')) return this.refresh();
    if (e.type === 'click') {
      const tab = e.target.closest('[role="tab"]');
      if (tab) this.activate(tab, false);
      return;
    }
    /* RTL: ArrowLeft moves forward along the row, ArrowRight back. */
    const tabs = this.tabs;
    const i = tabs.indexOf(e.target.closest('[role="tab"]'));
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowLeft') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowRight') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    this.activate(next, true);
  }

  activate(tab, focus) {
    this.tabs.forEach((other) => {
      const on = other === tab;
      other.setAttribute('aria-selected', on ? 'true' : 'false');
      other.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) this.load(panel);
  }

  /* One retry on an empty answer. The search endpoint returns an empty result set under a burst of
     requests — measured: the same four queries came back 0, then 4 on every one of four later
     rounds. Without the retry a single blip would leave "no accessories" on a group that has four,
     for the rest of the visit, because the panel would already be marked loaded. */
  async load(panel, attempt = 0) {
    if (!panel || panel.dataset.paLoaded === 'true') return;
    if (attempt === 0 && panel.dataset.paLoaded === 'pending') return;
    panel.dataset.paLoaded = 'pending';
    const list = panel.querySelector('[data-pa-list]');
    const empty = panel.querySelector('[data-pa-empty]');
    const ctrl = new AbortController();
    (this.controllers ||= []).push(ctrl);

    try {
      const doc = await searchSection(panel.dataset.paQuery, SECTION, { signal: ctrl.signal });
      const items = [...doc.querySelectorAll('[data-pa-item]')]
        /* Never offer the phone that is already on the page. */
        .filter((li) => li.dataset.paVariant !== this.mainVariant && li.dataset.paHandle !== this.dataset.paHandle);
      if (!items.length && attempt < 1) {
        await new Promise((r) => setTimeout(r, 700));
        return this.load(panel, attempt + 1);
      }
      list.innerHTML = '';
      items.forEach((li) => list.appendChild(li));
      panel.dataset.paLoaded = 'true';
      if (!items.length) {
        list.hidden = true;
        if (empty) empty.hidden = false;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 700));
        return this.load(panel, attempt + 1);
      }
      /* Left unmarked, so pressing the pill again tries once more. */
      panel.dataset.paLoaded = '';
      list.innerHTML = '';
      list.hidden = true;
      if (empty) empty.hidden = false;
    }
    this.refresh();
  }

  /* The shop's money_format, filled in. Only the four amount tokens Shopify defines are handled,
     which is every format a shop can be set to. */
  money(cents) {
    const fmt = (value, decimals, sep) => {
      const fixed = (value / 100).toFixed(decimals);
      const [whole, part] = fixed.split('.');
      const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
      return part ? `${grouped}.${part}` : grouped;
    };
    /* The page prints prices with money_without_trailing_zeros, so a whole amount loses its .00
       here too and the total matches every other price around it. */
    const strip = (text) => text.replace(/\.00(?=\D*$)/, '');
    return strip(this.moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) => {
      if (token === 'amount') return fmt(cents, 2, ',');
      if (token === 'amount_no_decimals') return fmt(cents, 0, ',');
      if (token === 'amount_with_comma_separator') return fmt(cents, 2, '.').replace(/\.(\d{2})$/, ',$1');
      if (token === 'amount_no_decimals_with_comma_separator') return fmt(cents, 0, '.');
      return fmt(cents, 0, ',');
    }));
  }

  refresh() {
    const n = this.checked.length;
    const standalone = !this.available;
    this.toggleAttribute('data-pa-standalone', standalone);
    if (this.submit) this.submit.disabled = n === 0;

    const extras = this.checked.reduce((sum, c) => sum + (Number(c.closest('[data-pa-item]').dataset.paPrice) || 0), 0);
    /* Sold out: the device is not part of the purchase, so the total is the accessories alone. */
    const base = standalone ? 0 : this.base * this.quantity;
    if (this.totalBox) this.totalBox.textContent = this.money(base + extras);

    /* Each pill carries how many of its own tiles are ticked, so a choice made in one group is still
       visible from the others. */
    this.tabs.forEach((tab) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      const box = tab.querySelector('[data-pa-tab-count]');
      if (!panel || !box) return;
      const picked = panel.querySelectorAll('[data-pa-check]:checked').length;
      box.textContent = picked ? String(picked) : '';
      box.hidden = picked === 0;
    });

    const hint = n === 0 ? this.str.paStrHintIdle
      : n === 1 ? this.str.paStrHintOne
      : this.str.paStrHintMany.replace('{count}', n);
    if (this.hint) this.hint.textContent = hint;
    if (this.label) {
      this.label.textContent = n === 0 ? this.str.paStrIdle
        : n === 1 ? this.str.paStrOne
        : this.str.paStrMany.replace('{count}', n);
    }
    this.publish(standalone ? 0 : n);
    if (n !== this.lastCount) {
      if (this.lastCount !== undefined && n > 0 && !standalone) this.say(hint);
      this.lastCount = n;
    }
    this.hideError();
  }

  showError(message) {
    if (!this.errorBox) return;
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
  }

  hideError() {
    if (!this.errorBox) return;
    this.errorBox.hidden = true;
    this.errorBox.textContent = '';
  }

  /* The standalone button: only shown while the device is sold out. */
  async add() {
    const items = this.selectedItems();
    if (!items.length || !this.submit) return;

    this.submit.disabled = true;
    this.submit.setAttribute('aria-busy', 'true');
    if (this.label) this.label.textContent = this.str.paStrBusy;
    this.hideError();

    try {
      await addItems(items, { opener: this.submit });
      this.clear();
    } catch (error) {
      this.showError(error?.message || this.str.paStrError);
    } finally {
      this.submit.removeAttribute('aria-busy');
      this.refresh();
    }
  }
}

define('product-addons', ProductAddons);

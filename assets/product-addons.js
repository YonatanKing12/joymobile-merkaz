/* "השלימו את הערכה" — sections/product-addons.liquid.
 *
 * Each panel carries a search query. The panel's tiles are the same section rendered against
 * /search for that query, so the matching happens in Shopify's search index over the whole
 * catalogue instead of in Liquid over a collection the page cannot filter.
 *
 * Nothing is fetched until a panel is first shown: the opening panel loads when the module scrolls
 * into view, the rest when their pill is pressed. A product page that nobody scrolls costs nothing.
 *
 * Money is never formatted here. Every price on a tile is server-rendered, the bar counts rather
 * than totals, and the real total is the cart drawer's.
 */
import { define, announce } from '@theme/global';
import { addItems } from '@theme/cart';

const SECTION = 'product-addons';

class ProductAddons extends HTMLElement {
  connectedCallback() {
    this.tablist = this.querySelector('[data-pa-tablist]');
    this.panels = [...this.querySelectorAll('[data-pa-panel]')];
    this.bar = this.querySelector('[data-pa-bar]');
    this.submit = this.querySelector('[data-pa-submit]');
    this.label = this.querySelector('[data-pa-submit-label]');
    this.countBox = this.querySelector('[data-pa-count]');
    this.errorBox = this.querySelector('[data-pa-error]');
    if (!this.panels.length || !this.submit) return;

    this.str = this.bar.dataset;
    this.mainVariant = String(this.dataset.paMainVariant || '');
    this.addEventListener('change', this);
    this.tablist?.addEventListener('click', this);
    this.tablist?.addEventListener('keydown', this);
    this.submit.addEventListener('click', () => this.add());

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

  async load(panel) {
    if (!panel || panel.dataset.paLoaded) return;
    panel.dataset.paLoaded = 'pending';
    const list = panel.querySelector('[data-pa-list]');
    const empty = panel.querySelector('[data-pa-empty]');
    const ctrl = new AbortController();
    (this.controllers ||= []).push(ctrl);

    const url = '/search?q=' + encodeURIComponent(panel.dataset.paQuery) +
      '&type=product&options%5Bprefix%5D=last&section_id=' + SECTION;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const items = [...doc.querySelectorAll('[data-pa-item]')]
        /* Never offer the phone that is already on the page. */
        .filter((li) => li.dataset.paVariant !== this.mainVariant && li.dataset.paHandle !== this.dataset.paHandle);
      list.innerHTML = '';
      items.forEach((li) => list.appendChild(li));
      panel.dataset.paLoaded = 'true';
      if (!items.length) {
        list.hidden = true;
        if (empty) empty.hidden = false;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      panel.dataset.paLoaded = '';
      list.innerHTML = '';
      list.hidden = true;
      if (empty) empty.hidden = false;
    }
    this.refresh();
  }

  refresh() {
    const n = this.checked.length;
    this.submit.disabled = n === 0;
    if (this.label) {
      this.label.textContent = n === 0 ? this.str.paStrIdle
        : n === 1 ? this.str.paStrOne
        : this.str.paStrMany.replace('{count}', n);
    }
    if (this.countBox) {
      this.countBox.textContent = n === 0 ? ''
        : n === 1 ? this.str.paStrCountOne
        : this.str.paStrCountMany.replace('{count}', n);
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

  async add() {
    const picked = this.checked;
    if (!picked.length) return;
    const items = picked.map((c) => ({ id: Number(c.closest('[data-pa-item]').dataset.paVariant), quantity: 1 }));

    this.submit.disabled = true;
    this.submit.setAttribute('aria-busy', 'true');
    if (this.label) this.label.textContent = this.str.paStrBusy;
    this.hideError();

    try {
      await addItems(items);
      picked.forEach((c) => { c.checked = false; });
      announce(this.str.paStrCountOne);
    } catch (error) {
      this.showError(error?.message || this.str.paStrError);
    } finally {
      this.submit.removeAttribute('aria-busy');
      this.refresh();
    }
  }
}

define('product-addons', ProductAddons);

// /search/suggest rejects Hebrew on this store (HTTP 417), so this renders the search page's section instead.
import { routes, debounce, fetchSectionHTML, parseHTML, announce, t, define } from '@theme/global';

const PARAMS = '&type=product,article,page&options[prefix]=last&options[unavailable_products]=last';

class PredictiveSearch extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input[name="q"]');
    this.results = this.querySelector('[data-results]');
    if (!this.input || !this.results) return;
    this.soon = debounce(() => this.search(), 250);
    ['input', 'keydown', 'focusout'].forEach((type) => this.addEventListener(type, this));
    this.results.addEventListener('mousedown', this); // keep focus in the input
  }

  disconnectedCallback() { this.ctrl?.abort(); }
  get query() { return this.input.value.trim(); }
  get options() { return [...this.results.querySelectorAll('[role="option"]')]; }

  handleEvent(e) {
    const { type, target } = e;
    if (type === 'input') this.query.length < 2 ? this.close(true) : this.soon();
    else if (type === 'mousedown') e.preventDefault();
    else if (type === 'focusout') this.contains(e.relatedTarget) || this.close();
    else if (target === this.input) this.onKey(e);
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

  async search() {
    const q = this.query;
    if (q.length < 2) return;
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    this.setAttribute('aria-busy', 'true');
    try {
      const url = `${routes.search}?q=${encodeURIComponent(q)}${PARAMS}`;
      const doc = parseHTML(await fetchSectionHTML(url, 'predictive-search', { signal: ctrl.signal }));
      this.results.replaceChildren(...(doc.querySelector('.shopify-section') || doc).childNodes);
      const count = this.options.filter((o) => !o.hasAttribute('data-all')).length;
      announce(t('results', { count }));
    } catch (err) {
      if (err.name === 'AbortError') return;
      const p = Object.assign(document.createElement('p'), { className: 'predictive-search__error', textContent: t('error') });
      this.results.replaceChildren(p);
      announce(t('error'));
    } finally {
      if (ctrl === this.ctrl) this.removeAttribute('aria-busy');
    }
    if (this.contains(document.activeElement)) this.open();
  }
}

define('predictive-search', PredictiveSearch);

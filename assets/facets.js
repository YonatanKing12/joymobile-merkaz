import {
  fetchSectionHTML, parseHTML, swapRegions, swapFrom, debounce, announce, showError, t, sectionIdOf, define, trapFocus,
  releaseFocus, lockScroll, onEscape, prefersReducedMotion
} from '@theme/global';

const isPrice = (el) => /\.price\./.test(el.name);

class FacetFilters extends HTMLElement {
  connectedCallback() {
    this.current = location.search.slice(1);
    this.priceSoon = debounce(() => this.apply(), 500);
    this.panelRole = this.querySelector('[data-facets-drawer]')?.getAttribute('role'); // not `role`: Element#role reflects
    ['change', 'input', 'submit', 'click'].forEach((type) => this.addEventListener(type, this));
    addEventListener('popstate', this);
    this.offEscape = onEscape(this, () => (this.hasAttribute('open') ? this.drawer(false) : false));
  }

  disconnectedCallback() {
    removeEventListener('popstate', this);
    this.offEscape();
    this.ctrl?.abort();
    this.drawer(false);
  }

  get form() { return this.querySelector('form'); }

  apply() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(this.form)) if (value !== '' && key !== 'page') params.append(key, value);
    this.render(params.toString());
  }

  handleEvent(e) {
    const el = e.target;
    if (e.type === 'popstate') return this.render(location.search.slice(1), false);
    if (e.type === 'submit') {
      if (el !== this.form) return; // product cards' forms bubble up here
      e.preventDefault();
      this.apply();
      return this.drawer(false);
    }
    if (e.type === 'input') return isPrice(el) && this.priceSoon();
    if (e.type === 'change') return el.form && el.form === this.form && !isPrice(el) && this.apply();
    const opener = el.closest('[data-facets-open]');
    if (opener || el.closest('[data-close]')) return this.drawer(!!opener, opener);
    // Same-page links: pagination, filter chips, clear all; [data-load-more] appends the next page.
    const link = el.closest('a[href]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash) return;
    e.preventDefault();
    this.render(url.searchParams.toString(), true, !link.hasAttribute('data-load-more'), link.hasAttribute('data-load-more'));
  }

  async render(params, push = true, focusResults = false, append = false) {
    if (params === this.current) return;
    const previous = this.current, url = location.pathname + (params ? `?${params}` : '');
    this.current = params;
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    this.setAttribute('aria-busy', 'true');
    showError(this.querySelector('[data-facets-error]'), '');
    try {
      const doc = parseHTML(await fetchSectionHTML(url, sectionIdOf(this), { signal: ctrl.signal }));
      const added = append ? this.appendPage(doc) : [];
      if (added.length) {
        swapFrom(doc, '[data-swap="pagination"]', this);
        added[0].querySelector('a[href]')?.focus({ preventScroll: true });
      } else {
        // Keep open groups; set before the swap so a focused field can be refocused.
        this.querySelectorAll('details[id]').forEach((d) => {
          const next = doc.getElementById(d.id);
          if (next) next.open = d.open;
        });
        const field = push && this.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox],[type=radio])') ? document.activeElement : null, typed = field?.value;
        swapRegions(doc, this);
        const now = document.activeElement; // keep what was typed while the request ran
        if (field?.id && now !== field && now.id === field.id) now.value = typed;
      }
      if (push) history.pushState({ facets: params }, '', url);
      const count = this.querySelector(append ? '[data-swap="pagination"] p' : '[data-swap="count"]');
      announce(count?.textContent.trim() || '');
      const target = focusResults && (count || this.querySelector('[data-swap="grid"]'));
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.current = previous;
      showError(this.querySelector('[data-facets-error]'), t('error'));
    } finally {
      if (ctrl === this.ctrl) this.removeAttribute('aria-busy');
    }
  }

  // "Load more": each result list of the next page ([data-grid="…"]: products, articles/pages on search) joins its
  // twin here; a list that was empty so far (hidden wrapper) is revealed. Returns the added items.
  appendPage(doc) {
    const added = [];
    for (const next of doc.querySelectorAll('[data-grid]')) {
      const list = this.querySelector(`[data-grid="${CSS.escape(next.dataset.grid)}"]`), items = [...next.children];
      if (!list || !items.length) continue;
      list.append(...items);
      added.push(...items);
      const wrap = list.closest('[hidden]');
      if (wrap && this.contains(wrap)) wrap.hidden = false;
    }
    return added;
  }

  drawer(open, opener) {
    if (open === this.hasAttribute('open')) return;
    const panel = this.querySelector('[data-facets-drawer]') || this;
    this.toggleAttribute('open', open);
    this.querySelectorAll('[data-facets-open]').forEach((btn) => btn.setAttribute('aria-expanded', open));
    lockScroll(open);
    if (open) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      this.opener = opener;
      requestAnimationFrame(() => this.hasAttribute('open') && trapFocus(panel));
    } else {
      this.panelRole ? panel.setAttribute('role', this.panelRole) : panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      releaseFocus(this.opener, panel);
    }
  }
}

define('facet-filters', FacetFilters);

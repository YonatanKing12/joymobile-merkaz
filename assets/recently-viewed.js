// "צפיתם לאחרונה" (sections/recently-viewed). The history is a list of product handles in this browser's
// localStorage, newest first. Storage may throw (private mode, blocked): then nothing is recorded or shown.
import { routes, define, parseHTML } from '@theme/global';

const KEY = 'joy:recent';
const MAX = 12;

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter((h) => typeof h === 'string' && h))].slice(0, MAX) : [];
  } catch {
    return [];
  }
}
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)].slice(0, MAX))); // dedupes: the first (newest) wins
  } catch {}
}
const drop = (handle) => write(read().filter((h) => h !== handle));

// Reads the list before recording the current product (data-handle, product pages only), so it is never shown.
// The cards are fetched when the section nears the viewport, with the wishlist page's pipeline
// (/products/<handle>?view=card); the carousel is revealed only once at least 2 cards are ready.
class RecentlyViewed extends HTMLElement {
  connectedCallback() {
    const current = this.dataset.handle, list = read();
    this.handles = list.filter((h) => h !== current).slice(0, +this.dataset.limit || MAX);
    if (current) write([current, ...list]);
    if (this.handles.length < 2) return;
    this.io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this.io.disconnect();
      this.load();
    }, { rootMargin: '400px 0px' });
    this.io.observe(this);
  }

  disconnectedCallback() {
    this.io?.disconnect();
    this.ctrl?.abort();
  }

  async load() {
    this.ctrl = new AbortController();
    const { handles } = this, cards = [];
    let next = 0;
    const worker = async () => {
      while (next < handles.length) {
        const i = next++;
        cards[i] = await this.card(handles[i]);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const slides = cards.filter(Boolean).map((card) => {
      const slide = Object.assign(document.createElement('div'), { className: 'carousel__slide related-products__slide' });
      slide.setAttribute('role', 'listitem');
      slide.append(card);
      return slide;
    });
    if (this.ctrl.signal.aborted || slides.length < 2) return;
    this.querySelector('[data-track]').replaceChildren(...slides);
    // Arrows only where the cards overflow (section-related-products.css: 3.2 · 4 · 5 · 6 · 7 · 8 per view).
    const box = this.querySelector('[data-carousel]');
    ['md', 'lg', 'xl', '2xl', '3xl', '4xl'].forEach((size, i) => box.style.setProperty(`--rp-scroll-${size}`, slides.length > i + 3 ? 'grid' : 'none'));
    box.hidden = false; // the carousel measures its slides when the track gets a size
    this.querySelector('[data-editor-notice]')?.remove();
  }

  // A 404, a redirect (renamed product: Shopify drops ?view=card and answers with the whole page) or a non-HTML answer
  // means the product is gone: its handle is dropped. Only the card element itself is used.
  async card(handle) {
    try {
      const res = await fetch(`${routes.root}products/${encodeURIComponent(handle)}?view=card`, { signal: this.ctrl.signal });
      if (res.status === 404 || res.redirected || (res.ok && !res.headers.get('content-type')?.includes('text/html'))) {
        drop(handle);
        return null;
      }
      if (!res.ok) return null;
      const card = [...parseHTML(await res.text()).children].find((el) => el.matches('.card-product'));
      // The card view prints <h2> titles (wishlist page); here they sit under the section's <h2>.
      card?.querySelectorAll('h2.card-product__title').forEach((h2) => {
        const h3 = Object.assign(document.createElement('h3'), { className: h2.className });
        h3.append(...h2.childNodes);
        h2.replaceWith(h3);
      });
      return card || null;
    } catch {
      return null;
    }
  }
}

define('recently-viewed', RecentlyViewed);

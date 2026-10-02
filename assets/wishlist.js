// Storage may throw (private mode): the in-memory list keeps the page working.
import { routes, emit, on, t, define, announce, parseHTML, strings } from '@theme/global';

const KEY = 'mhm:wishlist';
let list = [];
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (Array.isArray(stored)) list = stored.filter((h) => typeof h === 'string').slice(0, 100);
} catch {}
// One-time import of the old theme's `wishListsArr` (handles, oldest first); ids/junk dropped, key removed once saved.
try {
  const old = JSON.parse(localStorage.getItem('wishListsArr'));
  if (Array.isArray(old)) {
    const handles = old.filter((h) => typeof h === 'string' && /^(?!\d+$)[\p{L}\p{N}_-]+$/u.test(h)).reverse();
    list = [...new Set([...list, ...handles])].slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.removeItem('wishListsArr');
  }
} catch {}
function save(next) {
  list = next.slice(0, 100);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  emit('wishlist:changed', { handles: getAll() });
}

export const getAll = () => [...list];
export const has = (handle) => list.includes(handle);
export const count = () => list.length;
export function toggle(handle) {
  save(has(handle) ? list.filter((h) => h !== handle) : [handle, ...list]);
  return has(handle);
}
export const remove = (handle) => has(handle) && save(list.filter((h) => h !== handle));

// Constant label; aria-pressed carries the state, and a polite message says what the tap did (focus may move on the
// wishlist page, where un-hearting removes the card). Only localized strings are spoken (window.theme.strings).
const say = (key) => strings[key] && announce(strings[key]);

class WishlistButton extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('button');
    if (!this.button) return;
    if (!this.button.hasAttribute('aria-label')) this.button.setAttribute('aria-label', t('wishlist'));
    this.button.addEventListener('click', this);
    this.off = on('wishlist:changed', () => this.sync());
    this.sync();
  }

  disconnectedCallback() { this.off?.(); }
  sync() { this.button.setAttribute('aria-pressed', has(this.dataset.handle)); }

  handleEvent(e) {
    e.preventDefault();
    say(toggle(this.dataset.handle) ? 'wishlistAdded' : 'wishlistRemoved');
  }
}

class WishlistCount extends HTMLElement {
  connectedCallback() {
    this.off = on('wishlist:changed', () => this.sync());
    this.sync();
  }

  disconnectedCallback() { this.off(); }

  sync() {
    this.dataset.count = count();
    (this.querySelector('[data-count-text]') || this).textContent = count();
  }
}

class WishlistGrid extends HTMLElement {
  connectedCallback() {
    this.grid = this.querySelector('[data-grid]');
    if (!this.grid) return;
    this.off = on('wishlist:changed', (e) => this.prune(e.detail.handles));
    this.render();
  }

  disconnectedCallback() {
    this.off?.();
    this.ctrl?.abort();
  }

  async render() {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    const slots = list.map((handle) => {
      const slot = Object.assign(document.createElement('li'), { className: 'grid__item' });
      slot.dataset.handle = handle;
      return slot;
    });
    this.grid.replaceChildren(...slots);
    this.empty();
    if (!slots.length) return;
    this.setAttribute('aria-busy', 'true');
    let next = 0;
    const worker = async () => {
      while (next < slots.length) await this.fill(slots[next++]);
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.removeAttribute('aria-busy');
    this.empty();
  }

  // A redirect (renamed product: Shopify drops ?view=card and answers with the whole page) or a non-HTML answer
  // counts as gone, like a 404: the handle and its slot are dropped. Only the card element itself is inserted.
  async fill(slot) {
    const { handle } = slot.dataset;
    try {
      const res = await fetch(`${routes.root}products/${encodeURIComponent(handle)}?view=card`, { signal: this.ctrl.signal });
      if (res.status === 404 || res.redirected || (res.ok && !res.headers.get('content-type')?.includes('text/html'))) {
        remove(handle);
        throw new Error('gone');
      }
      if (!res.ok) throw new Error(res.status);
      const card = [...parseHTML(await res.text()).children].find((el) => el.matches('.card-product'));
      if (!card) throw new Error('no card');
      slot.replaceChildren(card);
    } catch {
      slot.remove();
    }
  }

  // Un-hearting a card removes it. Its focus moves to the next card's heart (else the previous card's), or to the
  // empty state once none is left — never lost to <body>.
  prune(handles) {
    const slots = [...this.grid.children], focused = slots.find((slot) => slot.contains(document.activeElement));
    const gone = slots.filter((slot) => !handles.includes(slot.dataset.handle));
    gone.forEach((slot) => slot.remove());
    this.empty();
    if (!gone.includes(focused)) return;
    const rest = slots.filter((slot) => !gone.includes(slot)), i = slots.indexOf(focused);
    const next = rest.find((slot) => slots.indexOf(slot) > i) || rest.at(-1);
    const target = next ? next.querySelector('wishlist-button button') || next.querySelector('a[href]') : this.querySelector('[data-empty]');
    if (!next && target) target.tabIndex = -1;
    target?.focus();
  }

  empty() {
    const none = !this.grid.children.length;
    this.grid.hidden = none;
    this.querySelector('[data-empty]')?.toggleAttribute('hidden', !none);
  }
}

define('wishlist-button', WishlistButton);
define('wishlist-count', WishlistCount);
define('wishlist-grid', WishlistGrid);

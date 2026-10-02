// @theme/global. Money is never formatted in JS: prices always come server-rendered.
const cfg = window.theme || {};
const html = document.documentElement;

export const isRTL = true;
export const routes = { root: '/', cart: '/cart', cart_add: '/cart/add', cart_change: '/cart/change', cart_update: '/cart/update', search: '/search', ...cfg.routes };
routes.root = routes.root.replace(/\/?$/, '/');
export const strings = {
  error: 'אירעה שגיאה. נסו שוב.', added: 'המוצר נוסף לעגלה', cartUpdated: 'העגלה עודכנה', results: 'נמצאו {count} תוצאות',
  wishlist: 'הוספה/הסרה מהמועדפים', slide: 'שקופית {n} מתוך {total}', a11yReset: 'הגדרות הנגישות אופסו', ...cfg.strings
};
export const t = (key, vars = {}) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
export const define = (name, cls) => customElements.get(name) || customElements.define(name, cls);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => motion.matches || html.classList.contains('a11y-no-motion');
export const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
export function on(name, fn) {
  document.addEventListener(name, fn);
  return () => document.removeEventListener(name, fn);
}

const withParam = (url, key, value) => `${url}${url.includes('?') ? '&' : '?'}${key}=${value}`;
export async function fetchJSON(url, opts = {}) {
  let res, data = {};
  try {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...opts.headers };
    res = await fetch(url, { ...opts, headers });
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  if (res?.ok) return data;
  // Shopify's `description` is the customer-facing message.
  const message = res && typeof data.description === 'string' && data.description;
  throw Object.assign(new Error(message || strings.error), { status: res?.status || 0, data });
}
export const postJSON = (url, body, opts) => fetchJSON(url, { ...opts, method: 'POST', body: JSON.stringify(body) });
export const fetchSections = (url, ids, opts) => fetchJSON(withParam(url, 'sections', ids.join(',')), opts);
export async function fetchSectionHTML(url, sectionId, opts) {
  const res = await fetch(withParam(url, 'section_id', sectionId), opts);
  if (!res.ok) throw Object.assign(new Error(strings.error), { status: res.status });
  return res.text();
}

export function parseHTML(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  return tpl.content;
}
const focusedId = (node) => node.contains(document.activeElement) && document.activeElement.id;
function refocus(node, id) {
  const el = node.id === id ? node : node.querySelector(`#${CSS.escape(id)}`);
  el?.focus({ preventScroll: true });
  return el;
}
export function swapFrom(source, selector, scope = document) {
  const next = source.querySelector(selector), cur = scope.querySelector(selector);
  if (!next || !cur) return null;
  const id = focusedId(cur);
  cur.replaceWith(next);
  if (id) refocus(next, id);
  return next;
}
export const swapRegions = (source, scope) =>
  scope.querySelectorAll('[data-swap]').forEach((el) => swapFrom(source, `[data-swap="${el.dataset.swap}"]`, scope));
export function replaceContent(target, source) {
  const id = focusedId(target);
  target.replaceChildren(...source.childNodes);
  return id ? refocus(target, id) : null;
}
export const sectionIdOf = (el) => el.dataset.sectionId || el.closest('.shopify-section')?.id.replace('shopify-section-', '');
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

let live;
const shown = (el) => el.checkVisibility?.({ visibilityProperty: true }) ?? (el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible');
// VoiceOver drops every live region outside an open aria-modal dialog, so while one is open a message goes to the
// dialog's own [data-a11y-live] region (the cart drawer has one); otherwise, or when it has none, to #a11y-live.
function liveRegion() {
  for (const box of document.querySelectorAll('cart-drawer[open], dialog[open], [aria-modal="true"]')) {
    const region = box.querySelector('[data-a11y-live]');
    if (region && shown(box)) return region;
  }
  live ||= document.getElementById('a11y-live') ||
    document.body.appendChild(Object.assign(document.createElement('div'), { id: 'a11y-live', className: 'visually-hidden' }));
  live.setAttribute('aria-live', 'polite');
  return live;
}
export function announce(message) {
  liveRegion().textContent = '';
  // Clearing first re-announces repeats. Resolved again: an add opens the cart drawer right after announcing.
  setTimeout(() => (liveRegion().textContent = message), 100);
}
export function showError(box, message) {
  if (box) {
    box.textContent = message;
    box.hidden = !message;
  }
  if (message) announce(message);
}

export const focusables = (box) => [...box.querySelectorAll('a[href],button,input,select,textarea,summary,iframe,[tabindex]')].filter((el) =>
  el.tabIndex >= 0 && !el.disabled && !el.closest('[inert]') && (el.checkVisibility?.({ visibilityProperty: true }) ?? el.getClientRects().length > 0));
const traps = [];
const untrap = (box) => traps.includes(box) && traps.splice(traps.indexOf(box), 1);
function onTrapKey(e) {
  const box = traps.at(-1);
  if (!box || e.key !== 'Tab') return;
  const list = focusables(box), el = document.activeElement;
  if (!list.length || el === (e.shiftKey ? list[0] : list.at(-1)) || !box.contains(el)) {
    e.preventDefault();
    (e.shiftKey ? list.at(-1) : list[0])?.focus();
  }
}
function onTrapFocus(e) {
  const box = traps.at(-1);
  if (box && !box.contains(e.target)) (focusables(box)[0] || box).focus();
}
export function trapFocus(container, elementToFocus) {
  untrap(container);
  traps.push(container);
  document.addEventListener('keydown', onTrapKey);
  document.addEventListener('focusin', onTrapFocus);
  (elementToFocus || focusables(container)[0] || container).focus();
}
export function releaseFocus(returnTo, ...container) {
  untrap(container.length ? container[0] : traps.at(-1));
  if (!traps.length) {
    document.removeEventListener('keydown', onTrapKey);
    document.removeEventListener('focusin', onTrapFocus);
  }
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true }); // the opener is where the shopper left it; scrolling to it jumped the page to the top (sticky header + scroll-padding)
}
export function onEscape(el, fn) {
  const handler = (e) => e.key === 'Escape' && !e.defaultPrevented && fn(e) !== false && e.preventDefault();
  el.addEventListener('keydown', handler);
  return () => el.removeEventListener('keydown', handler);
}
// Scroll lock. iOS Safari ignores overflow: hidden on <html>, so under an open drawer a drag would scroll the page
// behind it. While the page is locked, a one-finger drag is cancelled unless something under the finger can still
// scroll that way (the drawer's list, a textarea, a horizontal track). The body is never pinned: that froze the page
// on iPhones (da6f22d). The class on <html> is the only state the touch code reads, and a lock nothing holds any more
// is dropped at the next touch, page show or tab return, so a stale lock costs one touch, never the page.
const SCROLLS = /^(auto|scroll|overlay)$/;
function canScroll(el, dx, dy) {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (; el && el !== document.body && el !== html; el = el.parentElement) {
    if (el.matches('input[type="range"]')) return true;
    const style = getComputedStyle(el);
    if (vertical) {
      if (SCROLLS.test(style.overflowY) && el.scrollHeight > el.clientHeight &&
        (dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
    } else if (SCROLLS.test(style.overflowX) && el.scrollWidth > el.clientWidth) {
      // scrollLeft runs 0…max left-to-right and -max…0 right-to-left; a finger moving right lowers it.
      const max = el.scrollWidth - el.clientWidth, low = style.direction === 'rtl' ? -max : 0;
      if (dx > 0 ? el.scrollLeft > low + 1 : el.scrollLeft < low + max - 1) return true;
    }
  }
  return false;
}
let touch = null;
function onTouchMove(e) {
  if (!touch || !e.cancelable || e.touches.length !== 1 || !html.classList.contains('scroll-locked')) return;
  if ((window.visualViewport?.scale ?? 1) > 1.01) return; // zoomed in: the finger pans the zoomed view
  const { clientX: x, clientY: y } = e.touches[0], dx = x - touch.x, dy = y - touch.y;
  touch = { x, y };
  if ((dx || dy) && !canScroll(e.target, dx, dy)) e.preventDefault();
}

let locks = 0;
function applyLock() {
  html.classList.toggle('scroll-locked', locks > 0);
  html.style.overflow = locks ? 'hidden' : '';
  // Scroll-blocking listener only while locked: the rest of the time touch scrolling never waits for the main thread.
  document[locks ? 'addEventListener' : 'removeEventListener']('touchmove', onTouchMove, { passive: false });
}
export function lockScroll(lock) {
  locks = Math.max(0, locks + (lock ? 1 : -1));
  applyLock();
}

// What takes the lock: DialogElement hosts (cart drawer, a11y panel), the header's menu and search drawers
// (menu-drawer > details), the filters drawer (facet-filters) and the product lightbox (a modal <dialog>).
const modal = (dialog) => {
  try {
    return dialog.matches(':modal');
  } catch {
    return true;
  }
};
const lockHolderOpen = () => [...document.querySelectorAll('[open]')].some((el) =>
  el instanceof DialogElement || el.matches('menu-drawer > details, facet-filters') || (el.localName === 'dialog' && modal(el)));
function healScrollLock() {
  if ((locks || html.classList.contains('scroll-locked')) && !lockHolderOpen()) {
    locks = 0;
    applyLock();
  }
}
addEventListener('pageshow', healScrollLock);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && healScrollLock());
document.addEventListener('touchstart', (e) => {
  touch = null;
  if (!html.classList.contains('scroll-locked')) return;
  healScrollLock();
  if (e.touches.length === 1 && html.classList.contains('scroll-locked')) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

const EDITOR = ['shopify:section:select', 'shopify:section:deselect'];
export class DialogElement extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this);
    this.offEscape = onEscape(this, () => (this.isOpen ? this.close() : false));
    EDITOR.forEach((type) => document.addEventListener(type, this)); // theme editor: open while its section is selected
  }

  disconnectedCallback() {
    this.offEscape();
    EDITOR.forEach((type) => document.removeEventListener(type, this));
    if (this.isOpen) {
      lockScroll(false);
      releaseFocus(null, this);
    }
  }

  get isOpen() { return this.hasAttribute('open'); }

  handleEvent(e) {
    if (e.type === 'click') e.target.closest('[data-close]') && this.close();
    else if (e.target.contains(this)) e.type === EDITOR[0] ? this.open() : this.close();
  }

  open(opener) {
    if (this.isOpen) return;
    this.opener = opener || document.activeElement;
    this.setOpen(true);
    requestAnimationFrame(() => this.isOpen && trapFocus(this, this.querySelector('[autofocus]')));
  }

  close() {
    if (!this.isOpen) return;
    this.setOpen(false);
    releaseFocus(this.opener, this);
  }

  setOpen(open) {
    this.toggleAttribute('open', open);
    lockScroll(open);
    if (this.id) document.querySelectorAll(`[aria-controls="${this.id}"]`).forEach((el) => el.setAttribute('aria-expanded', open));
  }
}
document.addEventListener('click', (e) => {
  const opener = !(e.metaKey || e.ctrlKey || e.shiftKey) && e.target.closest('[aria-haspopup="dialog"][aria-controls]');
  const target = opener && document.getElementById(opener.getAttribute('aria-controls'));
  if (!(target instanceof DialogElement)) return;
  e.preventDefault();
  target.isOpen ? target.close() : target.open(opener);
});

// In-page links to (or into) a closed <details> — "קרא עוד" → the description tab of an exclusive group,
// "פרטים טכניים נוספים", FAQ anchors: open it first (the browser then scrolls to it), also for a #hash on load.
function openTarget(hash, onLoad) {
  let el = null;
  try {
    el = hash.length > 1 && document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {}
  if (!el) return;
  const hidden = !(el.checkVisibility?.() ?? true);
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  if (onLoad && hidden) el.scrollIntoView(); // the browser could not scroll to it while it was hidden
}
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href*="#"]');
  if (link?.hash && link.origin === location.origin && link.pathname === location.pathname) openTarget(link.hash);
});
openTarget(location.hash, true);

export class QuantityInput extends HTMLElement {
  connectedCallback() { this.addEventListener('click', this); }

  handleEvent(e) {
    const btn = e.target.closest('[name="plus"],[name="minus"]'), input = this.querySelector('input');
    if (!btn || !input) return;
    e.preventDefault();
    const before = input.value;
    btn.name === 'plus' ? input.stepUp() : input.stepDown(); // respects min/max/step
    if (input.value !== before) input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
define('quantity-input', QuantityInput);

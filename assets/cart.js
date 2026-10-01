import {
  routes, postJSON, fetchJSON, fetchSections, parseHTML, replaceContent, emit, on, announce, t, sectionIdOf, define, DialogElement
} from '@theme/global';

// Serialised, so responses never render out of order.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}
const pageCarts = () => document.querySelectorAll('cart-items:not(cart-drawer cart-items)');

// Undo lives here, not on an element: removing a line re-renders the drawer, and removing the last
// one swaps <cart-items> for the empty state, so any element that held the state is gone by the time
// the offer has to appear. { variant, quantity, title, expires }.
const UNDO_WINDOW = 8000;
let pendingUndo = null;
let undoTimer;
const drawerId = (drawer) => sectionIdOf(drawer) || 'cart-drawer';
function sectionIds() {
  const ids = new Set(['cart-count']), drawer = document.querySelector('cart-drawer');
  if (drawer) ids.add(drawerId(drawer));
  pageCarts().forEach((el) => ids.add(sectionIdOf(el) || 'main-cart'));
  return [...ids];
}

export function renderSections(sections) {
  const drawer = document.querySelector('cart-drawer');
  for (const [id, markup] of Object.entries(sections || {})) {
    const doc = markup && parseHTML(markup);
    if (!doc) continue;
    if (id === 'cart-count') {
      const next = doc.querySelector('cart-count');
      if (next) document.querySelectorAll('cart-count').forEach((el) => el.render(next));
    } else if (drawer && drawerId(drawer) === id) {
      const next = doc.querySelector('cart-drawer');
      if (next) drawer.render(next);
    } else {
      const cur = document.getElementById(`shopify-section-${id}`), next = doc.getElementById(`shopify-section-${id}`);
      const hadFocus = cur?.contains(document.activeElement);
      // Focus lost with a removed line goes to the cart heading.
      if (cur && next && !replaceContent(cur, next) && hadFocus) cur.querySelector('[data-cart-focus]')?.focus({ preventScroll: true });
    }
  }
}

export const getCart = () => fetchJSON(`${routes.cart}.js`);

export function addItems(items, { sections = sectionIds(), open = true, opener } = {}) {
  return serial(async () => {
    const res = await postJSON(`${routes.cart_add}.js`, { items, sections, sections_url: location.pathname }).catch((err) => {
      fetchSections(location.pathname, sections).then(renderSections, () => {}); // a 422 may have added the stock left
      throw err;
    });
    renderSections(res.sections);
    announce(t('added'));
    emit('cart:updated', { items: res.items, source: 'add' }); // /cart/add.js returns the added lines, not the cart
    // Theme setting "אחרי הוספה לעגלה": the drawer, or the cart page.
    if (open && !pageCarts().length) window.theme?.cartType === 'page' ? location.assign(routes.cart) : emit('cart:open', { opener });
    return res;
  });
}

export function changeLine({ key, line, quantity }) {
  return serial(async () => {
    const target = key ? { id: key } : { line };
    const cart = await postJSON(`${routes.cart_change}.js`, { ...target, quantity, sections: sectionIds(), sections_url: location.pathname });
    renderSections(cart.sections);
    emit('cart:updated', { cart, source: 'change' });
    announce(t('cartUpdated'));
    return cart;
  });
}

const update = (body, source) => serial(async () => {
  const cart = await postJSON(`${routes.cart_update}.js`, body);
  emit('cart:updated', { cart, source });
  return cart;
});
export const updateNote = (note) => update({ note }, 'note');
// Cart attributes, e.g. the consent checkboxes ('' removes one): saved on change, so a re-render keeps the tick.
export const updateAttributes = (attributes) => update({ attributes }, 'attributes');

// Only an undo that puts the line back as it was is worth offering, so the line says whether it can
// be: the markup prints data-undo-* for plain lines and withholds it from lines carrying properties
// or a selling plan, which /cart/add.js could not restore.
function rememberForUndo(line) {
  const { undoVariant, undoQuantity, undoTitle } = line.dataset;
  pendingUndo = undoVariant
    ? { variant: undoVariant, quantity: +undoQuantity || 1, title: undoTitle || '', expires: Date.now() + UNDO_WINDOW }
    : null;
}

function clearUndo() {
  pendingUndo = null;
  clearTimeout(undoTimer);
  document.querySelectorAll('[data-cart-undo]').forEach((bar) => (bar.hidden = true));
}

// Called on connect and after every re-render, by the drawer and by the cart page alike: the bar is
// printed hidden and shows only while a removal is fresh enough to be worth taking back.
function showUndo(root) {
  const bar = root.querySelector('[data-cart-undo]');
  if (!bar) return;
  if (!pendingUndo || pendingUndo.expires <= Date.now()) return clearUndo();
  // Unhide before filling: a role=status region announces a change to its content, and a change made
  // while the region is still hidden is not one.
  bar.hidden = false;
  const title = bar.querySelector('[data-cart-undo-title]');
  if (title) title.textContent = pendingUndo.title;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(clearUndo, pendingUndo.expires - Date.now());
}

// Returns true when the click was the undo button, so the caller stops there.
function tryUndo(e) {
  if (!e.target.closest('[data-cart-undo-button]')) return false;
  const undo = pendingUndo;
  clearUndo();
  if (undo) addItems([{ id: undo.variant, quantity: undo.quantity }], { open: false }).catch((err) => announce(err.message));
  return true;
}

class CartDrawer extends DialogElement {
  connectedCallback() {
    super.connectedCallback();
    this.off = on('cart:open', (e) => this.open(e.detail?.opener));
    this.addEventListener('click', this.onClick);
    showUndo(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.onClick);
    this.off();
  }

  // The drawer's bar sits outside <cart-items> (removing the last line replaces that element with
  // the empty state), so the drawer itself listens for the button.
  onClick = (e) => tryUndo(e);

  render(next) {
    const hadFocus = this.contains(document.activeElement);
    const before = this.querySelector('[data-cart-total]')?.textContent;
    this.className = next.className;
    const refocused = replaceContent(this, next);
    if (!refocused && hadFocus && this.isOpen) (this.querySelector('[role="dialog"]') || this).focus();
    showUndo(this);
    // The total is the one number a shopper checks after every tap, and it sits far from the control
    // they touched: a short flash is what connects the two.
    const total = this.querySelector('[data-cart-total]');
    if (total && before !== undefined && before !== total.textContent) total.classList.add('is-flashing');
  }
}

class CartItems extends HTMLElement {
  connectedCallback() {
    this.timers = {};
    this.addEventListener('change', this);
    this.addEventListener('click', this);
    showUndo(this);
  }

  handleEvent(e) {
    const el = e.target, line = el.closest('[data-key]');
    if (e.type === 'click') {
      if (tryUndo(e)) return;
      if (line && el.closest('[data-cart-remove]')) {
        e.preventDefault();
        this.update(line, 0);
      }
    } else if (el.name === 'note') updateNote(el.value).catch((err) => announce(err.message));
    else if (el.type === 'checkbox' && el.name.startsWith('attributes[')) {
      updateAttributes({ [el.name.slice(11, -1)]: el.checked ? el.value : '' }).catch((err) => announce(err.message));
    } else if (line && el.tagName === 'INPUT') {
      if (el.value === '') return (el.value = el.defaultValue);
      const { key } = line.dataset;
      clearTimeout(this.timers[key]);
      this.timers[key] = setTimeout(() => this.update(line, +el.value), 300);
    }
  }

  async update(line, quantity) {
    const { key } = line.dataset, input = line.querySelector('input');
    // Every route to 0 is a removal: the remove mark, stepping down from 1, and typing it. The
    // stepper carries data-key too, so climb to the line for the undo data.
    if (quantity === 0) rememberForUndo(line.closest('li[data-key]') || line);
    line.classList.add('is-loading');
    this.setAttribute('aria-busy', 'true');
    try {
      await changeLine({ key, quantity });
    } catch (err) {
      if (quantity === 0) clearUndo(); // the line is still there
      if (input) input.value = input.defaultValue;
      document.querySelectorAll(`[data-key="${CSS.escape(key)}"] [data-line-error]`).forEach((box) => {
        box.textContent = err.message;
        box.hidden = false;
      });
      announce(err.message);
    }
    line.classList.remove('is-loading');
    this.removeAttribute('aria-busy');
  }
}

class CartCount extends HTMLElement {
  render(next) {
    this.dataset.count = next.dataset.count ?? '';
    this.replaceChildren(...next.cloneNode(true).childNodes);
  }
}

define('cart-drawer', CartDrawer);
define('cart-items', CartItems);
define('cart-count', CartCount);

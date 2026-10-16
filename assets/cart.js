import {
  routes, postJSON, fetchSections, parseHTML, replaceContent, emit, on, announce, t, sectionIdOf, define, DialogElement
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

export function addItems(items, { sections = sectionIds(), open = true, opener } = {}) {
  return serial(async () => {
    let res;
    try {
      res = await postJSON(`${routes.cart_add}.js`, { items, sections, sections_url: location.pathname });
    } catch (err) {
      // A 422 may still have added the stock that was left, so repaint from the server. Awaited inside
      // the task: run after it, this GET could land on top of a change queued behind the failed add.
      await fetchSections(location.pathname, sections).then(renderSections, () => {});
      throw err;
    }
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

// `render`: also re-render the cart sections, for a value the Liquid prints elsewhere (the pickup
// branch goes into the WhatsApp message). Off for the note and the consents, which nothing else shows.
const update = (body, source, render = false) => serial(async () => {
  const cart = await postJSON(`${routes.cart_update}.js`, render ? { ...body, sections: sectionIds(), sections_url: location.pathname } : body);
  if (render) renderSections(cart.sections);
  emit('cart:updated', { cart, source });
  return cart;
});
export const updateNote = (note) => update({ note }, 'note');
// Cart attributes, e.g. the consent checkboxes or the pickup branch ('' removes one): saved on change,
// so a re-render keeps the choice.
export const updateAttributes = (attributes, { render = false } = {}) => update({ attributes }, 'attributes', render);

// Coupon codes (snippets/cart-discount). `discount` replaces every code on the cart, so applying one sends
// the codes already there plus the new one. Resolves to whether Shopify applies it (the answer's
// discount_codes; an answer without the list counts as applied, and the re-rendered chips tell). One that
// does not is taken off again, as at Shopify's checkout: the cart is as it was, so nothing re-renders,
// unless taking it off fails, when the render shows its chip for the shopper to remove.
export const applyDiscount = (codes, code) => serial(async () => {
  const url = `${routes.cart_update}.js`, same = (d) => d.code.toLowerCase() === code.toLowerCase();
  const cart = await postJSON(url, { discount: [...codes, code].join(','), sections: sectionIds(), sections_url: location.pathname });
  if (cart.discount_codes && !cart.discount_codes.find(same)?.applicable) {
    await postJSON(url, { discount: codes.join(',') }).catch(() => renderSections(cart.sections));
    return false;
  }
  renderSections(cart.sections);
  emit('cart:updated', { cart, source: 'discount' });
  return true;
});
// Removing one sends the rest ('' removes them all).
export const updateDiscounts = (codes) => update({ discount: codes.join(',') }, 'discount', true);

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
  // A trailing left-to-right mark, as after the titles in the lines (snippets/cart-line): a title
  // ending "…S25+" keeps its "+" by the Latin instead of having it jump to the far end.
  if (title) title.textContent = pendingUndo.title && `${pendingUndo.title}\u200e`;
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
    const live = this.querySelector('[data-a11y-live]');
    this.className = next.className;
    const refocused = replaceContent(this, next);
    // Keep the live region the screen reader already knows: a region that has just been inserted is
    // often not listened to yet, and the "cart updated" message is written right after this render.
    if (live) this.querySelector('[data-a11y-live]')?.replaceWith(live);
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
    this.addEventListener('formdata', this.onFormData, true);
    showUndo(this);
  }

  // The checkout POST carries a cleared box's data-unchecked-value (the marketing consent's "לא",
  // snippets/cart-marketing), which a browser never posts for an unchecked box. Captured: the event is
  // fired at the form.
  onFormData = (e) => {
    for (const el of e.target.elements) {
      if (el.type === 'checkbox' && !el.checked && el.name && el.dataset.uncheckedValue) e.formData.set(el.name, el.dataset.uncheckedValue);
    }
  };

  handleEvent(e) {
    const el = e.target, line = el.closest('[data-key]');
    if (e.type === 'click') {
      if (tryUndo(e)) return;
      if (line && el.closest('[data-cart-remove]')) {
        e.preventDefault();
        this.update(line, 0);
      }
    } else if (el.name === 'note') updateNote(el.value).catch((err) => announce(err.message));
    else if ((el.type === 'checkbox' || el.type === 'radio') && el.name.startsWith('attributes[')) {
      // A radio fires change only when it becomes the checked one, so its value is the choice. A cleared
      // box removes its attribute, or saves its data-unchecked-value when it has one.
      const value = el.type === 'checkbox' && !el.checked ? (el.dataset.uncheckedValue ?? '') : el.value;
      updateAttributes({ [el.name.slice(11, -1)]: value }, { render: !!el.closest('[data-cart-render]') }).catch((err) => announce(err.message));
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
      // The boxes are role=alert, so the message is read from the line itself. Shown empty first and
      // filled a moment later: an alert announces a change to its content, and text that arrives
      // together with the unhiding is not reliably one (nor is the same text written twice).
      const boxes = document.querySelectorAll(`[data-key="${CSS.escape(key)}"] [data-line-error]`);
      boxes.forEach((box) => {
        box.textContent = '';
        box.hidden = false;
        setTimeout(() => (box.textContent = err.message), 100);
      });
      if (!boxes.length) announce(err.message);
    }
    line.classList.remove('is-loading');
    this.removeAttribute('aria-busy');
  }
}

// The coupon field (snippets/cart-discount). Its codes are the chips, the codes Liquid printed for the cart.
class CartDiscount extends HTMLElement {
  connectedCallback() {
    ['click', 'keydown', 'input'].forEach((type) => this.addEventListener(type, this));
  }

  get codes() { return [...this.querySelectorAll('[data-discount-code]')].map((el) => el.dataset.discountCode); }

  // An applied or removed code re-renders the sections, this element with them: what is left to do goes to
  // the new copy (same id).
  get current() { return document.getElementById(this.id) || this; }

  handleEvent(e) {
    const chip = e.target.closest('[data-discount-code]');
    if (e.type === 'input') e.target.removeAttribute('aria-invalid');
    else if (e.type === 'keydown') {
      // In the drawer the field sits inside the cart form, which Enter would submit to checkout.
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      e.preventDefault();
      this.apply();
    } else if (e.target.closest('[data-discount-apply]')) this.apply();
    else if (chip && e.target.closest('[data-discount-remove]')) this.remove(chip.dataset.discountCode);
  }

  async apply() {
    const input = this.querySelector('input'), button = this.querySelector('[data-discount-apply]'), code = input.value.trim();
    if (!code) return input.focus();
    if (this.hasAttribute('aria-busy')) return;
    // Shopify takes a code in any case; one typed again replaces its chip instead of doubling it.
    const codes = this.codes.filter((c) => c.toLowerCase() !== code.toLowerCase());
    this.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-busy', 'true');
    let applied = false, failed = false;
    try {
      applied = await applyDiscount(codes, code);
    } catch {
      failed = true; // the cart is as it was
    }
    this.removeAttribute('aria-busy');
    button.removeAttribute('aria-busy');
    // Not applied: nothing re-rendered, the code stays in the field to correct.
    if (!applied) input.setAttribute('aria-invalid', 'true');
    this.say(t(failed ? 'discountError' : applied ? 'discountApplied' : 'discountInvalid'), applied);
  }

  async remove(code) {
    if (this.hasAttribute('aria-busy')) return;
    this.setAttribute('aria-busy', 'true');
    let message = t('discountRemoved'), ok = true;
    try {
      await updateDiscounts(this.codes.filter((c) => c !== code));
    } catch (err) {
      message = err.message;
      ok = false;
    }
    this.removeAttribute('aria-busy');
    this.say(message, ok);
    // The chip and its button went with the re-render: the field is the next thing to work with.
    if (ok) this.current.querySelector('input')?.focus();
  }

  // Into the message region the screen reader already knows, moved into the new copy after a re-render (a
  // region inserted a moment ago is often not listened to yet). Emptied first and filled a moment later, so
  // the same message twice is announced twice.
  say(message, ok) {
    const box = this.querySelector('[data-discount-message]'), el = this.current;
    if (!box) return;
    if (el !== this) el.querySelector('[data-discount-message]')?.replaceWith(box);
    box.classList.toggle('form-message--success', ok);
    box.classList.toggle('form-message--error', !ok);
    box.textContent = '';
    setTimeout(() => (box.textContent = message), 100);
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
define('cart-discount', CartDiscount);
define('cart-count', CartCount);

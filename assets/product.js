import { routes, fetchSectionHTML, parseHTML, swapRegions, emit, on, showError, sectionIdOf, define, lockScroll, QuantityInput } from '@theme/global';
import { addItems } from '@theme/cart';

export { QuantityInput };

const busy = (btn, state) => btn && (state ? btn.setAttribute('aria-busy', 'true') : btn.removeAttribute('aria-busy'));
// "Buy now" stays busy while leaving; reset it when restored from the back/forward cache.
addEventListener('pageshow', (e) => e.persisted && document.querySelectorAll('product-form [aria-busy]').forEach((b) => busy(b, false)));

// A submit button's own data-mode wins, so one form can hold both CTAs. While the 90-day VAT consent is required
// (window.theme.cartConsent), "checkout" acts like "cart": the consent checkbox lives in the drawer / cart page.
class ProductForm extends HTMLElement {
  connectedCallback() { this.addEventListener('submit', this); }

  async handleEvent(e) {
    e.preventDefault();
    const form = e.target, btn = e.submitter || form.querySelector('[type="submit"]');
    if (btn?.hasAttribute('aria-busy')) return;
    const checkout = (btn?.dataset.mode || this.dataset.mode) === 'checkout' && !window.theme?.cartConsent;
    const data = new FormData(form), item = { id: +data.get('id'), quantity: +data.get('quantity') || 1, properties: {} };
    for (const [key, value] of data) if (key.startsWith('properties[') && value) item.properties[key.slice(11, -1)] = value;
    const box = this.querySelector('[data-form-error]');
    showError(box, '');
    busy(btn, true);
    try {
      await addItems([item], { open: !checkout, opener: btn });
      if (checkout) return location.assign(`${routes.root}checkout`);
    } catch (err) {
      showError(box, err.message);
    }
    busy(btn, false);
  }
}

class VariantPicker extends HTMLElement {
  connectedCallback() {
    try {
      this.variants = JSON.parse(this.querySelector('script[type="application/json"]').textContent);
    } catch {
      this.variants = [];
    }
    this.addEventListener('change', this);
    this.mark(this.selection());
  }

  disconnectedCallback() { this.ctrl?.abort(); }
  get names() { return [...new Set([...this.querySelectorAll('input[type="radio"], select')].map((el) => el.name))]; }
  selection() { return this.names.map((name) => this.querySelector(`[name="${CSS.escape(name)}"]:is(select, :checked)`)?.value); }
  find(options) { return this.variants.find((v) => v.options.every((value, i) => value === options[i])); }

  handleEvent(e) {
    const names = this.names, i = names.indexOf(e.target.name);
    let options = this.selection(), variant = this.find(options);
    if (!variant && i > -1) {
      // Missing combination: keep the chosen value, move the others to a variant that has it.
      const pool = this.variants.filter((v) => v.options[i] === options[i]);
      variant = pool.find((v) => v.available) || pool[0];
      if (variant) {
        options = variant.options;
        this.querySelectorAll('input[type="radio"]').forEach((r) => (r.checked = r.value === options[names.indexOf(r.name)]));
        this.querySelectorAll('select').forEach((s) => (s.value = options[names.indexOf(s.name)]));
      }
    }
    this.mark(options);
    if (variant) this.select(variant);
  }

  // Mark values leading to a missing or sold-out variant.
  mark(options) {
    const names = this.names;
    this.querySelectorAll('input[type="radio"], option').forEach((el) => {
      const i = names.indexOf((el.closest('select') || el).name);
      if (i > -1) el.toggleAttribute('data-unavailable', !this.find(options.with(i, el.value))?.available);
    });
  }

  async select(variant) {
    const sectionId = sectionIdOf(this), scope = this.closest('.shopify-section') || document.body;
    const url = `${this.dataset.url || location.pathname}?variant=${variant.id}`;
    scope.querySelectorAll('[data-swap] input[name="id"]').forEach((input) => (input.value = variant.id));
    if (this.dataset.updateUrl !== 'false') history.replaceState(history.state, '', url);
    emit('variant:changed', { variant, sectionId });
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    try {
      swapRegions(parseHTML(await fetchSectionHTML(url, sectionId, { signal: ctrl.signal })), scope);
    } catch (err) {
      if (err.name !== 'AbortError') location.assign(url); // never leave a stale price
    }
  }
}

class MediaGallery extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this);
    this.addEventListener('carousel:change', this);
    this.addEventListener('close', this, true); // close doesn't bubble
    this.off = on('variant:changed', ({ detail: { variant, sectionId } }) => {
      if (sectionId === sectionIdOf(this)) this.show(variant.featured_media?.id);
    });
  }

  disconnectedCallback() { this.off(); }
  get slider() { return this.querySelector('carousel-slider:not(dialog *, [data-thumbs] *)'); }
  get slides() { return [...(this.slider?.querySelectorAll('[data-media-id]') || [])]; }

  show(mediaId) {
    const i = this.slides.findIndex((slide) => slide.dataset.mediaId === String(mediaId));
    if (i > -1) this.slider.goTo(i, true);
  }

  handleEvent(e) {
    const dialog = this.querySelector('dialog'), el = e.target, thumb = el.closest('[data-thumb]');
    if (e.type === 'carousel:change') {
      if (el === this.slider) this.querySelectorAll('[data-thumb]').forEach((thumb, i) => thumb.setAttribute('aria-current', i === e.detail.index));
    } else if (e.type === 'close') {
      if (el !== dialog) return;
      lockScroll(false);
      this.opener?.focus();
    } else if (dialog?.open) {
      if (el === dialog || el.closest('[data-close]')) dialog.close();
    } else if (thumb) {
      this.slider?.goTo([...this.querySelectorAll('[data-thumb]')].indexOf(thumb));
    } else if (el.closest('[data-zoom]') && dialog) {
      // The lightbox is a <carousel-slider> too (arrows, RTL keys, swipe).
      this.opener = el.closest('[data-zoom]');
      dialog.showModal();
      lockScroll(true);
      const lightbox = dialog.querySelector('carousel-slider');
      lightbox?.goTo(this.slides.findIndex((slide) => slide.contains(this.opener)), true);
      lightbox?.track?.focus();
    }
  }
}

// Server-rendered for its variant: fetches only when the variant changes (a [data-swap] copy is re-rendered instead).
class PickupAvailability extends HTMLElement {
  connectedCallback() {
    this.variantId = this.dataset.variantId;
    this.off = on('variant:changed', (e) => {
      if (!this.closest('[data-swap]') && e.detail.sectionId === sectionIdOf(this)) this.load(e.detail.variant.id);
    });
  }

  disconnectedCallback() {
    this.off();
    this.ctrl?.abort();
  }

  async load(id) {
    if (!id || String(id) === this.variantId) return;
    this.variantId = String(id);
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    try {
      const doc = parseHTML(await fetchSectionHTML(`${routes.root}variants/${id}/`, 'pickup-availability', { signal: ctrl.signal }));
      const content = doc.querySelector('.shopify-section') || doc;
      this.hidden = !content.textContent.trim();
      this.replaceChildren(...content.childNodes);
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.hidden = true;
      this.replaceChildren();
    }
  }
}

define('product-form', ProductForm);
define('variant-picker', VariantPicker);
define('media-gallery', MediaGallery);
define('pickup-availability', PickupAvailability);

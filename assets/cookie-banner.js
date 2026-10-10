// Consent is saved locally only after Shopify confirms it. Clearing cookies never restores an old acceptance.
import { define, focusables, announce } from '@theme/global';

const KEY = 'joy:cookie-consent';
const KINDS = ['analytics', 'marketing', 'preferences'];
const DAY = 864e5;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const forget = () => { try { localStorage.removeItem(KEY); } catch {} };
const write = choice => { try { localStorage.setItem(KEY, JSON.stringify({ version: 2, choice, at: Date.now() })); } catch {} };

let api;
const readyApi = () => typeof window.Shopify?.customerPrivacy?.setTrackingConsent === 'function' &&
  typeof window.Shopify.customerPrivacy.currentVisitorConsent === 'function' ? window.Shopify.customerPrivacy : null;
export async function privacyApi(timeout = 5000) {
  if (readyApi()) return readyApi();
  if (!api) api = new Promise(resolve => {
    const shopify = window.Shopify;
    if (typeof shopify?.loadFeatures !== 'function') return resolve(null);
    const timer = setTimeout(() => resolve(null), timeout);
    try {
      shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], error => {
        clearTimeout(timer);
        resolve(!error && readyApi() || null);
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
  const result = await api;
  if (!result) api = null; // A blocked/late API can be retried.
  return result;
}
const consent = privacy => { try { return privacy?.currentVisitorConsent?.() || {}; } catch { return {}; } };
const hasChosen = privacy => KINDS.every(k => ['yes', 'no'].includes(consent(privacy)[k]));
export function record(privacy, granted, timeout = 7000) {
  return new Promise(resolve => {
    if (typeof privacy?.setTrackingConsent !== 'function') return resolve(false);
    const timer = setTimeout(() => resolve(false), timeout);
    // Accepting analytics/marketing is not a separate authorization to sell/share data.
    const flags = { analytics: granted, marketing: granted, preferences: granted };
    if (!granted) flags.sale_of_data = false;
    else {
      const previous = consent(privacy).sale_of_data;
      if (['yes', 'no'].includes(previous)) flags.sale_of_data = previous === 'yes';
    }
    try {
      privacy.setTrackingConsent(flags, result => {
        clearTimeout(timer);
        resolve(!result?.error && KINDS.every(k => consent(privacy)[k] === (granted ? 'yes' : 'no')));
      });
    } catch { clearTimeout(timer); resolve(false); }
  });
}
let styles;
const loadStyles = href => (styles ||= new Promise(resolve => {
  if (!href) return resolve();
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
  link.addEventListener('load', resolve, { once: true });
  link.addEventListener('error', resolve, { once: true });
  setTimeout(resolve, 4000);
  document.head.append(link);
}));
const nativeBanner = () => document.getElementById('shopify-pc__banner');
let selected;
document.addEventListener('shopify:section:select', e => { selected = e.detail.sectionId; });
document.addEventListener('shopify:section:deselect', () => { selected = null; });
class CookieBanner extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('.cookie-banner__panel');
    this.error = this.querySelector('[data-consent-error]');
    this.resize = new ResizeObserver(() => this.offset());
    ['click', 'keydown'].forEach(n => this.addEventListener(n, this));
    ['visitorConsentCollected', 'shopify:section:select', 'shopify:section:deselect'].forEach(n => document.addEventListener(n, this));
    window.addEventListener('storage', this);
    this.openPreferences = e => {
      const button = e.target.closest('[data-cookie-preferences]');
      if (!button) return;
      this.returnFocus = button;
      this.show(true);
    };
    document.addEventListener('click', this.openPreferences);
    if (window.Shopify?.designMode) {
      if (selected === this.dataset.sectionId) this.show();
      return;
    }
    this.decide();
  }
  disconnectedCallback() {
    ['click', 'keydown'].forEach(n => this.removeEventListener(n, this));
    ['visitorConsentCollected', 'shopify:section:select', 'shopify:section:deselect'].forEach(n => document.removeEventListener(n, this));
    document.removeEventListener('click', this.openPreferences);
    window.removeEventListener('storage', this);
    this.resize.disconnect();
    this.watch?.disconnect();
    this.offset(0);
  }
  handleEvent(e) {
    if (e.type === 'click') {
      const button = e.target.closest('[data-consent]');
      if (button) this.choose(button.dataset.consent);
    } else if (e.type === 'keydown' && e.key === 'Escape' && !this.hidden) {
      e.preventDefault();
      this.choose('decline');
    } else if (e.type === 'visitorConsentCollected' && !this.busy && hasChosen(window.Shopify?.customerPrivacy)) {
      this.hide();
    } else if (e.type === 'storage' && e.key === KEY) {
      if (this.stored()?.choice === 'decline') return this.revokeFromAnotherTab();
      this.decide();
    } else if (e.type === 'shopify:section:select' && e.detail.sectionId === this.dataset.sectionId) this.show();
    else if (e.type === 'shopify:section:deselect' && e.detail.sectionId === this.dataset.sectionId) this.hide();
  }
  async revokeFromAnotherTab() {
    if (this.busy) return;
    const ok = await record(await privacyApi(), false);
    if (ok) this.hide();
    else {
      await this.show();
      this.error.hidden = false;
      this.offset();
    }
  }
  stored() {
    const saved = read(), age = Date.now() - saved?.at;
    return saved?.version === 2 && ['accept', 'decline'].includes(saved.choice) &&
      Number.isFinite(saved.at) && age >= 0 && age < (Number(this.dataset.renewDays) || 365) * DAY ? saved : null;
  }
  async decide() {
    const privacy = await privacyApi();
    if (!this.isConnected) return;
    const previous = read(), saved = this.stored();
    if (saved?.choice === 'decline') {
      if (KINDS.every(k => consent(privacy)[k] === 'no') && consent(privacy).sale_of_data === 'no') return this.hide();
      if (await record(privacy, false)) return this.hide();
      await this.show();
      this.error.hidden = false;
      this.offset();
      return;
    }
    if (saved && hasChosen(privacy)) return this.hide();
    // An old/missing Shopify acceptance must be given again, never replayed from localStorage.
    if (read()) forget();
    if (!previous && hasChosen(privacy)) return this.hide();
    if (this.dataset.audience === 'required' && privacy && !privacy.shouldShowBanner?.()) return;
    if (nativeBanner()) return;
    this.watch = new MutationObserver(() => nativeBanner() && this.hide());
    this.watch.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => this.watch?.disconnect(), 15000);
    this.show();
  }
  async show(focus = false) {
    await loadStyles(this.dataset.stylesheet);
    if (!this.isConnected) return;
    this.hidden = false;
    this.error.hidden = true;
    this.resize.observe(this.panel);
    this.offset();
    if (focus) this.querySelector('[data-consent="decline"]')?.focus();
  }
  hide() {
    this.hidden = true;
    this.resize.disconnect();
    this.watch?.disconnect();
    this.offset(0);
  }
  offset(height = this.hidden ? 0 : Math.ceil(this.panel.getBoundingClientRect().height)) {
    const body = document.body.style, root = document.documentElement.style;
    if (height > 0) {
      const bottom = parseFloat(getComputedStyle(this.panel).bottom) || 0;
      body.setProperty('--cookie-offset', `calc(${height}px + 0.625rem)`);
      root.setProperty('scroll-padding-block-end', `${Math.ceil(height + bottom) + 8}px`);
    } else {
      body.removeProperty('--cookie-offset');
      root.removeProperty('scroll-padding-block-end');
    }
  }
  async choose(choice) {
    if (this.busy || !['accept', 'decline'].includes(choice)) return;
    if (window.Shopify?.designMode) return this.hide();
    this.busy = true;
    this.error.hidden = true;
    this.panel.setAttribute('aria-busy', 'true');
    this.querySelectorAll('[data-consent]').forEach(b => { b.disabled = true; });
    const ok = await record(await privacyApi(), choice === 'accept');
    this.busy = false;
    this.panel.removeAttribute('aria-busy');
    this.querySelectorAll('[data-consent]').forEach(b => { b.disabled = false; });
    if (!this.isConnected) return;
    if (!ok) {
      this.error.hidden = false;
      this.offset();
      return;
    }
    write(choice);
    const keyboard = this.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    this.hide();
    announce(this.dataset.saved);
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    else if (keyboard) focusables(document.body).find(el => this.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)?.focus();
  }
}
define('cookie-banner', CookieBanner);

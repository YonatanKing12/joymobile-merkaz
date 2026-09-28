// <cookie-banner> — sections/cookie-banner.liquid. Shows the cookie notice to visitors who have not chosen yet and
// records their choice with Shopify's Customer Privacy API, which Shopify analytics and app pixels honour.
// localStorage keeps the choice too, so the banner never flashes for a returning visitor, and a choice whose Shopify
// cookie is gone is applied again. ✕ / Escape hide the banner for the current browsing session only.
// While the banner is shown, the floating buttons (--floating-offset-bottom) and the page's scroll-padding move up
// above it, so a focused control is never hidden under the banner (WCAG 2.4.11).
import { define, focusables, announce } from '@theme/global';

const KEY = 'joy:cookie-consent'; // {choice: 'accept' | 'decline', at: epoch ms}
const DISMISSED = 'joy:cookie-dismissed'; // sessionStorage
const SYNCED = 'joy:cookie-synced'; // sessionStorage: stored choice already checked against Shopify this session
const DAY = 864e5;
const KINDS = ['analytics', 'marketing', 'preferences', 'sale_of_data'];

const read = (store, key) => {
  try {
    return JSON.parse(window[store].getItem(key));
  } catch {
    return null;
  }
};
const write = (store, key, value) => {
  try {
    window[store].setItem(key, JSON.stringify(value));
  } catch {}
};

// Shopify's Customer Privacy API, loaded on demand. Resolves null when it is not available (outside Shopify, blocked,
// or too slow), so the banner still works as a plain notice.
let api;
export function privacyApi(timeout = 5000) {
  api ||= new Promise((resolve) => {
    const shopify = window.Shopify;
    if (shopify?.customerPrivacy) return resolve(shopify.customerPrivacy);
    if (typeof shopify?.loadFeatures !== 'function') return resolve(null);
    const timer = setTimeout(() => resolve(null), timeout);
    try {
      shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], (error) => {
        clearTimeout(timer);
        resolve((!error && window.Shopify.customerPrivacy) || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  return api;
}

// '' = not asked yet, 'yes' / 'no' = chosen (through this banner, Shopify's own banner or another tab).
const hasChosen = (privacy) => {
  try {
    const consent = privacy?.currentVisitorConsent?.() || {};
    return KINDS.some((k) => consent[k] === 'yes' || consent[k] === 'no');
  } catch {
    return false;
  }
};

const record = (privacy, granted) =>
  new Promise((resolve) => {
    if (typeof privacy?.setTrackingConsent !== 'function') return resolve(false);
    try {
      privacy.setTrackingConsent(Object.fromEntries(KINDS.map((k) => [k, granted])), (result) => resolve(!result?.error));
    } catch {
      resolve(false);
    }
  });

let styles;
const loadStyles = (href) =>
  (styles ||= new Promise((resolve) => {
    if (!href) return resolve();
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 4000);
    document.head.append(link);
  }));

// Theme editor: which section is selected, so a banner re-rendered while selected stays open.
let selected = null;
document.addEventListener('shopify:section:select', (e) => (selected = e.detail.sectionId));
document.addEventListener('shopify:section:deselect', () => (selected = null));

const shopifyBannerShown = () => !!document.getElementById('shopify-pc__banner');

class CookieBanner extends HTMLElement {
  connectedCallback() {
    this.panel = this.querySelector('.cookie-banner__panel');
    this.resize = new ResizeObserver(() => this.offset());
    this.addEventListener('click', this);
    this.addEventListener('keydown', this);
    document.addEventListener('visitorConsentCollected', this);
    if (window.Shopify?.designMode) {
      document.addEventListener('shopify:section:select', this);
      document.addEventListener('shopify:section:deselect', this);
      if (selected === this.dataset.sectionId) this.show();
      return;
    }
    const stored = this.stored();
    if (stored) return this.sync(stored);
    if (!read('sessionStorage', DISMISSED)) this.decide();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this);
    this.removeEventListener('keydown', this);
    ['visitorConsentCollected', 'shopify:section:select', 'shopify:section:deselect'].forEach((name) => document.removeEventListener(name, this));
    this.resize.disconnect();
    this.watch?.disconnect();
    this.offset(0);
  }

  handleEvent(e) {
    switch (e.type) {
      case 'click': {
        const button = e.target.closest('[data-consent]');
        if (button) this.choose(button.dataset.consent);
        break;
      }
      case 'keydown':
        if (e.key === 'Escape' && !this.hidden) this.choose('dismiss');
        break;
      case 'visitorConsentCollected': // chosen elsewhere: Shopify's banner, or this one in another tab
        if (!window.Shopify?.designMode) this.hide();
        break;
      case 'shopify:section:select':
        if (e.detail.sectionId === this.dataset.sectionId) this.show();
        break;
      case 'shopify:section:deselect':
        if (e.detail.sectionId === this.dataset.sectionId) this.hide();
    }
  }

  stored() {
    const saved = read('localStorage', KEY);
    const days = Number(this.dataset.renewDays) || 365;
    return saved && ['accept', 'decline'].includes(saved.choice) && Date.now() - saved.at < days * DAY ? saved : null;
  }

  async decide() {
    const privacy = await privacyApi();
    if (!this.isConnected || hasChosen(privacy)) return;
    if (this.dataset.audience === 'required' && !privacy?.shouldShowBanner?.()) return;
    if (shopifyBannerShown()) return;
    // Shopify's own banner may still be on its way: stand down if it appears.
    this.watch = new MutationObserver(() => shopifyBannerShown() && this.hide());
    this.watch.observe(document.body, { childList: true });
    setTimeout(() => this.watch?.disconnect(), 15000);
    this.show();
  }

  // A choice stored here whose Shopify consent cookie is gone (cleared or expired) is applied again, once a session,
  // when the browser is idle.
  sync(stored) {
    if (read('sessionStorage', SYNCED)) return;
    write('sessionStorage', SYNCED, true);
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 2000)))(async () => {
      const privacy = await privacyApi();
      if (privacy && !hasChosen(privacy)) record(privacy, stored.choice === 'accept');
    });
  }

  async show() {
    await loadStyles(this.dataset.stylesheet);
    if (!this.isConnected || !this.hidden) return;
    this.hidden = false;
    this.resize.observe(this.panel);
    this.offset();
  }

  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this.resize.disconnect();
    this.watch?.disconnect();
    this.offset(0);
  }

  // Lift the floating buttons and the scroll-padding by the banner's height while it is on screen.
  offset(height = this.hidden ? 0 : Math.ceil(this.panel.getBoundingClientRect().height)) {
    const body = document.body.style, root = document.documentElement.style;
    if (height > 0) {
      body.setProperty('--floating-offset-bottom', `${height}px`);
      root.setProperty('scroll-padding-block-end', `${height + 8}px`);
    } else {
      body.removeProperty('--floating-offset-bottom');
      root.removeProperty('scroll-padding-block-end');
    }
  }

  async choose(choice) {
    // After a keyboard choice, focus moves on to what follows the banner (the header), not back to <body>.
    const keyboard = this.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    this.hide();
    if (keyboard) focusables(document.body).find((el) => this.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)?.focus();
    if (window.Shopify?.designMode) return;
    if (choice === 'dismiss') return write('sessionStorage', DISMISSED, true);
    write('localStorage', KEY, { choice, at: Date.now() });
    announce(this.dataset.saved);
    record(await privacyApi(), choice === 'accept');
  }
}

define('cookie-banner', CookieBanner);

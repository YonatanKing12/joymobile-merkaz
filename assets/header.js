import { define, trapFocus, releaseFocus, lockScroll, focusables, onEscape } from '@theme/global';

const summaryOf = (details) => details.querySelector(':scope > summary');

// Publishes --header-height (scroll-padding-top, sticky offsets) whatever the scroll position: the compact state only
// adds a shadow, so the height is the same — and a page restored mid-scroll must get it too.
// Also --header-offset: how far down the header starts, i.e. how much of the announcement strip above it is still on
// screen. The strip scrolls away pixel by pixel, so the menu drawer and its levels follow the live value.
class StickyHeader extends HTMLElement {
  connectedCallback() {
    addEventListener('scroll', this, { passive: true });
    addEventListener('resize', this, { passive: true }); // the strip is taller from 768px
    const measure = () => document.documentElement.style.setProperty('--header-height', `${(this.height = this.offsetHeight)}px`);
    (this.ro = new ResizeObserver(measure)).observe(this);
    measure();
    this.handleEvent();
  }

  disconnectedCallback() {
    removeEventListener('scroll', this);
    removeEventListener('resize', this);
    this.ro.disconnect();
  }

  handleEvent() {
    this.raf ||= requestAnimationFrame(() => {
      this.raf = 0;
      const compact = scrollY > (+this.dataset.threshold || this.height);
      if (compact !== !!this.compact) this.classList.toggle('is-compact', (this.compact = compact));
      const offset = Math.max(0, Math.round(this.getBoundingClientRect().top));
      if (offset !== this.offset) this.style.setProperty('--header-offset', `${(this.offset = offset)}px`);
    });
  }
}

class HeaderMenu extends HTMLElement {
  connectedCallback() {
    this.items = [...this.querySelectorAll('details')].filter((d) => !d.parentElement.closest('details'));
    this.items.forEach((d) => ['pointerenter', 'pointerleave', 'toggle'].forEach((type) => d.addEventListener(type, this)));
    ['pointerdown', 'click', 'focusout'].forEach((type) => this.addEventListener(type, this));
    document.addEventListener('click', this);
    this.offEscape = onEscape(this, () => {
      const open = this.items.find((d) => d.open);
      if (!open) return false;
      open.open = false;
      summaryOf(open).focus();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('click', this);
    this.offEscape();
    clearTimeout(this.timer);
  }

  handleEvent(e) {
    const d = e.currentTarget, { type } = e;
    if (type === 'pointerdown') this.pointer = e.pointerType;
    else if (type === 'toggle') {
      summaryOf(d)?.setAttribute('aria-expanded', d.open);
      if (d.open) this.items.forEach((other) => other !== d && (other.open = false));
      else if (this.hovered === d) this.hovered = null;
    } else if (type === 'focusout') {
      if (e.relatedTarget) this.items.forEach((item) => !item.contains(e.relatedTarget) && (item.open = false));
    } else if (type === 'click') {
      if (d === document) return this.contains(e.target) || this.items.forEach((item) => (item.open = false));
      // Don't let a click shut what hover just opened.
      const summary = e.target.closest('summary');
      if (summary && this.pointer === 'mouse' && this.hovered === summary.parentElement) e.preventDefault();
    } else if (e.pointerType === 'mouse') {
      const open = type === 'pointerenter';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (open && !d.open) this.hovered = d;
        d.open = open;
      }, 150);
    }
  }
}

class MenuDrawer extends HTMLElement {
  connectedCallback() {
    this.details = this.querySelector('details');
    if (!this.details) return;
    this.addEventListener('toggle', this, true); // capture: toggle doesn't bubble
    this.addEventListener('click', this);
    this.offEscape = onEscape(this, (e) => {
      if (!this.details.open) return false;
      this.shut(e.target.closest('details[open]') || this.details);
    });
    this.mq = matchMedia('(min-width: 992px)');
    this.mq.addEventListener('change', this);
  }

  disconnectedCallback() {
    this.offEscape?.();
    this.mq?.removeEventListener('change', this);
    if (this.details?.open) this.close();
  }

  close() { this.shut(this.details); }

  // Closes a level and moves focus now (the toggle event is async; meanwhile focus would sit on a hidden control).
  shut(d) {
    d.open = false;
    this.onToggle(d);
  }

  handleEvent(e) {
    const el = e.target;
    if (e.type === 'toggle') this.onToggle(el);
    else if (e.type === 'change') this.mq.matches && this.close();
    else if (el.closest('[data-back]')) this.shut(el.closest('details'));
    else if (el.closest('[data-close]')) this.close();
  }

  // Idempotent: also called before the async toggle event.
  onToggle(d) {
    const summary = summaryOf(d), panel = summary?.nextElementSibling, root = d === this.details;
    if (!panel || d.open === !!d.trapped) return;
    d.trapped = d.open;
    summary.setAttribute('aria-expanded', d.open);
    if (root) lockScroll(d.open);
    if (d.open) return trapFocus(root ? d : panel, focusables(panel)[0]);
    if (root) {
      d.querySelectorAll('details[open]').forEach((level) => {
        level.open = false;
        this.onToggle(level);
      });
    }
    releaseFocus(root || this.details.open ? summary : null, root ? d : panel);
  }
}

define('sticky-header', StickyHeader);
define('header-menu', HeaderMenu);
define('menu-drawer', MenuDrawer);

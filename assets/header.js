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

// Inside a panel (snippets/mega-menu-panel): a group's links past the limit wait behind its "עוד N" button
// (.is-collapsed hides .mega-menu__extra), and a tabbed panel shows one group at a time. Both start in their
// no-JS form (every link visible, every pane open) until this element is connected.
class HeaderMenu extends HTMLElement {
  connectedCallback() {
    this.items = [...this.querySelectorAll('details')].filter((d) => !d.parentElement.closest('details'));
    this.items.forEach((d) => ['pointerenter', 'pointerleave', 'toggle'].forEach((type) => d.addEventListener(type, this)));
    ['pointerdown', 'click', 'focusout', 'pointerover', 'keydown'].forEach((type) => this.addEventListener(type, this));
    this.querySelectorAll('.mega-menu__more').forEach((button) => {
      button.closest('.mega-menu__group').classList.add('is-collapsed');
      button.hidden = false;
    });
    this.querySelectorAll('[data-mega-tabs]').forEach((tabs) => tabs.classList.add('is-ready'));
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
    clearTimeout(this.tabTimer);
  }

  // The featured tile's image is lazy, so closed panels cost nothing; the pointer resting on an item (or the panel
  // opening from the keyboard) starts its download, during the 150ms hover intent.
  warm(d) {
    d.querySelectorAll('img[loading="lazy"]').forEach((img) => (img.loading = 'eager'));
  }

  // "עוד N" / "פחות": the hidden links of the group show in place, under the visible ones.
  toggleMore(button) {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open);
    button.closest('.mega-menu__group').classList.toggle('is-collapsed', !open);
  }

  // A tab is a disclosure button for its pane; exactly one is expanded per panel.
  selectTab(tab) {
    tab.closest('[data-mega-tabs]').querySelectorAll('.mega-menu__tab[aria-controls]').forEach((other) => {
      const on = other === tab;
      other.setAttribute('aria-expanded', on);
      document.getElementById(other.getAttribute('aria-controls'))?.classList.toggle('is-active', on);
    });
  }

  // Up/Down (and Home/End) walk the rail, which is a vertical list; Tab leaves it for the open pane.
  onTabKey(e, tab) {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 };
    if (!(e.key in keys)) return;
    const tabs = [...tab.closest('[data-mega-tabs]').querySelectorAll('.mega-menu__tab')];
    const i = tabs.indexOf(tab);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(i + keys[e.key] + tabs.length) % tabs.length];
    e.preventDefault();
    next.focus();
    if (next.matches('[aria-controls]')) this.selectTab(next);
  }

  handleEvent(e) {
    const d = e.currentTarget, { type } = e;
    if (type === 'pointerover' || type === 'keydown') {
      const tab = e.target.closest?.('.mega-menu__tab');
      if (type === 'keydown') return tab && this.onTabKey(e, tab);
      clearTimeout(this.tabTimer);
      // Hover intent on a tab (mouse only): a pointer crossing the rail on its way to the pane does not switch.
      if (tab?.matches('[aria-controls]') && e.pointerType === 'mouse') this.tabTimer = setTimeout(() => this.selectTab(tab), 120);
      return;
    }
    if (type === 'pointerdown') this.pointer = e.pointerType;
    else if (type === 'toggle') {
      summaryOf(d)?.setAttribute('aria-expanded', d.open);
      if (d.open) this.warm(d);
      if (d.open) this.items.forEach((other) => other !== d && (other.open = false));
      else if (this.hovered === d) this.hovered = null;
    } else if (type === 'focusout') {
      if (e.relatedTarget) this.items.forEach((item) => !item.contains(e.relatedTarget) && (item.open = false));
    } else if (type === 'click') {
      if (d === document) return this.contains(e.target) || this.items.forEach((item) => (item.open = false));
      const control = e.target.closest('.mega-menu__more, .mega-menu__tab[aria-controls]');
      if (control) return control.matches('.mega-menu__more') ? this.toggleMore(control) : this.selectTab(control);
      // Don't let a click shut what hover just opened.
      const summary = e.target.closest('summary');
      if (summary && this.pointer === 'mouse' && this.hovered === summary.parentElement) e.preventDefault();
    } else if (e.pointerType === 'mouse') {
      const open = type === 'pointerenter';
      if (open) this.warm(d);
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
      this.shut(e.target.closest('details[open]:not(.menu-drawer__acc)') || this.details);
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
    if (e.type === 'toggle') {
      // A group accordion inside a level (snippets/menu-drawer) only reports its state; it is not a level.
      if (el.matches('.menu-drawer__acc')) summaryOf(el)?.setAttribute('aria-expanded', el.open);
      else this.onToggle(el);
    }
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
    if (root) {
      lockScroll(d.open);
      this.dialog(d.open);
    }
    if (d.open) return trapFocus(root ? d : panel, focusables(panel)[0]);
    if (root) {
      d.querySelectorAll('details[open]:not(.menu-drawer__acc)').forEach((level) => {
        level.open = false;
        this.onToggle(level);
      });
    }
    releaseFocus(root || this.details.open ? summary : null, root ? d : panel);
  }

  // While open, also modal for screen readers (a VoiceOver/TalkBack swipe would otherwise leave the menu for the page
  // behind it), as facets.js does for the filter drawer. The dialog is this element, not the panel: the summary (✕)
  // that closes it sits outside the panel and must stay reachable.
  dialog(open) {
    if (!open) return ['role', 'aria-modal', 'aria-label'].forEach((name) => this.removeAttribute(name));
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    this.setAttribute('aria-label', this.dataset.dialogLabel || summaryOf(this.details).getAttribute('aria-label') || '');
  }
}

define('sticky-header', StickyHeader);
define('header-menu', HeaderMenu);
define('menu-drawer', MenuDrawer);

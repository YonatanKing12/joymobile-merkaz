// Slides per view come from CSS (--per-view); JS only reads geometry and scrolls.
import { define, prefersReducedMotion, t } from '@theme/global';

const DOC_EVENTS = ['visibilitychange', 'shopify:block:select', 'shopify:block:deselect'];

class CarouselSlider extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('.carousel__track');
    if (!this.track) return;
    this.prev = this.querySelector('.carousel__btn--prev');
    this.next = this.querySelector('.carousel__btn--next');
    this.dots = this.querySelector('.carousel__dots');
    this.delay = +this.dataset.autoplay || 0;
    Object.assign(this, { index: 0, offsets: [0], perView: 1, pages: 1 });
    ['click', 'keydown', 'pointerenter', 'pointerleave', 'focusin', 'focusout'].forEach((type) => this.addEventListener(type, this));
    this.track.addEventListener('scroll', this, { passive: true });
    DOC_EVENTS.forEach((type) => document.addEventListener(type, this));
    (this.ro = new ResizeObserver(() => this.measure())).observe(this.track);
    if (this.delay) {
      this.io = new IntersectionObserver(([entry]) => {
        this.inView = entry.isIntersecting;
        this.play();
      }, { threshold: 0.5 });
      this.io.observe(this);
    }
  }

  disconnectedCallback() {
    DOC_EVENTS.forEach((type) => document.removeEventListener(type, this));
    this.ro?.disconnect();
    this.io?.disconnect();
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get slides() { return [...this.track.children]; }
  get x() { return Math.abs(this.track.scrollLeft); } // RTL scrollLeft runs 0 → negative
  get max() { return this.track.scrollWidth - this.track.clientWidth; }
  get loop() { return this.dataset.loop === 'true'; }

  measure() {
    const { track } = this, box = track.getBoundingClientRect(), x = this.x;
    this.rtl = getComputedStyle(track).direction === 'rtl';
    const starts = this.slides.map((slide) => {
      const r = slide.getBoundingClientRect();
      return (this.rtl ? box.right - r.right : r.left - box.left) + x;
    });
    this.offsets = starts.map((s) => s - starts[0]);
    this.width = track.clientWidth;
    this.perView = Math.max(1, Math.round(this.width / (this.offsets[1] || this.width || 1)));
    this.pages = Math.max(1, Math.ceil((starts.length - this.perView) / this.perView) + 1);
    if (this.dots && this.dotCount !== this.pages) {
      this.dotCount = this.pages;
      this.dots.replaceChildren(...Array.from({ length: this.pages }, (_, i) => {
        const dot = Object.assign(document.createElement('button'), { type: 'button', className: 'carousel__dot' });
        dot.dataset.page = i;
        dot.setAttribute('aria-label', t('slide', { n: i + 1, total: this.pages }));
        return dot;
      }));
      this.dots.hidden = this.pages < 2;
    }
    this.update();
  }

  update() {
    const x = this.x, max = this.max;
    let index = 0;
    this.offsets.forEach((o, i) => Math.abs(o - x) < Math.abs(this.offsets[index] - x) && (index = i));
    const page = x > max - 2 ? this.pages - 1 : Math.min(this.pages - 1, Math.round(index / this.perView));
    this.toggleAttribute('data-scrollable', max > 2); // CSS hook; same 2px tolerance as the ends
    this.prev?.setAttribute('aria-disabled', !this.loop && x < 2);
    this.next?.setAttribute('aria-disabled', !this.loop && x > max - 2);
    [...(this.dots?.children || [])].forEach((dot, i) => dot.setAttribute('aria-current', i === page));
    if (index === this.index && page === this.page) return;
    Object.assign(this, { index, page });
    this.dispatchEvent(new CustomEvent('carousel:change', { bubbles: true, detail: { index, page } }));
  }

  goTo(i, instant) {
    if (this.track.clientWidth !== this.width) this.measure(); // was measured while hidden
    this.target = Math.max(0, Math.min(i, this.offsets.length - 1));
    this.movedAt = performance.now();
    const left = this.offsets[this.target] * (this.rtl ? -1 : 1);
    this.track.scrollTo({ left, behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // dir 1 = next = toward inline-end (leftwards in RTL)
  step(dir, wrap = this.loop) {
    const end = this.x > this.max - 2;
    if (dir > 0 && end) return wrap && this.goTo(0);
    if (dir < 0 && this.x < 2) return wrap && this.goTo(this.offsets.length - 1);
    // From a running smooth scroll's target; the clamped end counts as the last page.
    let from = performance.now() - this.movedAt < 600 ? this.target : this.index;
    if (end) from = Math.max(from, (this.pages - 1) * this.perView);
    this.goTo(from + dir * this.perView);
  }

  play() {
    clearTimeout(this.timer);
    if (!this.delay || this.paused || this.hover || this.focused || this.editing || !this.inView || document.hidden || prefersReducedMotion()) return;
    this.timer = setTimeout(() => this.step(1, true), this.delay); // the scroll re-arms it
  }

  handleEvent(e) {
    const { type, target } = e;
    if (type === 'scroll') {
      this.raf ||= requestAnimationFrame(() => {
        this.raf = 0;
        this.update();
      });
    } else if (type === 'click') this.onClick(target.closest('button'));
    else if (type === 'keydown') this.onKey(e);
    else if (type.startsWith('pointer')) this.hover = type === 'pointerenter';
    else if (type.startsWith('focus')) this.focused = this.contains(type === 'focusin' ? target : e.relatedTarget);
    else if (type.startsWith('shopify')) {
      if (!this.contains(target)) return;
      this.editing = type.endsWith(':select');
      if (this.editing) this.goTo(this.slides.findIndex((slide) => slide.contains(target)), true);
    }
    this.play();
  }

  onClick(btn) {
    if (!btn || btn.closest('carousel-slider') !== this) return;
    if (btn === this.prev || btn === this.next) this.step(btn === this.next ? 1 : -1);
    else if (btn.parentElement === this.dots) this.goTo(btn.dataset.page * this.perView);
    else if (btn.matches('.carousel__pause')) btn.setAttribute('aria-pressed', (this.paused = !this.paused));
  }

  onKey(e) {
    const { key, target } = e;
    if (e.defaultPrevented || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return;
    if (target !== this.track && !target.closest('.carousel__btn, .carousel__dots')) return;
    e.preventDefault();
    this.step((key === 'ArrowLeft') === this.rtl ? 1 : -1);
  }
}

define('carousel-slider', CarouselSlider);

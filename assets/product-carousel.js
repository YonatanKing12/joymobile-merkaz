/* Homepage product strips (sections/product-carousel) print only their first five cards; the page would
 * otherwise carry 50 cards that a phone shows two of per strip. When a strip comes within half a screen
 * of the viewport, this fetches the same section through the Section Rendering API, where Liquid renders
 * every card, and appends the cards the page does not have yet (matched by product id, so a product that
 * sold out or came back in between is neither doubled nor skipped). The request goes out at low priority:
 * it must never compete with the hero image. Without JavaScript the strip keeps its first cards and the
 * "view all" link; if the request fails it simply stays as it is.
 */
import { define, fetchSectionHTML, parseHTML } from '@theme/global';

class ProductCarousel extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute('data-more')) return;
    this.io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) this.load();
    }, { rootMargin: '50% 0px' });
    this.io.observe(this);
  }

  disconnectedCallback() {
    this.io?.disconnect();
    this.controller?.abort();
  }

  async load() {
    this.io.disconnect();
    this.controller = new AbortController();
    const track = this.querySelector('.product-carousel__track');
    try {
      const markup = await fetchSectionHTML(window.location.pathname, this.dataset.sectionId, {
        signal: this.controller.signal,
        priority: 'low',
      });
      const have = new Set([...track.children].map((slide) => slide.dataset.productId));
      const slides = [...parseHTML(markup).querySelectorAll('.product-carousel__track > [data-product-id]')]
        .filter((slide) => !have.has(slide.dataset.productId));
      if (!this.isConnected || !slides.length) return;
      track.append(...slides);
      this.removeAttribute('data-more');
      // The track keeps its size, so the carousel's ResizeObserver does not fire: re-read the slide offsets.
      this.querySelector('carousel-slider')?.measure?.();
    } catch {
      // Aborted (the section left the page) or failed: the strip keeps the cards it has.
    }
  }
}

define('product-carousel', ProductCarousel);

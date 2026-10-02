/* Homepage product strips (sections/product-carousel) print only their first five cards; the page would
 * otherwise carry 50 cards that a phone shows two of per strip. When a strip comes within half a screen
 * of the viewport, this fetches the same section through the Section Rendering API, where Liquid renders
 * every card, and appends the cards the page does not have yet (matched by product id, so a product that
 * sold out or came back in between is neither doubled nor skipped). The request goes out at low priority:
 * it must never compete with the hero image. Without JavaScript the strip keeps its first cards and the
 * "view all" link. A failed request (a 429 under load, say) is retried twice with a growing wait, each time
 * only once the strip is near the viewport again; after that the strip keeps its first cards, and its
 * arrows hide (assets/section-product-carousel.css) because the track has nothing to scroll to.
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
    clearTimeout(this.retry);
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
    } catch (error) {
      // Aborted: the section left the page. Failed: try again later, at most twice.
      if (error.name === 'AbortError' || !this.isConnected) return;
      this.tries = (this.tries || 0) + 1;
      if (this.tries < 3) {
        const wait = (error.status === 429 ? 5000 : 2000) * this.tries;
        this.retry = setTimeout(() => this.isConnected && this.io.observe(this), wait);
      } else {
        this.removeAttribute('data-more');
      }
    }
  }
}

define('product-carousel', ProductCarousel);

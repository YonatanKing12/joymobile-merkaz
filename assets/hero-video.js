/* Hero slide video (sections/hero-slideshow).
 *
 * The video sits over the slide's image, which stays the poster and the LCP. Nothing is fetched
 * until all four of these hold: the slide is the active one, the carousel is near the viewport, the
 * viewport is one the owner enabled the video for, and the visitor has not asked for less motion.
 * So a hero nobody scrolls to, a phone where video is switched off, and a visitor who prefers
 * reduced motion each cost zero bytes, and each still sees a finished banner.
 */
import { prefersReducedMotion } from '@theme/global';

const DESKTOP = matchMedia('(min-width: 768px)');

/* The file for this viewport, or nothing when the owner left video off for it. */
function sourceFor(video) {
  if (prefersReducedMotion()) return '';
  return (DESKTOP.matches ? video.dataset.heroSrcDesktop : video.dataset.heroSrcMobile) || '';
}

function play(video) {
  const src = sourceFor(video);
  if (!src) return stop(video);
  // Assigning src is what starts the download, so it happens here and not a moment earlier.
  if (video.getAttribute('src') !== src) {
    video.setAttribute('src', src);
    video.load();
  }
  // play() rejects on its own when the browser refuses (a battery saver, a tab policy). The image
  // is already on screen, so there is nothing to fall back to and nothing to report.
  video.play().then(() => video.classList.add('is-playing')).catch(() => {});
}

function stop(video) {
  video.classList.remove('is-playing');
  if (!video.paused) video.pause();
}

function setup(carousel) {
  const videos = [...carousel.querySelectorAll('[data-hero-video]')];
  if (!videos.length) return;
  const slides = [...carousel.querySelectorAll('.carousel__slide')];
  let inView = false;

  const sync = () => {
    const active = slides[carousel.index ?? 0];
    videos.forEach((video) => (inView && active && active.contains(video) ? play(video) : stop(video)));
  };

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }, { rootMargin: '200px' }).observe(carousel);

  carousel.addEventListener('carousel:change', sync);
  document.addEventListener('visibilitychange', () => (document.hidden ? videos.forEach(stop) : sync()));
  DESKTOP.addEventListener('change', sync);
}

const setupAll = (root = document) => root.querySelectorAll('.hero-slideshow__carousel').forEach(setup);
setupAll();
// The theme editor re-renders the whole section on every change, and this module does not run again
// with it. Setting a video up is exactly what the owner will be doing in the editor.
document.addEventListener('shopify:section:load', (e) => setupAll(e.target));

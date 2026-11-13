/**
 * The status bar at the bottom of the canvas. Every part of the app reports messages
 * through `show()`; this layer decides when the bar is visible:
 *
 *  - a new message slides it up quickly and (re)starts a countdown;
 *  - after `hideAfterMs` (5 s) with no new message, and with the pointer neither on the
 *    bar nor near where it sits, it slides slowly down out of view;
 *  - moving the pointer near the bottom edge where it hides (or tapping there) slides
 *    it back up quickly; while the pointer stays on or near it, it stays up, and the
 *    countdown restarts when the pointer leaves.
 *
 * The slide itself is CSS (`.message` / `.message.is-hidden`): quick when revealing, slow
 * when hiding, and instant with prefers-reduced-motion.
 *
 * A new message never snaps the bar to its new size: its width and height animate from
 * the old size to the new one while the new text fades in (see `resizeSmoothly`).
 */
export type Tone = 'info' | 'warn';

export interface StatusBarOptions {
  /** Idle time before the bar hides. */
  hideAfterMs: number;
  /** How close (px) to the area's bottom edge the pointer must come to reveal the bar. */
  revealDistance: number;
  /** Extra horizontal room (px) on each side of the bar that also counts as "near". */
  revealSlack: number;
}

const DEFAULTS: StatusBarOptions = { hideAfterMs: 5000, revealDistance: 64, revealSlack: 48 };

/** Duration and easing of the size change when a new message arrives. */
const RESIZE_MS = 260;
const RESIZE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export class StatusBar {
  private readonly options: StatusBarOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;
  private near = false;
  /** The text lives in its own element so it can be faded and held at its final width. */
  private readonly text: HTMLElement;
  /** The running size and fade animations (not the CSS slide, which must not be cut short). */
  private resizing: Animation | null = null;
  private fading: Animation | null = null;

  constructor(
    private readonly bar: HTMLElement,
    /** The area the bar sits at the bottom of (the canvas area). */
    private readonly area: HTMLElement,
    options: Partial<StatusBarOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.text = document.createElement('span');
    this.text.className = 'message-text';
    this.text.textContent = bar.textContent?.trim() ?? '';
    bar.replaceChildren(this.text);
    bar.addEventListener('pointerenter', () => {
      this.hovered = true;
      this.reveal();
    });
    bar.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.restartCountdown();
    });
    area.addEventListener('pointermove', this.onPointer);
    area.addEventListener('pointerdown', this.onPointer);
    area.addEventListener('pointerleave', () => this.setNear(false));
  }

  /** Displays a message (replacing the previous one) and brings the bar into view. */
  show(text: string, tone: Tone = 'info'): void {
    // Only animate the size while the bar is on screen; a hidden bar slides in at its new size.
    const animate = this.visible && canAnimate() && !prefersReducedMotion();
    const before = animate ? this.bar.getBoundingClientRect() : null;

    // A newer message continues from the current (possibly mid-animation) size.
    this.resizing?.cancel();
    this.fading?.cancel();
    this.resizing = this.fading = null;
    this.releaseText();
    this.text.textContent = text;
    this.bar.dataset.tone = tone;
    if (before) this.resizeSmoothly(before);

    this.reveal();
    this.restartCountdown();
  }

  /**
   * Animates the bar from its previous size to the one the new text needs, fading the
   * text in. From the first frame the text is laid out exactly as it will be at the end
   * (same width, same line breaks); while the bar is still smaller, it clips whatever
   * doesn't fit yet (`overflow: hidden`), keeping the text centred.
   */
  private resizeSmoothly(before: DOMRect): void {
    const after = this.bar.getBoundingClientRect();
    const timing = { duration: RESIZE_MS, easing: RESIZE_EASING };
    this.fading = this.text.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    if (Math.abs(after.width - before.width) < 0.5 && Math.abs(after.height - before.height) < 0.5) return;

    // Pin the text to its final layout. Lift the `max-width: 100%` cap too: it would
    // otherwise squeeze the text to the bar's *animating* width and make it wrap. Round up,
    // as an exact fractional width can itself push the last word onto a new line.
    this.text.style.width = `${Math.ceil(this.text.getBoundingClientRect().width)}px`;
    this.text.style.maxWidth = 'none';
    const resizing = this.bar.animate(
      [
        { width: `${before.width}px`, height: `${before.height}px` },
        { width: `${after.width}px`, height: `${after.height}px` },
      ],
      timing,
    );
    this.resizing = resizing;
    resizing.finished.then(
      () => {
        if (this.resizing === resizing) this.releaseText();
      },
      () => {}, // cancelled by a newer message, which resets the width itself
    );
  }

  /** Lets the text follow the bar's size again (normal wrapping on narrow screens). */
  private releaseText(): void {
    this.text.style.width = '';
    this.text.style.maxWidth = '';
  }

  /** Whether the bar is currently shown (or sliding into view). */
  get visible(): boolean {
    return !this.bar.classList.contains('is-hidden');
  }

  private reveal(): void {
    this.bar.classList.remove('is-hidden');
  }

  private restartCountdown(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Still being looked at: wait for the pointer to leave (which restarts the countdown).
      if (this.hovered || this.near) return;
      this.bar.classList.add('is-hidden');
    }, this.options.hideAfterMs);
  }

  private onPointer = (e: PointerEvent): void => {
    this.setNear(this.isNear(e.clientX, e.clientY));
  };

  private setNear(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    if (near) this.reveal();
    else this.restartCountdown();
  }

  /** Is the point in the band along the area's bottom edge, around the bar's position? */
  private isNear(x: number, y: number): boolean {
    const area = this.area.getBoundingClientRect();
    const bar = this.bar.getBoundingClientRect(); // hiding only moves it down, not sideways
    const { revealDistance, revealSlack } = this.options;
    return (
      y >= area.bottom - revealDistance &&
      y <= area.bottom &&
      x >= bar.left - revealSlack &&
      x <= bar.right + revealSlack
    );
  }
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

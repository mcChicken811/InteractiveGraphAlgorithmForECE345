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

export class StatusBar {
  private readonly options: StatusBarOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;
  private near = false;

  constructor(
    private readonly bar: HTMLElement,
    /** The area the bar sits at the bottom of (the canvas area). */
    private readonly area: HTMLElement,
    options: Partial<StatusBarOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
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
    this.bar.textContent = text;
    this.bar.dataset.tone = tone;
    this.reveal();
    this.restartCountdown();
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

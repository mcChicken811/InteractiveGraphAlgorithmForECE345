const DEFAULTS = { hideAfterMs: 5000, revealDistance: 64, revealSlack: 48 };
export class StatusBar {
    bar;
    area;
    options;
    timer = null;
    hovered = false;
    near = false;
    constructor(bar, 
    /** The area the bar sits at the bottom of (the canvas area). */
    area, options = {}) {
        this.bar = bar;
        this.area = area;
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
    show(text, tone = 'info') {
        this.bar.textContent = text;
        this.bar.dataset.tone = tone;
        this.reveal();
        this.restartCountdown();
    }
    /** Whether the bar is currently shown (or sliding into view). */
    get visible() {
        return !this.bar.classList.contains('is-hidden');
    }
    reveal() {
        this.bar.classList.remove('is-hidden');
    }
    restartCountdown() {
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            // Still being looked at: wait for the pointer to leave (which restarts the countdown).
            if (this.hovered || this.near)
                return;
            this.bar.classList.add('is-hidden');
        }, this.options.hideAfterMs);
    }
    onPointer = (e) => {
        this.setNear(this.isNear(e.clientX, e.clientY));
    };
    setNear(near) {
        if (near === this.near)
            return;
        this.near = near;
        if (near)
            this.reveal();
        else
            this.restartCountdown();
    }
    /** Is the point in the band along the area's bottom edge, around the bar's position? */
    isNear(x, y) {
        const area = this.area.getBoundingClientRect();
        const bar = this.bar.getBoundingClientRect(); // hiding only moves it down, not sideways
        const { revealDistance, revealSlack } = this.options;
        return (y >= area.bottom - revealDistance &&
            y <= area.bottom &&
            x >= bar.left - revealSlack &&
            x <= bar.right + revealSlack);
    }
}
//# sourceMappingURL=status-bar.js.map
/**
 * A styleable drop-down picker, replacing a native <select> (whose open list is drawn by
 * the browser/OS and cannot be styled or positioned — on macOS it pops up *over* the box).
 *
 * Follows the WAI-ARIA "select-only combobox" pattern:
 *   <div role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded aria-controls>
 *   <ul role="listbox"> <li role="option" aria-selected> …
 *
 * Mouse: click the box to open/close, click an option to choose it, click elsewhere to close.
 * Keyboard (on the box): ↓ / ↑ / Enter / Space / Home / End open it; while open, ↓ / ↑ /
 * Home / End move the highlight, Enter / Space choose, Esc closes, Tab chooses and moves on.
 */
export interface SelectOption {
  value: string;
  label: string;
}

export class SelectMenu {
  private options: SelectOption[] = [];
  private selectedIndex = 0;
  private activeIndex = 0;
  private readonly valueEl: HTMLElement;

  /** Called when the user picks a different option. */
  onChange: ((value: string) => void) | null = null;

  constructor(
    private readonly box: HTMLElement,
    private readonly list: HTMLElement,
  ) {
    this.valueEl = box.querySelector<HTMLElement>('.select-value') ?? box;
    box.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    box.addEventListener('keydown', this.onKeyDown);
    box.addEventListener('blur', () => this.close());
    // Keep focus on the box while clicking in the list, so `blur` doesn't close it first.
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const option = (e.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) return;
      this.choose(Number(option.dataset.index));
      this.close();
    });
    list.addEventListener('pointermove', (e) => {
      const option = (e.target as Element).closest<HTMLElement>('[role="option"]');
      if (option) this.setActive(Number(option.dataset.index));
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !box.contains(e.target as Node) && !list.contains(e.target as Node)) this.close();
    });
  }

  setOptions(options: SelectOption[]): void {
    this.options = options;
    this.list.replaceChildren(
      ...options.map((o, i) => {
        const li = document.createElement('li');
        li.id = `${this.list.id}-option-${i}`;
        li.className = 'select-option';
        li.setAttribute('role', 'option');
        li.dataset.index = String(i);
        li.dataset.value = o.value;
        li.textContent = o.label;
        return li;
      }),
    );
    this.selectedIndex = 0;
    this.render();
  }

  get value(): string {
    return this.options[this.selectedIndex]?.value ?? '';
  }

  set value(value: string) {
    const index = this.options.findIndex((o) => o.value === value);
    if (index >= 0) {
      this.selectedIndex = index;
      this.render();
    }
  }

  get disabled(): boolean {
    return this.box.getAttribute('aria-disabled') === 'true';
  }

  set disabled(disabled: boolean) {
    if (disabled) {
      this.close();
      this.box.setAttribute('aria-disabled', 'true');
      this.box.tabIndex = -1;
    } else {
      this.box.removeAttribute('aria-disabled');
      this.box.tabIndex = 0;
    }
  }

  get isOpen(): boolean {
    return this.box.getAttribute('aria-expanded') === 'true';
  }

  open(): void {
    if (this.disabled || this.isOpen || this.options.length === 0) return;
    this.box.setAttribute('aria-expanded', 'true');
    this.list.hidden = false;
    this.setActive(this.selectedIndex);
  }

  close(): void {
    if (!this.isOpen) return;
    this.box.setAttribute('aria-expanded', 'false');
    this.box.removeAttribute('aria-activedescendant');
    this.list.hidden = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disabled) return;
    const last = this.options.length - 1;
    if (!this.isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        this.open();
        if (e.key === 'Home') this.setActive(0);
        if (e.key === 'End') this.setActive(last);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.setActive(Math.min(last, this.activeIndex + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.setActive(Math.max(0, this.activeIndex - 1));
        break;
      case 'Home':
        e.preventDefault();
        this.setActive(0);
        break;
      case 'End':
        e.preventDefault();
        this.setActive(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.choose(this.activeIndex);
        this.close();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // don't also close the ☰ panel or clear a selection
        this.close();
        break;
      case 'Tab':
        this.choose(this.activeIndex); // focus moves on normally
        this.close();
        break;
    }
  };

  private setActive(index: number): void {
    this.activeIndex = index;
    const options = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    options.forEach((o, i) => o.classList.toggle('active', i === index));
    const active = options[index];
    if (active) {
      this.box.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private choose(index: number): void {
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.render();
    this.onChange?.(this.value);
  }

  private render(): void {
    this.valueEl.textContent = this.options[this.selectedIndex]?.label ?? '';
    this.list.querySelectorAll<HTMLElement>('[role="option"]').forEach((o, i) => {
      o.setAttribute('aria-selected', String(i === this.selectedIndex));
    });
  }
}

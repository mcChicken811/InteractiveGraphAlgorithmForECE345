import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectMenu } from '../src/select-menu.js';

let box: HTMLElement;
let list: HTMLElement;
let menu: SelectMenu;
let onChange: ReturnType<typeof vi.fn<(value: string) => void>>;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="box" role="combobox" tabindex="0" aria-expanded="false" aria-controls="list"><span class="select-value"></span></div>
    <ul id="list" role="listbox" hidden></ul>
    <button id="elsewhere"></button>`;
  box = document.querySelector('#box')!;
  list = document.querySelector('#list')!;
  menu = new SelectMenu(box, list);
  menu.setOptions([
    { value: 'bfs', label: 'Breadth-first search' },
    { value: 'dfs', label: 'Depth-first search' },
    { value: 'dijkstra', label: 'Dijkstra' },
  ]);
  onChange = vi.fn<(value: string) => void>();
  menu.onChange = onChange;
});

const key = (k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  box.dispatchEvent(e);
  return e;
};
const options = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')];
const active = () => options().findIndex((o) => o.classList.contains('active'));

describe('SelectMenu', () => {
  it('renders options and shows the first as selected', () => {
    expect(options().map((o) => o.textContent)).toEqual(['Breadth-first search', 'Depth-first search', 'Dijkstra']);
    expect(menu.value).toBe('bfs');
    expect(box.textContent).toBe('Breadth-first search');
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(list.hidden).toBe(true);
  });

  it('clicking the box toggles the list', () => {
    box.click();
    expect(menu.isOpen).toBe(true);
    expect(list.hidden).toBe(false);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    box.click();
    expect(menu.isOpen).toBe(false);
    expect(list.hidden).toBe(true);
  });

  it('opening highlights the selected option', () => {
    menu.value = 'dijkstra';
    box.click();
    expect(active()).toBe(2);
    expect(box.getAttribute('aria-activedescendant')).toBe(options()[2].id);
  });

  it('clicking an option chooses it and closes', () => {
    box.click();
    options()[1].click();
    expect(menu.value).toBe('dfs');
    expect(box.textContent).toBe('Depth-first search');
    expect(onChange).toHaveBeenCalledWith('dfs');
    expect(menu.isOpen).toBe(false);
  });

  it('re-choosing the current option does not report a change', () => {
    box.click();
    options()[0].click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard: arrows move, Home/End jump, Enter chooses', () => {
    key('ArrowDown'); // opens on the selected option (0)
    expect(menu.isOpen).toBe(true);
    expect(active()).toBe(0);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown'); // stays on the last
    expect(active()).toBe(2);
    key('ArrowUp');
    expect(active()).toBe(1);
    key('Home');
    expect(active()).toBe(0);
    key('End');
    expect(active()).toBe(2);
    key('Enter');
    expect(menu.value).toBe('dijkstra');
    expect(menu.isOpen).toBe(false);
  });

  it('keyboard: Space opens and chooses; Esc closes without choosing (and is not passed on)', () => {
    key(' ');
    key('ArrowDown');
    const esc = key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(menu.value).toBe('bfs');
    expect(esc.defaultPrevented).toBe(true);
    key(' ');
    key('ArrowDown');
    key(' ');
    expect(menu.value).toBe('dfs');
  });

  it('keyboard: Tab chooses the highlighted option and lets focus move on', () => {
    key('ArrowDown');
    key('ArrowDown');
    const tab = key('Tab');
    expect(menu.value).toBe('dfs');
    expect(menu.isOpen).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('closes when clicking elsewhere, but not when clicking inside', () => {
    box.click();
    list.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(true);
    document.querySelector('#elsewhere')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(false);
  });

  it('a disabled menu cannot be opened and leaves the tab order', () => {
    menu.disabled = true;
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.tabIndex).toBe(-1);
    box.click();
    key('ArrowDown');
    expect(menu.isOpen).toBe(false);
    menu.disabled = false;
    expect(box.hasAttribute('aria-disabled')).toBe(false);
    expect(box.tabIndex).toBe(0);
  });

  it('disabling an open menu closes it', () => {
    box.click();
    menu.disabled = true;
    expect(menu.isOpen).toBe(false);
  });

  it('setting an unknown value is ignored', () => {
    menu.value = 'nope';
    expect(menu.value).toBe('bfs');
  });
});

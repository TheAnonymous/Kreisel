/*
 * The menu under the right mouse button (or a long press): what can be done
 * with the thing under the pointer, right where the pointer is. A menu is a
 * title and rows; a row is one action, or a label with a few choices side by
 * side (so "laut" is one click away, not a submenu away). Rows that change
 * a value keep the menu open, and it redraws itself as the Kreisel changes.
 */

export interface MenuAction {
  kind: "action";
  label: string;
  /** A key that does the same, shown at the right. */
  hint?: string;
  run(): void;
  disabled?: boolean;
  /** A switch that is on. */
  checked?: boolean;
  /** Leave the menu open after the click (for switches and steps up and down). */
  keep?: boolean;
}

export interface MenuChoice {
  kind: "choice";
  label: string;
  /** `close` puts the menu away after the click (for choices that lead somewhere else). */
  options: readonly { label: string; title?: string; active?: boolean; disabled?: boolean; close?: boolean; run(): void }[];
}

export interface MenuHeading {
  kind: "heading";
  label: string;
}

export type MenuRow = MenuAction | MenuChoice | MenuHeading;

export interface MenuSpec {
  title: string;
  /** The colour of the thing the menu is about (a ring's, a person's). */
  color?: string;
  rows: readonly MenuRow[];
}

/** How long a finger rests before it counts as a long press. */
export const LONG_PRESS_MS = 550;
/** How far a finger may wander and still be resting. */
export const LONG_PRESS_SLACK = 10;

/**
 * Calls `open` when `node` is right-clicked, or pressed long with a finger
 * (which not every phone reports as a context menu). `byKeyboard` is set when
 * the menu key asked for it, with the point then at the element.
 */
export function onContext(node: HTMLElement, open: (x: number, y: number, byKeyboard: boolean) => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let touched = -Infinity;
  let swallowUntil = 0;
  let start = { x: 0, y: 0 };
  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    // A finger's long press is the timer's business.
    if (performance.now() - touched < 1500) return;
    const box = node.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (inside) {
      // The right button leaves the keyboard where it was: a button it happened to land on does not keep it.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && node.contains(focused)) focused.blur();
      open(event.clientX, event.clientY, false);
    } else {
      open(box.left + Math.min(24, box.width / 2), box.bottom - 4, true);
    }
  });
  node.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    touched = performance.now();
    start = { x: event.clientX, y: event.clientY };
    disarm();
    timer = setTimeout(() => {
      timer = null;
      // The finger coming up must not also press what is underneath.
      swallowUntil = Infinity;
      open(start.x, start.y, false);
    }, LONG_PRESS_MS);
  });
  node.addEventListener("pointermove", (event) => {
    if (timer !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLACK) disarm();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
    node.addEventListener(type, () => {
      disarm();
      if (swallowUntil === Infinity) swallowUntil = performance.now() + 400;
    });
  }
  node.addEventListener("click", (event) => {
    if (performance.now() >= swallowUntil) return;
    swallowUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

export class ContextMenu {
  private build: (() => MenuSpec | null) | null = null;
  private signature = "";
  private returnTo: HTMLElement | null = null;
  private at = { x: 0, y: 0 };

  constructor(private readonly node: HTMLElement) {
    node.addEventListener("keydown", (event) => this.key(event));
    node.addEventListener("contextmenu", (event) => event.preventDefault());
    // Anything pressed outside puts the menu away (in the capture phase, before the page reacts to it).
    document.addEventListener("pointerdown", (event) => {
      if (this.isOpen && !(event.target instanceof Node && node.contains(event.target))) this.close(false);
    }, true);
    // Opened with the mouse, the keyboard is still elsewhere: Escape puts the menu away, the arrows step into it.
    // Every other key stays with the Kreisel, so the space bar still starts and stops.
    document.addEventListener("keydown", (event) => {
      if (!this.isOpen || (event.target instanceof Node && node.contains(event.target))) return;
      if (event.key !== "Escape" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        this.close();
        return;
      }
      const buttons = this.buttons();
      (event.key === "ArrowDown" ? buttons[0] : buttons[buttons.length - 1])?.focus();
    }, true);
    window.addEventListener("blur", () => this.close(false));
    window.addEventListener("resize", () => this.close(false));
    window.addEventListener("scroll", () => this.close(false), true);
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  /** Opens the menu at a point of the page. `build` is asked again whenever the Kreisel changes while the menu is open. */
  open(x: number, y: number, build: () => MenuSpec | null, focus = false): void {
    // Only a menu the keyboard asked for hands the keyboard back: after a right click, whatever happened to
    // hold the focus (a button pressed earlier) must not get it again, or it would swallow the space bar.
    this.returnTo = focus && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.build = build;
    this.at = { x, y };
    this.signature = "";
    this.node.hidden = false;
    this.render();
    if (this.node.hidden) return;
    if (focus) this.buttons()[0]?.focus();
  }

  /** Redraws an open menu from its builder if the Kreisel changed what it says. */
  refresh(): void {
    if (!this.isOpen) return;
    const before = this.node.querySelectorAll("button");
    const focused = [...before].indexOf(document.activeElement as HTMLButtonElement);
    if (!this.render() || focused < 0) return;
    // The keyboard stays on the row it was on (or the nearest one that can still be pressed).
    const after = [...this.node.querySelectorAll("button")];
    const next = after[focused]?.disabled === false ? after[focused] : (after.slice(focused).find((button) => !button.disabled) ?? after.slice(0, focused).reverse().find((button) => !button.disabled));
    next?.focus();
  }

  close(giveFocusBack = true): void {
    if (!this.isOpen) return;
    this.node.hidden = true;
    this.build = null;
    this.node.replaceChildren();
    if (giveFocusBack) this.returnTo?.focus();
    this.returnTo = null;
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.node.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  }

  /** Draws the menu; `false` when nothing had to change (or there is nothing to show any more). */
  private render(): boolean {
    const spec = this.build?.() ?? null;
    if (!spec) {
      this.close(false);
      return false;
    }
    // Functions drop out of the text, so it says exactly what the menu shows.
    const signature = JSON.stringify(spec);
    if (signature === this.signature) return false;
    this.signature = signature;
    const node = this.node;
    node.style.setProperty("--c", spec.color ?? "var(--ink)");
    node.setAttribute("aria-label", spec.title);
    const title = document.createElement("header");
    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("strong");
    name.textContent = spec.title;
    title.append(dot, name);
    const rows: HTMLElement[] = [title];
    for (const row of spec.rows) {
      if (row.kind === "heading") {
        const heading = document.createElement("h3");
        heading.textContent = row.label;
        rows.push(heading);
      } else if (row.kind === "action") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "menu-row";
        button.setAttribute("role", row.checked === undefined ? "menuitem" : "menuitemcheckbox");
        if (row.checked !== undefined) button.setAttribute("aria-checked", String(row.checked));
        button.disabled = row.disabled ?? false;
        const label = document.createElement("span");
        label.textContent = row.label;
        button.append(label);
        if (row.hint) {
          const hint = document.createElement("kbd");
          hint.textContent = row.hint;
          button.append(hint);
        }
        button.addEventListener("click", (event) => {
          // Pressed with the mouse or a finger, a row does not take the keyboard: the space bar still starts and stops.
          if (event.detail > 0) button.blur();
          const keep = row.keep ?? false;
          if (!keep) this.close();
          row.run();
        });
        rows.push(button);
      } else {
        const line = document.createElement("div");
        line.className = "menu-choice";
        line.setAttribute("role", "group");
        line.setAttribute("aria-label", row.label);
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = row.label;
        line.append(label);
        for (const option of row.options) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = option.label;
          button.setAttribute("role", option.active === undefined ? "menuitem" : "menuitemradio");
          if (option.active !== undefined) button.setAttribute("aria-checked", String(option.active));
          if (option.title) {
            button.title = option.title;
            button.setAttribute("aria-label", option.title);
          }
          button.disabled = option.disabled ?? false;
          button.addEventListener("click", (event) => {
            if (event.detail > 0) button.blur();
            if (option.close) this.close();
            option.run();
          });
          line.append(button);
        }
        rows.push(line);
      }
    }
    node.replaceChildren(...rows);
    // Next to the pointer, but always whole on the page.
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.max(6, Math.min(this.at.x + 2, window.innerWidth - width - 6));
    const top = Math.max(6, Math.min(this.at.y + 2, window.innerHeight - height - 6));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    return true;
  }

  private key(event: KeyboardEvent): void {
    // The Kreisel's own keys rest while a menu is open.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    const moves: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const by = moves[event.key];
    if (by === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = this.buttons();
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (by ?? 0) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

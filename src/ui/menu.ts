/*
 * The menu under the right mouse button (or a long press): what can be done
 * with the thing under the pointer, right where the pointer is. A menu is a
 * title and rows; a row is one action, or a label with a few choices side by
 * side (so "laut" is one click away, not a submenu away), or a slider. Rows
 * that change a value keep the menu open, and it redraws itself as the
 * Kreisel changes.
 *
 * The same menu hangs under the buttons of the bar that open one (the
 * Kreisel's name, the speaker, "Share"): there it opens under its button,
 * and a second press on the button puts it away again.
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
  /** A line under the label that says what the row does, where its name does not. */
  note?: string;
}

/** A control for a share between nothing and all; the menu stays open while it is moved. */
export interface MenuSlider {
  kind: "slider";
  label: string;
  /** The `id` of its input, for a label elsewhere or a test. */
  id?: string;
  /** 0..1. */
  value: number;
  set(value: number): void;
  /** What the right button on it does: back to where a fresh Kreisel has it. */
  reset?(): void;
  title?: string;
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

export type MenuRow = MenuAction | MenuChoice | MenuHeading | MenuSlider;

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
  /** The button the menu hangs under, if a button opened it. */
  private anchor: HTMLElement | null = null;

  constructor(private readonly node: HTMLElement) {
    node.addEventListener("keydown", (event) => this.key(event));
    node.addEventListener("contextmenu", (event) => event.preventDefault());
    // Anything pressed outside puts the menu away (in the capture phase, before the page reacts to it).
    document.addEventListener("pointerdown", (event) => {
      if (!this.isOpen || !(event.target instanceof Node) || node.contains(event.target)) return;
      // A press on the menu's own button is that button's business: it puts the menu away itself.
      if (this.anchor?.contains(event.target)) return;
      this.close(false);
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
    // The page moving under the menu puts it away; a long menu scrolling in itself does not. A menu that hangs
    // under a button goes along with its button instead: pressing a button can itself move the page a little
    // (the browser brings what takes the focus into view), and the menu must not vanish in the same moment.
    window.addEventListener("scroll", (event) => {
      if (!this.isOpen || (event.target instanceof Node && node.contains(event.target))) return;
      if (this.anchor) this.hang(this.anchor);
      else this.close(false);
    }, true);
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  /** Opens the menu at a point of the page. `build` is asked again whenever the Kreisel changes while the menu is open. */
  open(x: number, y: number, build: () => MenuSpec | null, focus = false): void {
    this.show(x, y, build, focus, "");
  }

  /** `room` is how tall the menu may get (a CSS length; nothing for as tall as the page). */
  private show(x: number, y: number, build: () => MenuSpec | null, focus: boolean, room: string): void {
    this.close(false);
    this.node.style.maxHeight = room;
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

  /** Whether the menu that hangs on a button may stand beside it (see `openUnder`). */
  private beside = false;

  /**
   * Opens the menu under a button of the page, its left edge at the button's (or as far left as it has to go to
   * stay whole on the page). A second call for the same button puts the menu away: the button is a switch for it.
   * With `beside`, a menu for which there is not room enough below its button stands to the left of it instead, whole
   * (for a button in the middle of the page with a long menu; a bar's menus have the page below them).
   */
  openUnder(anchor: HTMLElement, build: () => MenuSpec | null, focus = false, beside = false): void {
    if (this.isOpen && this.anchor === anchor) {
      this.close(focus);
      return;
    }
    this.show(0, 0, build, focus, "");
    if (!this.isOpen) return;
    this.anchor = anchor;
    this.beside = beside;
    this.node.dataset.under = anchor.id;
    anchor.setAttribute("aria-expanded", "true");
    this.hang(anchor);
  }

  /** Puts the open menu under this button, where the button is now. */
  private hang(anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    if (this.beside) {
      // As tall as it is with nothing holding it back: if that does not fit below the button and there is room to its left, it stands there.
      this.node.style.maxHeight = "";
      const width = this.node.offsetWidth;
      if (this.node.offsetHeight > window.innerHeight - box.bottom - 16 && box.left - width - 10 >= 6) {
        this.at = { x: box.left - width - 10, y: box.top - 2 };
        this.place();
        return;
      }
    }
    // It stays below its button, however much it holds: a long one scrolls.
    this.node.style.maxHeight = `calc(100dvh - ${Math.round(box.bottom) + 16}px)`;
    this.at = { x: box.left - 2, y: box.bottom + 6 };
    this.place();
  }

  /** Redraws an open menu from its builder if the Kreisel changed what it says. */
  refresh(): void {
    if (!this.isOpen) return;
    const before = this.node.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input");
    const focused = [...before].indexOf(document.activeElement as HTMLButtonElement);
    if (!this.render() || focused < 0) return;
    // The keyboard stays on the row it was on (or the nearest one that can still be pressed).
    const after = [...this.node.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")];
    const next = after[focused]?.disabled === false ? after[focused] : (after.slice(focused).find((button) => !button.disabled) ?? after.slice(0, focused).reverse().find((button) => !button.disabled));
    next?.focus();
  }

  close(giveFocusBack = true): void {
    if (!this.isOpen) return;
    this.node.hidden = true;
    this.build = null;
    this.node.replaceChildren();
    this.anchor?.setAttribute("aria-expanded", "false");
    this.anchor = null;
    this.beside = false;
    delete this.node.dataset.under;
    if (giveFocusBack) this.returnTo?.focus();
    this.returnTo = null;
  }

  /** What the arrows step through: the rows that can be pressed, and the sliders. */
  private buttons(): HTMLElement[] {
    return [...this.node.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
  }

  /** Draws the menu; `false` when nothing had to change (or there is nothing to show any more). */
  private render(): boolean {
    const spec = this.build?.() ?? null;
    if (!spec) {
      this.close(false);
      return false;
    }
    // Functions drop out of the text, so it says exactly what the menu shows. Where a slider stands is left out:
    // a slider that is being moved must not be taken from under the pointer. It is set where it is instead, which
    // changes nothing while it is moved (it says what it was just told) and shows a step back or a reset at once.
    const signature = JSON.stringify(spec, (key, value: unknown) => (key === "value" ? undefined : value));
    if (signature === this.signature) {
      const sliders = spec.rows.filter((row): row is MenuSlider => row.kind === "slider");
      this.node.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((input, index) => {
        const slider = sliders[index];
        const stands = slider ? String(Math.round(slider.value * 100)) : input.value;
        if (input.value !== stands) input.value = stands;
      });
      return false;
    }
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
        if (row.note) {
          const note = document.createElement("small");
          note.textContent = row.note;
          button.append(note);
          button.classList.add("with-note");
        }
        button.addEventListener("click", (event) => {
          // Pressed with the mouse or a finger, a row does not take the keyboard: the space bar still starts and stops.
          if (event.detail > 0) button.blur();
          const keep = row.keep ?? false;
          if (!keep) this.close();
          row.run();
        });
        rows.push(button);
      } else if (row.kind === "slider") {
        const line = document.createElement("label");
        line.className = "menu-slider";
        const label = document.createElement("span");
        label.textContent = row.label;
        const input = document.createElement("input");
        input.type = "range";
        input.min = "0";
        input.max = "100";
        input.step = "1";
        input.value = String(Math.round(row.value * 100));
        // What a screen reader says for the value.
        const say = (): void => input.setAttribute("aria-valuetext", `${input.value} %`);
        say();
        input.addEventListener("input", say);
        if (row.id) input.id = row.id;
        input.title = [row.title, row.reset ? "Right click resets" : ""].filter(Boolean).join(" · ");
        input.addEventListener("input", () => row.set(Number(input.value) / 100));
        // Moved with the mouse or a finger, it does not keep the keyboard: the space bar still starts and stops.
        let byPointer = false;
        input.addEventListener("pointerdown", () => { byPointer = true; });
        input.addEventListener("change", () => {
          if (byPointer) input.blur();
          byPointer = false;
        });
        input.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          row.reset?.();
          // The right button leaves the keyboard with the Kreisel, so that one step back is one key away.
          input.blur();
        });
        line.append(label, input);
        rows.push(line);
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
    this.place();
    return true;
  }

  /** Next to the point it was opened at, but always whole on the page. */
  private place(): void {
    const node = this.node;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.max(6, Math.min(this.at.x + 2, window.innerWidth - width - 6));
    const top = Math.max(6, Math.min(this.at.y + 2, window.innerHeight - height - 6));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  private key(event: KeyboardEvent): void {
    // The Kreisel's own keys rest while a menu is open.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    // On a slider, left and right (and Home and End) move the slider; up and down still step from row to row.
    const onSlider = event.target instanceof HTMLInputElement;
    if (onSlider && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const moves: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const by = moves[event.key];
    if (by === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = this.buttons();
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (by ?? 0) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

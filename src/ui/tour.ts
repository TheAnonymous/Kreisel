/*
 * The tour: the first steps, shown where they happen. A light falls on one
 * part of the page after the other and a card beside it says in two
 * sentences what it is for. Nothing is locked while it runs: the page stays
 * playable, and a step that asks for something to be tried moves on by
 * itself once it has been done. It comes once, on the first visit, and
 * again whenever it is asked for in the menu.
 */

export interface TourStep {
  /** What the light falls on (a CSS selector). */
  target: string;
  title: string;
  text: string;
  /** Where the card goes if there is room: beside the target, or below or above it. */
  side: "right" | "left" | "below" | "above";
  /** The step asks for something to be done: once this is true it goes on by itself. Asked whenever the app changes. */
  done?: () => boolean;
}

/** Room between the light's edge and what it falls on, and between the card and the light (pixels). */
const HALO = 8;
const GAP = 14;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the card goes: on the wished side of the target if it fits into the window there, else on the first side
 * where it does, else over the target's lower part. Always wholly inside the window.
 */
export function placeCard(target: Box, card: { width: number; height: number }, window: { width: number; height: number }, wish: TourStep["side"]): { left: number; top: number } {
  const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(Math.max(low, high), value));
  const middleX = target.left + target.width / 2 - card.width / 2;
  const middleY = target.top + target.height / 2 - card.height / 2;
  const spots: Record<TourStep["side"], { left: number; top: number; fits: boolean }> = {
    right: { left: target.left + target.width + GAP, top: middleY, fits: target.left + target.width + GAP + card.width <= window.width - 8 },
    left: { left: target.left - GAP - card.width, top: middleY, fits: target.left - GAP - card.width >= 8 },
    below: { left: middleX, top: target.top + target.height + GAP, fits: target.top + target.height + GAP + card.height <= window.height - 8 },
    above: { left: middleX, top: target.top - GAP - card.height, fits: target.top - GAP - card.height >= 8 },
  };
  const order: TourStep["side"][] = [wish, "right", "left", "below", "above"];
  const side = order.find((name) => spots[name].fits);
  const spot = side ? spots[side] : { left: middleX, top: target.top + target.height - card.height - GAP };
  return { left: clamp(spot.left, 8, window.width - card.width - 8), top: clamp(spot.top, 8, window.height - card.height - 8) };
}

export class Tour {
  private index = -1;
  private readonly hole: HTMLElement;
  private readonly card: HTMLElement;
  private readonly next: HTMLButtonElement;
  private frame = 0;

  /** `ended` hears that the tour is over, however it ended. */
  constructor(private readonly root: HTMLElement, private readonly steps: readonly TourStep[], private readonly ended: () => void) {
    const find = <T extends HTMLElement>(selector: string): T => {
      const node = root.querySelector<T>(selector);
      if (!node) throw new Error(`tour without ${selector}`);
      return node;
    };
    this.hole = find(".tour-hole");
    this.card = find(".tour-card");
    this.next = find("#tour-next");
    this.next.addEventListener("click", () => this.forward());
    find("#tour-skip").addEventListener("click", () => this.end());
    const again = (): void => {
      if (this.running) this.place();
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, { passive: true, capture: true });
  }

  get running(): boolean {
    return this.index >= 0;
  }

  /** The step the tour is on, counted from 0, or -1. */
  get at(): number {
    return this.index;
  }

  start(): void {
    this.index = 0;
    this.root.hidden = false;
    this.show();
  }

  end(): void {
    if (!this.running) return;
    this.index = -1;
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    this.ended();
  }

  forward(): void {
    if (!this.running) return;
    if (this.index >= this.steps.length - 1) {
      this.end();
      return;
    }
    this.index += 1;
    this.show();
  }

  /** The app has changed: a step that asked for something to be done moves on when it was. */
  check(): void {
    if (!this.running) return;
    if (this.steps[this.index]?.done?.()) this.forward();
    else this.later();
  }

  private show(): void {
    const step = this.steps[this.index];
    if (!step) return;
    const set = (selector: string, text: string): void => {
      const node = this.root.querySelector(selector);
      if (node) node.textContent = text;
    };
    set("#tour-count", `${this.index + 1} von ${this.steps.length}`);
    set("#tour-title", step.title);
    set("#tour-text", step.text);
    this.next.textContent = this.index >= this.steps.length - 1 ? "Los geht’s" : "Weiter";
    // On a small screen the part may lie further down the page.
    const target = document.querySelector(step.target);
    const box = target?.getBoundingClientRect();
    if (target && box && (box.top < 0 || box.bottom > window.innerHeight)) target.scrollIntoView({ block: "center" });
    this.place();
    this.later();
  }

  /** Once more in the next frame: by then the page has taken in whatever just changed. */
  private later(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.running) this.place();
    });
  }

  private place(): void {
    const step = this.steps[this.index];
    const target = step ? document.querySelector(step.target) : null;
    if (!step || !target) return;
    const box = target.getBoundingClientRect();
    const light = { left: box.left - HALO, top: box.top - HALO, width: box.width + HALO * 2, height: box.height + HALO * 2 };
    this.hole.style.left = `${light.left}px`;
    this.hole.style.top = `${light.top}px`;
    this.hole.style.width = `${light.width}px`;
    this.hole.style.height = `${light.height}px`;
    const spot = placeCard(light, { width: this.card.offsetWidth, height: this.card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, step.side);
    this.card.style.left = `${spot.left}px`;
    this.card.style.top = `${spot.top}px`;
  }
}

import type { App } from "../app/app";
import { stepSeconds } from "../audio/engine";
import { BAR, SCENE_NAMES } from "../model";
import { MAX_ROUNDS, orderBars } from "../order";
import { carryable } from "./carry";
import { button, byId, el } from "./dom";
import { onContext } from "./menu";
import { drawScene, sceneLooks } from "./scene-thumb";

/** How wide a round's small wheel is drawn, in CSS pixels. */
const WHEEL = 23;
/** How far above and below the band a carried thing still lands in it. */
const REACH = 34;

/*
 * The row ("Folge") under the wheel: one tile a round, in the order they
 * play. A click goes to a round, the right button has more, a tile can be
 * carried to another place, and a scene carried here from the scenes' box is
 * laid in where it is let go.
 */
export class RowBand {
  private readonly node = byId("row");
  private readonly rounds = el("div", "rounds");
  private readonly gap = el("span", "gap");
  private readonly add = button("round add", "+", "Die Szene auf dem Tisch ans Ende der Folge legen");
  private readonly sum = el("span", "row-sum");
  private tiles: HTMLButtonElement[] = [];
  /** What the tiles show; they are made anew only when this changes. */
  private shown = "";
  /** The round that was marked last: when it changes, the row is pushed along so that it can be seen. */
  private marked: number | null = null;
  private frame = 0;

  constructor(private readonly app: App) {}

  build(): void {
    const app = this.app;
    this.add.setAttribute("aria-label", "Szene vom Tisch in die Folge legen");
    this.add.addEventListener("click", () => app.scenes.lay(app.project.scene));
    this.node.append(el("span", "row-name", "Folge"), this.rounds, this.add, this.sum);
    // Delete takes the round the keyboard is on out of the row (and not a hit off the wheel).
    this.node.addEventListener("keydown", (event) => {
      const round = event.target instanceof HTMLElement ? event.target.dataset.round : undefined;
      if (round === undefined || (event.key !== "Delete" && event.key !== "Backspace")) return;
      event.preventDefault();
      event.stopPropagation();
      app.scenes.removeRound(Number(round));
    });
    // A long row is pushed along with the wheel of the mouse.
    this.rounds.addEventListener("wheel", (event) => {
      if (this.rounds.scrollWidth <= this.rounds.clientWidth || event.deltaX !== 0) return;
      event.preventDefault();
      this.rounds.scrollLeft += event.deltaY;
    }, { passive: false });
  }

  /** Pushes the row along until `tile` is in view. (Not `scrollIntoView`: that would move the page as well.) */
  private reveal(tile: HTMLElement): void {
    const view = this.rounds.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    if (box.left < view.left + 5) this.rounds.scrollLeft -= view.left + 5 - box.left;
    else if (box.right > view.right - 5) this.rounds.scrollLeft += box.right - (view.right - 5);
  }

  /** The place in the row a thing carried to this point would get: before which round, or `null` if the point is not at the row. */
  placeAt(x: number, y: number): number | null {
    if (this.node.hidden) return null;
    const box = this.node.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top - REACH || y > box.bottom + REACH) return null;
    const before = this.tiles.findIndex((tile) => {
      const tileBox = tile.getBoundingClientRect();
      return x < tileBox.left + tileBox.width / 2;
    });
    return before < 0 ? this.tiles.length : before;
  }

  /** Shows where a carried thing would land (before round `place`), or puts the mark away. */
  showGap(place: number | null): void {
    if (place === null) {
      this.gap.remove();
      return;
    }
    const tile = this.tiles[place];
    if (tile) tile.before(this.gap);
    else this.rounds.append(this.gap);
  }

  sync(): void {
    const app = this.app;
    const project = app.project;
    const on = app.scenes.plays === "row";
    this.node.hidden = !on;
    // Messages keep out of the row's way while it is on the page (see row.css).
    document.documentElement.toggleAttribute("data-row", on);
    if (!on) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    const looks = project.order.map((scene) => `${scene}:${sceneLooks(project.scenes[scene])}`).join("/");
    if (looks !== this.shown) {
      this.shown = looks;
      // The keyboard stays at its place in the row: after a round is taken out, on the one that moved up.
      const held = this.tiles.findIndex((tile) => tile === document.activeElement);
      this.tiles = project.order.map((scene, round) => this.tile(scene, round));
      this.rounds.replaceChildren(...this.tiles);
      if (held >= 0) (this.tiles[Math.min(held, this.tiles.length - 1)] ?? this.add).focus();
    }
    const now = app.scenes.round;
    const queued = app.scenes.queuedRound;
    this.tiles.forEach((tile, round) => {
      tile.classList.toggle("now", round === now);
      tile.classList.toggle("queued", round === queued && round !== now);
      if (round === now) tile.setAttribute("aria-current", "true");
      else tile.removeAttribute("aria-current");
      if (round !== now) tile.style.removeProperty("--done");
    });
    if (now !== this.marked) {
      this.marked = now;
      const tile = now === null ? undefined : this.tiles[now];
      if (tile) this.reveal(tile);
    }
    const count = project.order.length;
    const seconds = Math.round(orderBars(project) * BAR * stepSeconds(project));
    this.sum.textContent = `${count} ${count === 1 ? "Runde" : "Runden"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    this.add.disabled = count >= MAX_ROUNDS;
    this.add.title = count >= MAX_ROUNDS ? `Mehr als ${MAX_ROUNDS} Runden passen nicht in die Folge` : `Szene ${SCENE_NAMES[project.scene] ?? ""} ans Ende der Folge legen`;
    if (app.playing && this.frame === 0) this.frame = requestAnimationFrame(() => this.progress());
    if (!app.playing && now !== null) this.tiles[now]?.style.removeProperty("--done");
  }

  /** While it plays: how far the round that sounds has come, shown at the foot of its tile. */
  private progress(): void {
    this.frame = 0;
    const app = this.app;
    if (this.node.hidden || !app.playing) return;
    const now = app.scenes.round;
    if (now !== null) this.tiles[now]?.style.setProperty("--done", app.scenes.roundDone().toFixed(3));
    this.frame = requestAnimationFrame(() => this.progress());
  }

  private tile(scene: number, round: number): HTMLButtonElement {
    const app = this.app;
    const name = SCENE_NAMES[scene] ?? "";
    const tile = button("round", "", `${round + 1}. Runde: Szene ${name} · Klick springt hierher · ziehen ordnet um · Rechtsklick für mehr`);
    tile.dataset.round = String(round);
    tile.setAttribute("aria-label", `${round + 1}. Runde: Szene ${name}`);
    const wheel = el("canvas");
    const filled = app.project.scenes[scene];
    if (filled) drawScene(wheel, filled, WHEEL);
    tile.append(wheel, el("span", "letter", name));
    tile.addEventListener("click", () => app.scenes.goTo(round));
    onContext(tile, (x, y, byKeyboard) => app.openContext({ kind: "round", round }, x, y, byKeyboard));
    carryable(tile, {
      take: () => ({ round }),
      picture: () => {
        const copy = tile.cloneNode(true) as HTMLElement;
        copy.className = "round";
        copy.removeAttribute("title");
        copy.style.removeProperty("--done");
        const picture = copy.querySelector("canvas");
        if (picture && filled) drawScene(picture, filled, WHEEL);
        return copy;
      },
      over: (_carried, x, y) => {
        const place = this.placeAt(x, y);
        this.showGap(place);
        return place !== null;
      },
      drop: (carried, x, y) => {
        const place = this.placeAt(x, y);
        // The place is counted with the carried round still in the row: once it is out, what came after it moves up.
        if (place !== null) app.scenes.moveRound(carried.round, place > carried.round ? place - 1 : place);
      },
      end: () => this.showGap(null),
    });
    return tile;
  }
}

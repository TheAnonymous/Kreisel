import type { App } from "../app/app";
import type { Plays } from "../app/scenes";
import { SCENE_COUNT, SCENE_NAMES } from "../model";
import { playMotion } from "./answers";
import { carryable } from "./carry";
import { button, byId, el } from "./dom";
import { onContext } from "./menu";
import type { RowBand } from "./row-band";
import { drawScene, sceneLooks } from "./scene-thumb";

/** How wide a scene's small wheel is drawn, in CSS pixels. */
const WHEEL = 36;

const PLAYS: readonly { id: Plays; name: string; hint: string }[] = [
  { id: "scene", name: "Szene", hint: "Die Szene auf dem Tisch spielt im Kreis" },
  { id: "row", name: "Folge", hint: "Die Szenen spielen nacheinander, wie sie unter dem Rad liegen" },
  { id: "piece", name: "Stück", hint: "Der äußere Ring sagt, was wann spielt: außen viel, innen wenig" },
];

interface Chip {
  node: HTMLButtonElement;
  wheel: HTMLCanvasElement;
  /** What its wheel shows; it is drawn anew only when this changes. */
  looks: string;
}

/*
 * The scenes' box: eight scenes, each a small wheel that shows what is in it,
 * and under them the switch for what plays: the scene on the table round and
 * round, the row, or the piece. A scene can be carried into the row under the
 * wheel, or onto an empty scene to make a copy of it there.
 */
export class ScenesBox {
  private readonly chips: Chip[] = [];
  private readonly plays = new Map<Plays, HTMLButtonElement>();
  private current = -1;

  constructor(private readonly app: App, private readonly row: RowBand) {}

  build(): void {
    const app = this.app;
    const holder = byId("scenes");
    for (let index = 0; index < SCENE_COUNT; index += 1) {
      const node = button("scene", "");
      const wheel = el("canvas");
      node.append(wheel, el("span", "letter", SCENE_NAMES[index] ?? ""));
      node.addEventListener("click", (event) => {
        if (event.shiftKey) app.scenes.clear(index);
        else app.scenes.pick(index);
      });
      onContext(node, (x, y, byKeyboard) => app.openContext({ kind: "scene", index }, x, y, byKeyboard));
      carryable(node, {
        take: () => (app.project.scenes[index] ? { scene: index } : null),
        picture: () => {
          const copy = node.cloneNode(true) as HTMLElement;
          copy.className = "scene filled";
          copy.removeAttribute("title");
          const picture = copy.querySelector("canvas");
          const scene = app.project.scenes[index];
          if (picture && scene) drawScene(picture, scene, WHEEL);
          return copy;
        },
        over: (_carried, x, y) => {
          const place = this.row.placeAt(x, y);
          this.row.showGap(place);
          const empty = place === null ? this.emptyAt(x, y) : null;
          this.chips.forEach((chip, at) => chip.node.classList.toggle("landing", at === empty));
          return place !== null || empty !== null;
        },
        drop: (carried, x, y) => {
          const place = this.row.placeAt(x, y);
          if (place !== null) {
            app.scenes.lay(carried.scene, place);
            return;
          }
          const empty = this.emptyAt(x, y);
          if (empty !== null) app.scenes.copyTo(carried.scene, empty);
        },
        end: () => {
          this.row.showGap(null);
          for (const chip of this.chips) chip.node.classList.remove("landing");
        },
      });
      holder.append(node);
      this.chips.push({ node, wheel, looks: "" });
    }

    const plays = byId("plays");
    for (const play of PLAYS) {
      const node = button("", play.name, play.hint);
      node.setAttribute("role", "radio");
      node.dataset.plays = play.id;
      node.addEventListener("click", () => app.scenes.setPlays(play.id));
      plays.append(node);
      this.plays.set(play.id, node);
    }
  }

  /** The empty scene under this point, if there is one. */
  private emptyAt(x: number, y: number): number | null {
    const at = this.chips.findIndex((chip, index) => {
      if (this.app.project.scenes[index]) return false;
      const box = chip.node.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });
    return at < 0 ? null : at;
  }

  sync(): void {
    const app = this.app;
    const project = app.project;
    const queued = app.engine.queuedScene;
    const sounding = app.scenes.sounding;
    this.chips.forEach((chip, index) => {
      const scene = project.scenes[index] ?? null;
      const name = SCENE_NAMES[index] ?? "";
      const node = chip.node;
      node.classList.toggle("filled", scene !== null);
      node.classList.toggle("current", index === project.scene);
      node.classList.toggle("sounding", index === sounding);
      node.classList.toggle("queued", index === queued && index !== project.scene);
      node.setAttribute("aria-pressed", String(index === project.scene));
      node.setAttribute("aria-label", scene ? `Szene ${name}` : `Szene ${name}, leer`);
      node.title = scene
        ? `Szene ${name} · ziehen legt sie in die Folge oder als Kopie auf eine leere Szene · mit Umschalt leeren`
        : `Leer: Klick macht eine Kopie von Szene ${SCENE_NAMES[project.scene] ?? ""}`;
      const looks = sceneLooks(scene);
      if (looks !== chip.looks) {
        chip.looks = looks;
        if (scene) drawScene(chip.wheel, scene, WHEEL);
      }
    });
    if (this.current !== project.scene) {
      if (this.current !== -1) playMotion(this.chips[project.scene]?.node ?? null, "pop");
      this.current = project.scene;
    }
    const playing = app.scenes.plays;
    for (const [id, node] of this.plays) node.setAttribute("aria-checked", String(id === playing));
  }
}

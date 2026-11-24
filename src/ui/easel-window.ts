import type { App } from "../app/app";
import { BRUSH_TOOLS } from "../app/paint";
import { packBild, unpackBild } from "../codec";
import { OWN_SOUND, TIME_MAX, trackInfo, trackOf } from "../model";
import { renderThumb, type EaselView } from "./easel";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

const BRUSH_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c3-7 6-7 9 0s6 7 9 0"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16 8 7v9l5-9v9l5-9v9"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="fill"><circle cx="5" cy="13" r="1.3"/><circle cx="9" cy="8" r="1.3"/><circle cx="10" cy="15" r="1.3"/><circle cx="14" cy="11" r="1.3"/><circle cx="15" cy="17" r="1.3"/><circle cx="18" cy="7" r="1.3"/><circle cx="19" cy="13" r="1.3"/></g></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 19-4-4 9-9 6 6-7 7zM13 19h7M9 10l6 6"/></svg>',
] as const;

/*
 * The paint box's window around its sheet (easel.ts): brushes and their sizes, holding a tone, dice, the microphone, and the shelf of kept pictures.
 */
export class EaselWindow {
  readonly brushButtons: HTMLButtonElement[] = [];
  private readonly sizeDots = el("span", "dots");
  private thumbSignature = "";
  private shelfSignature = "not built yet";
  private easelOpen = false;

  constructor(private readonly panels: Panels, private readonly app: App, private readonly easel: EaselView) {}

  /** The paint box: its buttons, and the brushes that take the tools' place while it is open. */
  build(): void {
    const app = this.app;
    const brushes = byId("brushes");
    BRUSH_TOOLS.forEach((brush, index) => {
      const node = button("tool", "", brush.hint);
      node.innerHTML = BRUSH_ICONS[index] ?? "";
      node.append(el("span", "name", brush.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => app.paint.setBrush(index));
      brushes.append(node);
      this.brushButtons.push(node);
    });
    const size = button("tool size", "", "How much paint the brush holds: thin and quiet to thick and loud (also with the mouse wheel)");
    size.id = "brush-size";
    size.append(this.sizeDots, el("span", "name", "Thickness"), el("kbd", "key", "T"));
    for (let dot = 0; dot < 3; dot += 1) this.sizeDots.append(el("i"));
    size.addEventListener("click", () => app.paint.setBrushSize((app.paint.brushSize + 1) % 3));
    brushes.append(size);

    byId("easel-done").addEventListener("click", () => app.paint.close());
    byId("bild-dice").addEventListener("click", () => app.paint.dice());
    byId("bild-clear").addEventListener("click", () => app.paint.clear());
    byId("bild-keep").addEventListener("click", () => app.paint.keep());
    byId("bild-listen").addEventListener("click", () => void app.paint.imitate());
    const ear = byId("listening");
    app.paint.onLoudness = (level) => ear.style.setProperty("--loud", String(1 + Math.min(0.9, level * 8)));
    const hold = byId<HTMLInputElement>("hold");
    hold.addEventListener("change", () => app.paint.setHold(hold.checked ? Math.round(TIME_MAX * 0.32) : null));
    // A click beside the sheet puts it away, like a click beside any open box.
    byId("easel").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.paint.close();
    });
  }

  /** The ring's own sound in the panel, the paint box and its shelf. */
  sync(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const bild = settings.bild;

    this.panels.own.pick.setAttribute("aria-pressed", String(settings.sound === OWN_SOUND));
    this.panels.own.pick.title = bild ? "Play this ring's own sound (one more click opens the paint box)" : "Paint a sound of its own for this ring";
    this.panels.own.label.textContent = bild ? "Own sound" : "Paint own sound";
    const signature = `${track}|${bild ? packBild(bild) : ""}`;
    if (signature !== this.thumbSignature) {
      this.thumbSignature = signature;
      renderThumb(this.panels.own.thumb, bild, info.color);
    }

    const open = app.paint.isOpen;
    byId("easel").hidden = !open;
    byId("brushes").hidden = !open;
    // The piece has two tools of its own (see piece-panel.ts).
    byId("tools").hidden = open || app.body.isOpen || app.weather.focused || app.piece.focused;
    if (open && !this.easelOpen) {
      // The first hint is about the rings, and where the panel sits below the wheel, the sheet opens out of sight.
      this.panels.endTour();
      byId("stage").scrollIntoView({ block: "nearest" });
    }
    this.easelOpen = open;
    if (!open) return;
    byId("easel").style.setProperty("--c", info.color);
    byId("easel-title").textContent = `Painted sound: ${info.name}`;
    byId("hold-box").hidden = !info.melodic;
    byId<HTMLInputElement>("hold").checked = bild?.hold !== null && bild?.hold !== undefined;
    byId("bild-empty").hidden = (bild?.strokes.length ?? 0) > 0 || app.paint.listening !== null;
    this.brushButtons.forEach((node, index) => node.setAttribute("aria-checked", String(index === app.paint.brush)));
    this.sizeDots.dataset.size = String(app.paint.brushSize);
    byId("listening").hidden = !app.paint.listening;
    byId("listening-text").textContent = app.paint.listening ?? "";
    byId("bild-listen").setAttribute("aria-pressed", String(app.paint.listening !== null));

    const shelfSignature = app.paint.kept.map((item) => item.bild).join("|");
    if (shelfSignature !== this.shelfSignature) {
      this.shelfSignature = shelfSignature;
      const shelf = byId("shelf");
      const items: HTMLElement[] = [app.paint.kept.length > 0 ? el("span", "shelf-label", "Shelf") : el("span", "shelf-label empty", "The shelf is empty. “Keep” puts a picture away: for other rings and for the next Kreisel.")];
      app.paint.kept.forEach((item, index) => {
        const holder = el("span", "kept");
        const pick = button("kept-pick", "", `Take from the shelf into this ring (painted for ${trackInfo(item.ring).name})`);
        pick.setAttribute("aria-label", `Kept sound ${index + 1}, painted for ${trackInfo(item.ring).name}`);
        const thumb = el("canvas", "thumb");
        pick.append(thumb);
        pick.addEventListener("click", () => app.paint.useKept(index));
        const drop = button("kept-drop", "×", "Take off the shelf");
        drop.setAttribute("aria-label", `Take kept sound ${index + 1} off the shelf`);
        drop.addEventListener("click", () => app.paint.dropKept(index));
        holder.append(pick, drop);
        items.push(holder);
        // The canvas needs its place on the page before it knows its size.
        requestAnimationFrame(() => renderThumb(thumb, unpackBild(item.bild), trackInfo(item.ring).color));
      });
      shelf.replaceChildren(...items);
    }
  }
}

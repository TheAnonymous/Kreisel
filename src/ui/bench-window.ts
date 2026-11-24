import type { App } from "../app/app";
import { MALLETS } from "../app/body";
import { BODY_NAMES, materialName, TIGHT_NAMES } from "../body";
import { BODY_SOUND, trackInfo, trackOf } from "../model";
import { renderBodyThumb, type BenchView } from "./bench";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/** What sets a body going: soft mallet, hard mallet, a plucking pick, a bow, breath. */
const MALLET_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 13.5 20 4"/><circle cx="7.5" cy="16.5" r="4.4"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 20 4"/><circle cx="6.5" cy="17.5" r="2.6" class="fill"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 6 9.5c2-4.6 10-4.6 12 0z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.5 21 6.5M4.5 20.5 21 10.5"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h10.5a2.8 2.8 0 1 0-2.8-2.8M3 15h13.5a2.8 2.8 0 1 1-2.8 2.8M3 12h6"/></svg>',
];

/*
 * The workbench's window around the body on it (bench.ts): the kinds of body, what sets it going, size, tension and material.
 */
export class BenchWindow {
  private builtSignature = "";
  private benchOpen = false;
  readonly malletButtons: HTMLButtonElement[] = [];
  private readonly kindButtons: HTMLButtonElement[] = [];
  private readonly shape = { size: el("input"), tight: el("input"), material: el("input"), tightName: el("span", "label"), materialName: el("span", "label") };

  constructor(private readonly panels: Panels, private readonly app: App, private readonly bench: BenchView) {}

  /** The workbench: the kinds of body, the three ways to shape one, and what sets it going (in the tools' place). */
  build(): void {
    const app = this.app;
    const mallets = byId("mallets");
    MALLETS.forEach((mallet, index) => {
      const node = button("tool", "", mallet.hint);
      node.innerHTML = MALLET_ICONS[index] ?? "";
      node.append(el("span", "name", mallet.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => {
        app.body.shape({ exciter: index });
        app.body.hear();
      });
      mallets.append(node);
      this.malletButtons.push(node);
    });
    const kinds = byId("bench-kinds");
    BODY_NAMES.forEach((name, kind) => {
      const chip = button("chip", name);
      chip.addEventListener("click", () => {
        app.body.shape({ kind });
        app.body.hear();
      });
      kinds.append(chip);
      this.kindButtons.push(chip);
    });

    const holder = byId("bench-shape");
    const shaper = (input: HTMLInputElement, label: HTMLElement, field: "size" | "tight" | "material", title: string): void => {
      const line = el("label", "line");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.title = title;
      this.panels.slider(input, () => app.body.current?.[field] ?? 0.5, (value) => app.body.shape({ [field]: value }, field), () => app.body.shape({ [field]: 0.5 }));
      // Let go of the slider, the body says how it sounds now.
      input.addEventListener("change", () => app.body.hear());
      line.append(label, input);
      holder.append(line);
    };
    shaper(this.shape.size, el("span", "label", "Size"), "size", "Big sounds deep and long, small high and short (also with the mouse wheel over the body)");
    shaper(this.shape.tight, this.shape.tightName, "tight", "Tighter, thicker, narrower: brighter and shorter (also with Shift and the mouse wheel)");
    shaper(this.shape.material, this.shape.materialName, "material", "Material, from wood through metal to glass: how long it rings on");

    byId("bench-done").addEventListener("click", () => app.body.close());
    byId("bench-dice").addEventListener("click", () => app.body.dice());
    // A click beside the bench puts it away, like a click beside any open box.
    byId("bench").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.body.close();
    });
  }

  /** The ring's body in the panel, and the workbench. */
  sync(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const body = settings.body;
    // A body that is gone (taken back) has no bench to stand on.
    if (app.body.isOpen && !body) app.body.close();

    this.panels.built.pick.setAttribute("aria-pressed", String(settings.sound === BODY_SOUND));
    this.panels.built.pick.title = body ? "Play this ring's body (one more click opens the workbench)" : "Build a body for this ring";
    this.panels.built.label.textContent = body ? `Body: ${BODY_NAMES[body.kind]}` : "Build a body";
    const signature = `${track}|${body ? `${body.kind}.${body.material}.${body.tight}.${body.exciter}.${body.where}` : ""}`;
    if (signature !== this.builtSignature) {
      this.builtSignature = signature;
      renderBodyThumb(this.panels.built.thumb, body, info.color);
    }

    const open = app.body.isOpen && body !== null;
    byId("bench").hidden = !open;
    byId("mallets").hidden = !open;
    if (open && !this.benchOpen) {
      this.panels.endTour();
      byId("stage").scrollIntoView({ block: "nearest" });
    }
    this.benchOpen = open;
    if (!open || !body) return;
    byId("bench").style.setProperty("--c", info.color);
    byId("bench-title").textContent = `Body: ${info.name}`;
    this.malletButtons.forEach((node, index) => node.setAttribute("aria-checked", String(index === body.exciter)));
    this.kindButtons.forEach((node, kind) => node.setAttribute("aria-pressed", String(kind === body.kind)));
    this.shape.tightName.textContent = TIGHT_NAMES[body.kind] ?? "Tension";
    this.shape.materialName.textContent = `Material: ${materialName(body.material)}`;
  }
}

import type { App } from "../app/app";
import { clamp, currentScene, MAX_CHORDS } from "../model";
import { chordName, chordRoman } from "../music";
import type { RingView } from "./ring";
import { byId, el, button } from "./dom";

/*
 * The menu of a chord field: the seven chords of the key, and the bar itself.
 */
export class ChordMenu {
  private chordSignature = "";

  constructor(private readonly app: App, private readonly ring: RingView) {}

  sync(): void {
    const app = this.app;
    const menu = byId("chord-menu");
    const slot = app.chords.openSlot;
    if (slot === null) {
      menu.hidden = true;
      this.chordSignature = "";
      return;
    }
    const project = app.project;
    const chords = currentScene(project).chords;
    const signature = `${slot}|${chords.join(",")}|${project.root}|${project.scale}`;
    if (signature !== this.chordSignature) {
      this.chordSignature = signature;
      const head = el("header");
      const close = button("button icon small", "×");
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", () => app.chords.close());
      head.append(el("strong", "", `Bar ${slot + 1} of ${chords.length}`), close);
      const grid = el("div", "chord-grid");
      for (let degree = 0; degree < 7; degree += 1) {
        const choice = button("chord", "");
        choice.append(el("b", "", chordName(project.root, project.scale, degree)), el("small", "", chordRoman(project.scale, degree)));
        choice.setAttribute("aria-pressed", String(chords[slot] === degree));
        choice.addEventListener("click", () => app.chords.set(slot, degree));
        grid.append(choice);
      }
      const bars = el("div", "line");
      const less = button("button icon small", "−", "One bar fewer");
      less.disabled = chords.length <= 1;
      less.addEventListener("click", () => app.chords.setBars(chords.length - 1));
      const more = button("button icon small", "+", "One bar more");
      more.disabled = chords.length >= MAX_CHORDS;
      more.addEventListener("click", () => app.chords.setBars(chords.length + 1));
      bars.append(el("span", "label", "Bars"), less, el("output", "", String(chords.length)), more);
      menu.replaceChildren(head, grid, bars);
    }
    menu.hidden = false;
    const stage = byId("stage").getBoundingClientRect();
    const at = this.ring.slotPosition(slot);
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${clamp(at.x - stage.left - width / 2, 4, Math.max(4, stage.width - width - 4))}px`;
    const below = at.y - stage.top + 18;
    menu.style.top = `${below + height > stage.height - 4 ? Math.max(4, at.y - stage.top - height - 18) : below}px`;
  }
}

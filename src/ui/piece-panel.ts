import type { App } from "../app/app";
import { MAX_BARS, MIN_BARS, trackInfo } from "../model";
import { barCount, describePiece } from "../piece";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/*
 * The panel of the piece's ring: on and off, its length, dice, and the order in which the rings come in.
 */
export class PiecePanel {
  private readonly pieceParts = { info: el("p", "info"), on: el("input"), bars: el("output"), order: el("ol", "entries") };
  private orderSignature = "";
  private pieceFocused = false;

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** The panel of the piece: what the outermost ring is, its length, and the order in which the rings come in. */
  build(): void {
    const app = this.app;
    const parts = this.pieceParts;
    const head = el("header", "panel-head");
    head.append(el("span", "dot"), el("h2", "", "Stück"));

    const doing = el("div", "doing");
    const roll = button("button small", "Würfeln", "Einen neuen Verlauf würfeln (N)");
    roll.addEventListener("click", () => app.piece.dice());
    const smooth = button("button small", "Glätten", "Die Linie abrunden: steile Stufen werden sanfter");
    smooth.addEventListener("click", () => app.piece.smooth());
    const top = button("button small", "Von vorn", "Das Stück beginnt wieder beim ersten Takt");
    top.id = "piece-top";
    top.addEventListener("click", () => app.piece.seek(0));
    doing.append(roll, smooth, top);

    const on = el("label", "check");
    parts.on.type = "checkbox";
    parts.on.id = "piece-on";
    parts.on.addEventListener("change", () => app.piece.toggle());
    on.append(parts.on, el("span", "", "Nach dem Stück spielen"));

    const length = el("div", "group");
    const line = el("div", "line");
    const less = button("button icon small", "−", "Vier Takte kürzer");
    less.setAttribute("aria-label", "Vier Takte kürzer");
    less.addEventListener("click", () => app.piece.resize(barCount(app.project.piece) - 4));
    const more = button("button icon small", "+", "Vier Takte länger");
    more.setAttribute("aria-label", "Vier Takte länger");
    more.addEventListener("click", () => app.piece.resize(barCount(app.project.piece) + 4));
    const quick = el("span", "quick");
    for (const bars of [32, 64, 128, 256]) {
      const chip = button("chip tiny", String(bars), `${bars} Takte`);
      chip.addEventListener("click", () => app.piece.resize(bars));
      quick.append(chip);
    }
    line.append(el("span", "label", "Takte"), less, parts.bars, more, quick);
    length.append(line);

    const order = el("div", "group");
    order.append(el("h3", "", "Wer zuerst einsetzt"), parts.order);

    const hint = el("p", "easel-hint", "Mal die Spannung in den äußeren Ring: außen ist viel los, innen wenig. Die farbigen Linien zeigen, ab wo ein Ring mitspielt. Vor einem steilen Anstieg nimmt der Kreisel Anlauf. Am inneren Rand liegen die Szenen: links eine wählen, dann dort malen. Ein Rechtsklick auf einen Takt spielt ab dort, legt eine Szene hin oder ändert die Spannung.");

    const save = button("button small", "Als Opus speichern", "Das Stück einmal rundherum als Opus-Datei");
    save.addEventListener("click", () => void app.files.exportSound());

    this.panels.pieceBox.append(head, parts.info, on, doing, length, order, hint, save);
  }

  /** The piece in the list of rings and in its panel. */
  sync(): void {
    const app = this.app;
    const piece = app.project.piece;
    const count = barCount(piece);
    this.panels.pieceRow.classList.toggle("selected", app.piece.focused);
    this.panels.pieceRow.classList.toggle("silent", !piece.on);
    this.panels.pieceRow.querySelector(".sound")!.textContent = `${count} Takte`;
    this.panels.pieceRow.querySelector(".pick")!.setAttribute("aria-pressed", String(app.piece.focused));
    const toggle = this.panels.pieceRow.querySelector<HTMLButtonElement>(".piece-toggle")!;
    toggle.textContent = piece.on ? "an" : "aus";
    toggle.setAttribute("aria-pressed", String(piece.on));
    toggle.setAttribute("aria-label", piece.on ? "Das Stück spielt: ausschalten" : "Nach dem Stück spielen");

    this.panels.ringBox.hidden = app.piece.focused;
    this.panels.pieceBox.hidden = !app.piece.focused;
    // The piece is painted on the wheel: where the list sits below it, bring the wheel into view.
    if (app.piece.focused && !this.pieceFocused) byId("stage").scrollIntoView({ block: "nearest" });
    this.pieceFocused = app.piece.focused;
    if (!app.piece.focused) return;
    const parts = this.pieceParts;
    parts.info.textContent = describePiece(piece, app.project.bpm);
    parts.on.checked = piece.on;
    parts.bars.textContent = String(count);
    for (const node of this.panels.pieceBox.querySelectorAll<HTMLButtonElement>(".line .button")) {
      if (node.textContent === "−") node.disabled = count <= MIN_BARS;
      if (node.textContent === "+") node.disabled = count >= MAX_BARS;
    }
    const signature = piece.order.join("");
    if (signature !== this.orderSignature) {
      this.orderSignature = signature;
      parts.order.replaceChildren(...piece.order.map((ring, place) => {
        const info = trackInfo(ring);
        const item = el("li", "entry");
        item.style.setProperty("--c", info.color);
        const earlier = button("button icon small", "↑", `${info.name} früher einsetzen lassen`);
        earlier.setAttribute("aria-label", `${info.name} früher einsetzen lassen`);
        earlier.disabled = place === 0;
        earlier.addEventListener("click", () => app.piece.moveEntry(ring, -1));
        const later = button("button icon small", "↓", `${info.name} später einsetzen lassen`);
        later.setAttribute("aria-label", `${info.name} später einsetzen lassen`);
        later.disabled = place === piece.order.length - 1;
        later.addEventListener("click", () => app.piece.moveEntry(ring, 1));
        item.append(el("span", "dot"), el("span", "name", info.name), earlier, later);
        return item;
      }));
    }
  }
}

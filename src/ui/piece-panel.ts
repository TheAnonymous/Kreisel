import type { App } from "../app/app";
import type { PieceTool } from "../app/piece";
import { MAX_BARS, MIN_BARS, trackInfo, type RunUp } from "../model";
import { barCount, describePiece } from "../piece";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/** The piece's two tools, which take the ring tools' place beside the wheel while the piece is in focus. */
const PIECE_TOOLS: readonly { id: PieceTool; name: string; hint: string; icon: string }[] = [
  { id: "spannung", name: "Spannung", hint: "Die Spannung in den äußeren Ring malen; die sieben Ringe zeigen ihre Schritte", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c3.5 0 4-9 8-9s3.5 5 6 5 3-7 4-7"/></svg>' },
  { id: "einsaetze", name: "Einsätze", hint: "Die sieben Ringe zeigen das ganze Stück: wer in welchen acht Takten spielt. Ein Klick schaltet es um", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M16 7h4M4 12h4M11 12h9M4 17h13"/></svg>' },
];

const HINTS: Record<PieceTool, string> = {
  spannung: "Mal die Spannung in den äußeren Ring: außen ist viel los, innen wenig. Die farbigen Linien zeigen, ab wo ein Ring mitspielt. Vor einem steilen Anstieg nimmt der Kreisel Anlauf. Am inneren Rand liegen die Szenen: links eine wählen, dann dort malen. Ein Rechtsklick auf einen Takt spielt ab dort, legt eine Szene hin, ändert die Spannung oder macht einen Break.",
  einsaetze: "Die sieben Ringe zeigen das ganze Stück: gefüllt heißt, der Ring spielt dort. Ein Klick schaltet das für acht Takte um, ziehen malt weiter. Heller Rand und gestrichelte Linie zeigen, wo du die Spannung überstimmst.",
};

/*
 * The panel of the piece's ring: on and off, its length, dice, and the order in which the rings come in.
 * And the piece's two tools beside the wheel.
 */
export class PiecePanel {
  private readonly pieceParts = { info: el("p", "info"), on: el("input"), bars: el("output"), order: el("ol", "entries") };
  /** What the piece does by itself: the three parts of a build-up before a drop, and the fills. */
  private readonly runUps: [part: keyof RunUp, chip: HTMLButtonElement][] = [
    ["roll", button("chip", "Roll", "Snare-Roll: In den letzten zwei Takten vor dem Drop spielt der Ring der Snare Viertel, dann Achtel, dann Sechzehntel, immer lauter")],
    ["kick", button("chip", "ohne Kick", "Im letzten Takt vor dem Drop setzen die Kick und ihr Nachbeben aus")],
    ["hat", button("chip", "ohne Hi-Hat", "Im letzten Takt vor dem Drop setzt die Hi-Hat aus")],
  ];
  private readonly vary = button("chip", "alle 8 Takte", "Fills: Jeder achte Takt endet mit einer Kick mehr, jeder sechzehnte dazu mit zwei Schlägen der Trommel");
  /** The piece's tools beside the wheel, in the order of PIECE_TOOLS. */
  readonly toolButtons: HTMLButtonElement[] = [];
  /** What can be done with the roster as a whole; shown while the rings show it. */
  private readonly roster = el("div", "line");
  private readonly hint = el("p", "easel-hint");
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

    // What the piece does by itself. The drop is a bar that is much higher than the one before, or the one in which the kick comes back.
    const moves = el("div", "group moves");
    moves.id = "piece-moves";
    const before = el("div", "line");
    before.append(el("span", "label", "Build-up"));
    for (const [part, chip] of this.runUps) {
      chip.id = `piece-${part}`;
      chip.addEventListener("click", () => app.piece.toggleRunUp(part));
      before.append(chip);
    }
    this.vary.id = "piece-vary";
    this.vary.addEventListener("click", () => app.piece.toggleVary());
    this.vary.setAttribute("aria-label", "Fills alle acht Takte");
    const also = el("div", "line");
    also.append(el("span", "label", "Fills"), this.vary);
    const fill = button("chip", "alle spielen", "Alle sieben Ringe spielen im ganzen Stück, was auch die Spannung sagt: der Anfang, um wegzunehmen");
    fill.id = "roster-fill";
    fill.addEventListener("click", () => app.piece.fillRoster(null));
    const clear = button("chip", "nach Spannung", "Im ganzen Stück entscheidet wieder die Spannung, wer spielt; auch Breaks gehen");
    clear.id = "roster-clear";
    clear.addEventListener("click", () => app.piece.clearRoster(null));
    this.roster.id = "piece-roster";
    this.roster.append(el("span", "label", "Einsätze"), fill, clear);
    moves.append(before, also, this.roster);

    const tools = byId("piece-tools");
    for (const tool of PIECE_TOOLS) {
      const node = button("tool", "", tool.hint);
      node.innerHTML = tool.icon;
      node.append(el("span", "name", tool.name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.dataset.tool = tool.id;
      node.addEventListener("click", () => app.piece.setTool(tool.id));
      tools.append(node);
      this.toolButtons.push(node);
    }

    const order = el("div", "group");
    order.append(el("h3", "", "Wer zuerst einsetzt"), parts.order);

    const save = button("button small", "Als Opus speichern", "Das Stück einmal rundherum als Opus-Datei");
    save.addEventListener("click", () => void app.files.exportSound());

    this.panels.pieceBox.append(head, parts.info, on, doing, length, moves, order, this.hint, save);
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
    byId("piece-tools").hidden = !app.piece.focused;
    if (!app.piece.focused) return;
    PIECE_TOOLS.forEach((tool, index) => this.toolButtons[index]?.setAttribute("aria-checked", String(tool.id === app.piece.tool)));
    this.roster.hidden = !app.piece.laying;
    const hint = HINTS[app.piece.tool];
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    const parts = this.pieceParts;
    parts.info.textContent = describePiece(piece, app.project.bpm);
    parts.on.checked = piece.on;
    parts.bars.textContent = String(count);
    for (const [part, chip] of this.runUps) chip.setAttribute("aria-pressed", String(piece.runUp?.[part] ?? false));
    this.vary.setAttribute("aria-pressed", String(piece.vary ?? false));
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

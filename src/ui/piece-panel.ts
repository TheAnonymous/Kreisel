import type { App } from "../app/app";
import type { PieceTool } from "../app/piece";
import { MAX_BARS, MIN_BARS, TENSION_MAX, trackInfo } from "../model";
import { barCount, describeBuild, describePiece, sizeName } from "../piece";
import { byId, el, button } from "./dom";
import { onContext } from "./menu";
import { swayName } from "./menus";
import type { Panels } from "./panels";

/** The piece's two tools, which take the ring tools' place beside the wheel while the piece is in focus. */
const PIECE_TOOLS: readonly { id: PieceTool; name: string; hint: string; icon: string }[] = [
  { id: "spannung", name: "Tension", hint: "Paint the tension into the outer ring; the seven rings show their steps", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c3.5 0 4-9 8-9s3.5 5 6 5 3-7 4-7"/></svg>' },
  { id: "einsaetze", name: "Roster", hint: "The seven rings show the whole piece: who plays in which eight bars. A click switches it", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M16 7h4M4 12h4M11 12h9M4 17h13"/></svg>' },
];

const HINTS: Record<PieceTool, string> = {
  spannung: "Paint the tension into the outer ring: a lot is going on outside, little inside. A red wedge at the rim is a drop, a click on it sets its build-up. The scenes lie at the inner rim. A right click on a bar shows what can be done there.",
  einsaetze: "The seven rings show the whole piece: filled means the ring plays there. A click switches eight bars, dragging paints on. A bright rim and a dashed line: there you overrule the tension.",
};

/*
 * The panel of the piece's ring: on and off, its length, dice, and the order in which the rings come in.
 * And the piece's two tools beside the wheel.
 */
export class PiecePanel {
  private readonly pieceParts = { info: el("p", "info"), on: el("input"), bars: el("output"), order: el("ol", "entries") };
  /** What the piece does by itself: the build-up before its drops (the button opens the kit for all of them), and the fills. */
  private readonly kit = button("chip", "all drops: small ▾", "");
  /** What the tension moves beyond who plays: the button opens the list. */
  /** What else happens at the ends of the phrases: the button opens the list. */
  private readonly ends = button("chip", "Phrase ends ▾", "What happens by itself at the ends of the phrases: fills, the last kick left out, a crash on the one, a backwards cymbal");
  private readonly sway = button("chip", "only the roster ▾", "What the tension moves beside the roster: hi-hat, brightness, kick, density, drive and room, each off, gently or clearly");
  private readonly vary = button("chip", "every 8 bars", "Fills: every eighth bar ends with one more kick, every sixteenth with two strokes of the drum as well");
  /** The piece's tools beside the wheel, in the order of PIECE_TOOLS. */
  readonly toolButtons: HTMLButtonElement[] = [];
  /** What can be done with the roster as a whole; shown while the rings show it. */
  private readonly roster = el("div", "line");
  private readonly hint = el("p", "easel-hint");
  /** "Play in": the hand on the tension while the piece plays. */
  private readonly ride = button("tool", "", "Play in: while the piece runs, the tension follows the mouse wheel or the arrow keys ↑ ↓ and is written into the line bar by bar");
  private orderSignature = "";
  private pieceFocused = false;

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** The panel of the piece: what the outermost ring is, its length, and the order in which the rings come in. */
  build(): void {
    const app = this.app;
    const parts = this.pieceParts;
    const head = el("header", "panel-head");
    head.append(el("span", "dot"), el("h2", "", "Piece"));

    const doing = el("div", "doing");
    const roll = button("button small", "Dice", "Dice a new course (N) · right click: pick a shape (Plateau, Two drops, Waves, Long climb)");
    roll.id = "piece-dice";
    roll.addEventListener("click", () => app.piece.dice());
    // The right button on the dice shows the piece's menu, where the shapes are.
    onContext(roll, (x, y, byKeyboard) => app.openContext({ kind: "piece", bar: null }, x, y, byKeyboard));
    const smooth = button("button small", "Smooth", "Round the line off: steep steps get gentler");
    smooth.addEventListener("click", () => app.piece.smooth());
    const top = button("button small", "From the top", "The piece starts at the first bar again");
    top.id = "piece-top";
    top.addEventListener("click", () => app.piece.seek(0));
    doing.append(roll, smooth, top);

    const on = el("label", "check");
    parts.on.type = "checkbox";
    parts.on.id = "piece-on";
    parts.on.addEventListener("change", () => app.piece.toggle());
    on.append(parts.on, el("span", "", "Play by the piece"));

    const length = el("div", "group");
    const line = el("div", "line");
    const less = button("button icon small", "−", "Four bars shorter");
    less.setAttribute("aria-label", "Four bars shorter");
    less.addEventListener("click", () => app.piece.resize(barCount(app.project.piece) - 4));
    const more = button("button icon small", "+", "Four bars longer");
    more.setAttribute("aria-label", "Four bars longer");
    more.addEventListener("click", () => app.piece.resize(barCount(app.project.piece) + 4));
    const quick = el("span", "quick");
    for (const bars of [32, 64, 128, 256]) {
      const chip = button("chip tiny", String(bars), `${bars} bars`);
      chip.addEventListener("click", () => app.piece.resize(bars));
      quick.append(chip);
    }
    line.append(el("span", "label", "Bars"), less, parts.bars, more, quick);
    length.append(line);

    // What the piece does by itself. The drop is a bar that is much higher than the one before, or the one in which the kick comes back.
    const moves = el("div", "group moves");
    moves.id = "piece-moves";
    const before = el("div", "line");
    before.append(el("span", "label", "Build-up"));
    this.kit.id = "piece-build";
    this.kit.setAttribute("aria-haspopup", "menu");
    this.kit.setAttribute("aria-expanded", "false");
    this.kit.addEventListener("click", (event) => this.panels.onMenuUnder(this.kit, { kind: "build", drop: null }, event.detail === 0));
    before.append(this.kit);
    this.sway.id = "piece-sway";
    this.sway.setAttribute("aria-haspopup", "menu");
    this.sway.setAttribute("aria-expanded", "false");
    this.sway.addEventListener("click", (event) => this.panels.onMenuUnder(this.sway, { kind: "sway" }, event.detail === 0));
    const moved = el("div", "line");
    moved.append(el("span", "label", "Moves"), this.sway);
    this.vary.id = "piece-vary";
    this.vary.addEventListener("click", () => app.piece.toggleVary());
    this.vary.setAttribute("aria-label", "Fills every eight bars");
    this.ends.id = "piece-ends";
    this.ends.setAttribute("aria-haspopup", "menu");
    this.ends.setAttribute("aria-expanded", "false");
    this.ends.addEventListener("click", (event) => this.panels.onMenuUnder(this.ends, { kind: "ends" }, event.detail === 0));
    const also = el("div", "line");
    also.append(el("span", "label", "Fills"), this.vary, this.ends);
    const fill = button("chip", "all play", "All seven rings play through the whole piece, whatever the tension says: the start for taking away");
    fill.id = "roster-fill";
    fill.addEventListener("click", () => app.piece.fillRoster(null));
    const clear = button("chip", "by tension", "Through the whole piece the tension decides again who plays; breaks go too");
    clear.id = "roster-clear";
    clear.addEventListener("click", () => app.piece.clearRoster(null));
    this.roster.id = "piece-roster";
    this.roster.append(el("span", "label", "Roster"), fill, clear);
    moves.append(moved, before, also, this.roster);

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

    this.ride.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 3v3M12 18v3"/></svg>';
    this.ride.append(el("span", "name", "Play in"), el("kbd", "key"));
    this.ride.id = "piece-ride";
    this.ride.setAttribute("aria-pressed", "false");
    this.ride.addEventListener("click", () => app.piece.toggleRide());
    tools.append(this.ride);
    this.toolButtons.push(this.ride);

    const order = el("div", "group");
    order.append(el("h3", "", "Who comes in first"), parts.order);

    const save = button("button small", "Save as Opus", "The piece once around as an Opus file");
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
    this.panels.pieceRow.querySelector(".sound")!.textContent = `${count} bars`;
    this.panels.pieceRow.querySelector(".pick")!.setAttribute("aria-pressed", String(app.piece.focused));
    const toggle = this.panels.pieceRow.querySelector<HTMLButtonElement>(".piece-toggle")!;
    toggle.textContent = piece.on ? "on" : "off";
    toggle.setAttribute("aria-pressed", String(piece.on));
    toggle.setAttribute("aria-label", piece.on ? "The piece plays: switch it off" : "Play by the piece");

    this.panels.ringBox.hidden = app.piece.focused;
    this.panels.pieceBox.hidden = !app.piece.focused;
    // The piece is painted on the wheel: where the list sits below it, bring the wheel into view.
    if (app.piece.focused && !this.pieceFocused) byId("stage").scrollIntoView({ block: "nearest" });
    this.pieceFocused = app.piece.focused;
    byId("piece-tools").hidden = !app.piece.focused;
    if (!app.piece.focused) return;
    PIECE_TOOLS.forEach((tool, index) => this.toolButtons[index]?.setAttribute("aria-checked", String(tool.id === app.piece.tool)));
    this.roster.hidden = !app.piece.laying;
    this.ride.setAttribute("aria-pressed", String(app.piece.riding));
    const hint = app.piece.riding
      ? `Play in: ${Math.round((app.piece.hand / TENSION_MAX) * 100)} % tension. The mouse wheel or ↑ ↓ change it while the piece runs; it is written into the line bar by bar.`
      : HINTS[app.piece.tool];
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    const parts = this.pieceParts;
    parts.info.textContent = describePiece(piece, app.project.bpm);
    parts.on.checked = piece.on;
    parts.bars.textContent = String(count);
    const all = app.piece.build(null);
    const own = app.piece.ownBuilds;
    const label = `all drops: ${sizeName(all)} ▾`;
    if (this.kit.textContent !== label) this.kit.textContent = label;
    const title = `The build-up before every drop: ${describeBuild(all).replace(/^Build-up /, "")}. ${own > 0 ? `${own === 1 ? "One drop has" : `${own} drops have`} a separate build-up: the wedge on the piece's ring sets it. ` : ""}A drop is a bar in which the tension jumps or the kick comes back from a break.`;
    if (this.kit.title !== title) this.kit.title = title;
    this.vary.setAttribute("aria-pressed", String(piece.vary ?? false));
    const ending = app.piece.endsCount === 0 ? "Phrase ends ▾" : `Phrase ends: ${app.piece.endsCount} ▾`;
    if (this.ends.textContent !== ending) this.ends.textContent = ending;
    const moving = `${swayName(app.piece.swayCount)} ▾`;
    if (this.sway.textContent !== moving) this.sway.textContent = moving;
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
        const earlier = button("button icon small", "↑", `Let ${info.name} come in earlier`);
        earlier.setAttribute("aria-label", `Let ${info.name} come in earlier`);
        earlier.disabled = place === 0;
        earlier.addEventListener("click", () => app.piece.moveEntry(ring, -1));
        const later = button("button icon small", "↓", `Let ${info.name} come in later`);
        later.setAttribute("aria-label", `Let ${info.name} come in later`);
        later.disabled = place === piece.order.length - 1;
        later.addEventListener("click", () => app.piece.moveEntry(ring, 1));
        item.append(el("span", "dot"), el("span", "name", info.name), earlier, later);
        return item;
      }));
    }
  }
}

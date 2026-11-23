import { clamp, TENSION_MAX, TRACK_COUNT, trackInfo, type RunUp, wrap } from "../model";
import { barCount, clearRoster, dicePiece, fillRoster, flipped, kickOut, moveInOrder, PHRASE, phraseOf, reached, resizePiece, ROSTER, rosterOf, rotatePiece, setKick, setRoster, setRunUp, setVary, smoothPiece, type RosterState } from "../piece";
import type { App } from "./app";

/** What the wheel shows of the piece while its ring is in focus: the tension to paint, or the roster ("Einsätze") to lay. */
export type PieceTool = "spannung" | "einsaetze";

/*
 * The piece: the outermost ring, where one turn is the whole piece.
 */
export class PieceDesk {
  /** The bar a piece starts from. */
  start = 0;
  /** The bar the keyboard points at on the piece's ring. */
  key: number | null = null;
  /** What the wheel shows of the piece while its ring is in focus. */
  tool: PieceTool = "spannung";
  /** The ring the keyboard points at in the roster. */
  lane = 0;

  constructor(private readonly app: App) {}

  /** The piece's ring is in focus instead of one of the seven. */
  get focused(): boolean {
    return this.app.focus === "piece";
  }

  playhead(): number | null {
    return this.app.engine.pieceCursor();
  }

  /** The seven rings show the roster: who plays in which phrase of the piece. */
  get laying(): boolean {
    return this.focused && this.tool === "einsaetze";
  }

  setTool(tool: PieceTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.app.notify();
  }

  /** Puts the piece's ring in focus: it widens, and the panel shows the piece. */
  focus(): void {
    this.app.turnTo("piece");
  }

  /** Switches between looping the scene on the table and playing by the piece. */
  toggle(): void {
    const on = !this.app.project.piece.on;
    this.app.store.edit((project) => { project.piece.on = on; });
    if (on) this.app.say("Der Kreisel spielt jetzt nach dem Stück-Ring: außen ist viel los, innen wenig. Mal die Spannung in den Ring.");
  }

  paintTension(bar: number, tension: number, gesture: string): void {
    const target = clamp(Math.round(tension), 0, TENSION_MAX);
    if (this.app.project.piece.tension[bar] === undefined || this.app.project.piece.tension[bar] === target) return;
    this.app.store.edit((project) => { project.piece.tension[bar] = target; }, gesture, Infinity);
  }

  paintScene(bar: number, gesture: string): void {
    const scene = this.app.project.scene;
    if (this.app.project.piece.scenes[bar] === undefined || this.app.project.piece.scenes[bar] === scene) return;
    this.app.store.edit((project) => { project.piece.scenes[bar] = scene; }, gesture, Infinity);
  }

  rotate(by: number): void {
    this.app.store.edit((project) => rotatePiece(project.piece, by), "stueck-drehen");
  }

  /** Lays a scene on the four bars around `bar` (the piece is ticked in fours), or on the whole piece. */
  sceneForBars(bar: number, scene: number, whole = false): void {
    if (!this.app.project.scenes[scene]) return;
    const from = whole ? 0 : Math.floor(bar / 4) * 4;
    const to = whole ? barCount(this.app.project.piece) : from + 4;
    this.app.store.edit((project) => {
      for (let index = from; index < to && index < project.piece.scenes.length; index += 1) project.piece.scenes[index] = scene;
    });
  }

  /**
   * A break: lets the kick stay out of the phrase around `bar` (eight bars), or play there again.
   * Without `plays` it turns around what the bar itself has.
   */
  kickForPhrase(bar: number, plays?: boolean): void {
    const piece = this.app.project.piece;
    if (bar < 0 || bar >= barCount(piece)) return;
    const { from, to } = phraseOf(piece, bar);
    const next = plays ?? kickOut(piece, bar);
    this.app.store.edit((project) => setKick(project.piece, from, to, next));
    this.app.say(next ? `Takt ${from + 1} bis ${to} wieder mit Kick.` : `Break in Takt ${from + 1} bis ${to}: Kick und Nachbeben setzen aus, alles andere spielt nach der Spannung.`);
  }

  /**
   * A click in the roster: turns around whether ring `ring` plays in the phrase around `bar`, and says which state
   * that made, so that a stroke can go on with it.
   */
  flipRoster(ring: number, bar: number, gesture?: string): RosterState | null {
    const piece = this.app.project.piece;
    if (bar < 0 || bar >= barCount(piece) || ring < 0 || ring >= TRACK_COUNT) return null;
    const state = flipped(piece, ring, bar);
    this.layRoster(ring, bar, state, gesture);
    return state;
  }

  /** Lays ring `ring` in or out for the phrase around `bar`, or gives it back to the tension there. */
  layRoster(ring: number, bar: number, state: RosterState, gesture?: string): void {
    const piece = this.app.project.piece;
    if (bar < 0 || bar >= barCount(piece) || ring < 0 || ring >= TRACK_COUNT) return;
    const { from, to } = phraseOf(piece, bar);
    let there = true;
    for (let at = from; at < to; at += 1) there &&= rosterOf(piece, ring, at) === state;
    if (there) return;
    this.app.store.edit((project) => setRoster(project.piece, ring, from, to, state), gesture, Infinity);
  }

  /** Every ring plays in the phrase around `bar`, or in the whole piece: the place to begin taking things away from. */
  fillRoster(bar: number | null): void {
    const piece = this.app.project.piece;
    const { from, to } = bar === null ? { from: 0, to: barCount(piece) } : phraseOf(piece, bar);
    this.app.store.edit((project) => fillRoster(project.piece, from, to));
    if (bar === null) this.app.say("Alle Ringe spielen jetzt im ganzen Stück. Nimm weg, was nicht spielen soll.", this.app.takeBack);
  }

  /** The tension decides again who plays in the phrase around `bar`, or in the whole piece. A break there goes too. */
  clearRoster(bar: number | null): void {
    const piece = this.app.project.piece;
    const { from, to } = bar === null ? { from: 0, to: barCount(piece) } : phraseOf(piece, bar);
    const breaks = piece.noKick?.slice(from, to).some(Boolean) ?? false;
    this.app.store.edit((project) => clearRoster(project.piece, from, to));
    if (bar === null) this.app.say(`Im ganzen Stück entscheidet wieder die Spannung, wer spielt.${breaks ? " Auch die Breaks sind weg." : ""}`, this.app.takeBack);
  }

  /** What the roster holds for a ring in the phrase around `bar`, in words: for the status line and for whoever points there. */
  describeRoster(ring: number, bar: number): string {
    const piece = this.app.project.piece;
    const { from, to } = phraseOf(piece, bar);
    const state = rosterOf(piece, ring, bar);
    const tension = reached(piece, ring, bar);
    const does = state === ROSTER.plays ? (tension ? "spielt hier immer" : "spielt, obwohl die Spannung noch nicht reicht")
      : state === ROSTER.rests ? (tension ? "pausiert, obwohl die Spannung reicht" : "pausiert")
        : tension ? "spielt nach der Spannung" : "spielt nicht, die Spannung reicht noch nicht";
    return `${trackInfo(ring).name} · Takt ${from + 1} bis ${to}: ${does}`;
  }

  /** The keyboard in the roster: from phrase to phrase along the piece, and from ring to ring. */
  movePhrase(by: number): void {
    const count = barCount(this.app.project.piece);
    const phrases = Math.ceil(count / PHRASE);
    const at = this.key === null ? (by > 0 ? -1 : 0) : Math.floor(this.key / PHRASE);
    this.key = wrap(at + by, phrases) * PHRASE;
    this.app.notify();
  }

  moveLane(by: number): void {
    const lane = clamp(this.lane + by, 0, TRACK_COUNT - 1);
    if (lane === this.lane) return;
    this.lane = lane;
    this.app.notify();
  }

  /** Switches one of the run-ups before a landing on or off. */
  toggleRunUp(part: keyof RunUp): void {
    const on = !(this.app.project.piece.runUp?.[part] ?? false);
    this.app.store.edit((project) => setRunUp(project.piece, part, on));
  }

  /** Fills: small changes by themselves at the end of every eight bars. */
  toggleVary(): void {
    const on = !(this.app.project.piece.vary ?? false);
    this.app.store.edit((project) => setVary(project.piece, on));
  }

  /** Plays the piece from `bar`: switches it on and starts the Kreisel if need be. */
  playFrom(bar: number): void {
    if (!this.app.project.piece.on) this.app.store.edit((project) => { project.piece.on = true; });
    this.seek(bar);
    if (!this.app.playing) this.app.togglePlay();
  }

  resize(bars: number): void {
    this.app.store.edit((project) => resizePiece(project.piece, bars), "stueck-laenge");
    const count = barCount(this.app.project.piece);
    this.start = Math.min(this.start, count - 1);
    if (this.key !== null) this.key = Math.min(this.key, count - 1);
  }

  dice(): void {
    this.app.store.edit((project) => dicePiece(project.piece, this.app.random, project.style));
  }

  smooth(): void {
    this.app.store.edit((project) => smoothPiece(project.piece), "stueck-glaetten");
  }

  /** Moves a ring earlier (−1) or later (+1) in the order in which the rings come in. */
  moveEntry(ring: number, by: number): void {
    this.app.store.edit((project) => moveInOrder(project.piece, ring, by));
  }

  /** The piece goes on from `bar` at the next bar line; when nothing plays, it will start there. */
  seek(bar: number): void {
    const count = barCount(this.app.project.piece);
    this.start = wrap(Math.round(bar), count);
    this.app.engine.seekPiece(this.start);
    this.app.notify();
  }

  /** The keyboard on the piece's ring: a pointer moves from bar to bar, plus and minus change the tension there. */
  moveKey(by: number): void {
    const count = barCount(this.app.project.piece);
    this.key = wrap((this.key ?? -by) + by, count);
    this.app.notify();
  }

  nudgeTension(by: number): void {
    const bar = this.key;
    if (bar === null) return;
    this.paintTension(bar, (this.app.project.piece.tension[bar] ?? 0) + by, "spannung-taste");
  }
}

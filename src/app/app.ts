import { Engine, type FxName } from "../audio/engine";
import { BAR, clamp, currentScene, emptySceneFor, patternOf, startProject, technoPiece, TRACK_COUNT, trackOf, wrap, type Project, type StyleId } from "../model";
import { chordAt } from "../music";
import { seeded } from "../patterns";
import { barCount } from "../piece";
import { Store } from "../store";
import { readFlag, writeFlag } from "./prefs";
import { AcidDesk } from "./acid";
import { PedalDesk } from "./pedals";
import { RingDesk } from "./rings";
import { VoiceDesk } from "./voice";
import { WeatherDesk } from "./weather";
import { RumbleDesk } from "./rumble";
import { RelayDesk } from "./relay";
import { PieceDesk } from "./piece";
import { PaintDesk } from "./paint";
import { BodyDesk } from "./body";
import { ChordDesk } from "./chords";
import { SceneDesk } from "./scenes";
import { FileDesk } from "./files";

/*
 * The app: the project on the table, what is selected, and everything that
 * can be done to it. The views call in here; the store tells them when
 * something changed. This file holds what all of it shares: the table, the
 * focus, starting and stopping, steps back, messages. What can be done to
 * one subject (the rings, the piece, the weather, a voice …) is at that
 * subject's desk, in the files beside this one: `app.piece.dice()`.
 */

/** What a right click (or a long press) can land on. */
export type ContextTarget =
  | { kind: "ring"; track: number; step: number | null }
  | { kind: "piece"; bar: number | null }
  /** What the piece's tension moves beyond who plays. */
  | { kind: "sway" }
  /** What happens by itself at the ends of the piece's phrases. */
  | { kind: "ends" }
  /** The kit of a build-up: of the drop that lands in bar `drop`, or of all drops that have none of their own. */
  | { kind: "build"; drop: number | null }
  /** The roster ("Roster") of the phrase around a bar of the piece: all seven rings. */
  | { kind: "roster"; bar: number }
  | { kind: "chord"; slot: number }
  | { kind: "hub" }
  | { kind: "weather" }
  | { kind: "scene"; index: number }
  | { kind: "round"; round: number };

export interface Toast {
  text: string;
  action?: { label: string; run(): void };
}

/** Something done that a button on the page stands for. */
export type Deed = { what: "undo" | "redo" | "dice-all" | "share" } | { what: "dice" | "vary" | "clear"; track: number };

/** What the wheel and the panel are turned to: one of the seven rings, the piece's ring, or the weather. */
export type Focus = "ring" | "piece" | "weather";

/** The windows that open over the wheel, one for each kind of sound a ring can have of its own: the paint box, the workbench, the voice's window. */
export type Workshop = "paint" | "body" | "voice";

/** What a click on the wheel does: set a hit, or change one of its values. */
export type Tool = "setzen" | "betonen" | "zufall" | "wirbel" | "laenge";

export const TOOLS: readonly { id: Tool; name: string; hint: string }[] = [
  { id: "setzen", name: "Place", hint: "Click places or removes a hit, dragging paints, dragging outwards makes it higher" },
  { id: "betonen", name: "Accent", hint: "Click switches between loud, quiet and normal" },
  { id: "zufall", name: "Chance", hint: "Click makes the hit come only sometimes" },
  { id: "wirbel", name: "Ratchet", hint: "Click splits the hit into two, three or four" },
  { id: "laenge", name: "Length", hint: "Dragging along the ring holds the note longer" },
];

export const FX: readonly { id: FxName; name: string; hint: string }[] = [
  { id: "dumpf", name: "Dull", hint: "Turns the highs down" },
  { id: "duenn", name: "Thin", hint: "Takes the bass away" },
  { id: "stotter", name: "Stutter", hint: "Repeats the last eighth" },
  { id: "wurf", name: "Echo", hint: "Throws everything into the echo" },
  { id: "pause", name: "Pause", hint: "Drums and bass drop out, and come back when you let go" },
  { id: "aufbau", name: "Build-up", hint: "Builds up while held: riser and snare roll rise, the lows go (up to eight bars). When you let go, the drop lands on the next one" },
  { id: "wash", name: "Wash", hint: "Everything swells into a reverb while the dry sound sinks. When you let go, the dry sound is back at once and the reverb rings out over it" },
  { id: "jet", name: "Jet", hint: "A flanger over everything: its sweep is at its top on the one of every other bar" },
  { id: "crush", name: "Crush", hint: "Crushes everything: fewer levels and fewer samples a second" },
];

export class App {
  readonly store = new Store();
  readonly engine: Engine;
  /** The ring in focus; a first visit starts on the melody, the widest ring to aim at. */
  selected = 6;
  /** The piece's ring or the weather can be in focus instead of one of the seven. */
  focus: Focus = "ring";
  /** The window that is open over the wheel, if one is. */
  workshop: Workshop | null = null;
  tool: Tool = "setzen";
  /** The step the keyboard's cursor is on, or `null` while the mouse is in charge. */
  keyCursor: number | null = null;
  toast: Toast | null = null;
  /** Shows the menu for what a right click landed on, at that place of the page (set by whoever draws the menu). */
  onContext: (target: ContextTarget, x: number, y: number, fromKeyboard: boolean) => void = () => undefined;
  /** The light show: while it plays, hits throw light, sparks and waves (kept in this browser; whoever asked for less motion never sees it). */
  lights = readFlag("kreisel.licht", true);
  /** The stage: only the wheel, in the dark. */
  stage = false;
  /** Something was done that a button stands for: that button answers with a little motion, also when a key did it. */
  onDeed: (deed: Deed) => void = () => undefined;
  /** Effects that were latched with the right button: they stay on without being held. */
  readonly latched = new Set<FxName>();
  /** The dice of this visit: everything that is thrown comes from here. */
  readonly random = seeded(Date.now() >>> 0);
  /** What a message offers after something that is easily regretted. */
  readonly takeBack: NonNullable<Toast["action"]> = { label: "Undo", run: () => this.undo() };
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private notified = false;

  // ---- the desks: what can be done to one subject each ----
  readonly rings = new RingDesk(this);
  readonly acid = new AcidDesk(this);
  readonly pedals = new PedalDesk(this);
  readonly voice = new VoiceDesk(this);
  readonly weather = new WeatherDesk(this);
  readonly rumble = new RumbleDesk(this);
  readonly relay = new RelayDesk(this);
  readonly piece = new PieceDesk(this);
  readonly paint = new PaintDesk(this);
  readonly body = new BodyDesk(this);
  readonly chords = new ChordDesk(this);
  readonly scenes = new SceneDesk(this);
  readonly files = new FileDesk(this);

  constructor() {
    this.engine = new Engine(() => this.store.project, {
      audible: (track) => this.audible(track),
      onScene: (scene) => {
        if (this.relay.oldTurn) {
          // Looking back, the old turn's scenes come up on the table, not today's.
          if (this.relay.oldTurn.scene !== scene && this.relay.oldTurn.scenes[scene]) {
            this.relay.oldTurn.scene = scene;
            this.notify();
          }
        } else if (this.store.project.scene !== scene) {
          this.store.touch((project) => { project.scene = scene; });
        }
      },
      onState: () => this.notify(),
      // Stopping lets every effect go, latched or held. (A latch set while it stands is kept: it takes hold at the start.)
      onStopped: () => this.latched.clear(),
      onStep: (local) => {
        this.weather.trail(local);
        this.piece.heard();
      },
      scene: (index) => this.project.scenes[index] ?? null,
      pieceStart: () => (this.project.piece.on ? this.piece.start % barCount(this.project.piece) : 0),
      roundStart: () => this.scenes.startRound(),
    });
    this.store.subscribe(() => {
      this.relay.changed();
      this.engine.sync();
      this.notify();
    });
    this.store.refused = () => this.say("This is a look back at an old turn: nothing can be changed here. Go back to now, or build on from here.");
    window.addEventListener("pagehide", () => this.store.save());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.store.save();
    });
  }

  // ---- reading ----------------------------------------------------------------

  /** The Kreisel on the table: the project, or an old turn of it while looking back. */
  get project(): Project {
    return this.relay.oldTurn ?? this.store.project;
  }

  get playing(): boolean {
    return this.engine.playing;
  }

  playhead(): number | null {
    return this.engine.cursor();
  }

  sinceStruck(track: number): number {
    return this.engine.now() - (this.engine.struck[track] ?? -10);
  }

  level(): number {
    return this.engine.level();
  }

  audible(track: number): boolean {
    if (this.relay.veiled(track)) return false;
    return this.rings.solo === null ? !this.project.tracks[track]?.mute : this.rings.solo === track;
  }

  /** The chord sounding now, or the first of the scene while nothing plays. */
  chordNow(): number {
    const playhead = this.playhead();
    const scene = currentScene(this.project);
    return playhead === null ? chordAt(scene, (this.chords.openSlot ?? 0) * BAR) : chordAt(scene, playhead);
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Tells the views that something changed; once per frame at most. */
  notify(): void {
    if (this.notified) return;
    this.notified = true;
    queueMicrotask(() => {
      this.notified = false;
      for (const listener of this.listeners) listener();
    });
  }

  // ---- starting, stopping, effects ----------------------------------------------

  wake(): void {
    void this.engine.wake();
  }

  togglePlay(): void {
    this.engine.toggle();
  }

  /** How many steps the scene that sounds has played, with fractions (the playhead goes round with the rings; this goes on). `null` while nothing plays. */
  clock(): number | null {
    return this.engine.clock();
  }

  /** "Ausrichten": every eight bars all rings begin together again, or they run free. */
  toggleAlign(): void {
    const on = !(this.project.align ?? false);
    this.store.edit((project) => {
      if (on) project.align = true;
      else delete project.align;
    });
    this.say(on ? "Every eight bars the rings start together again: rings of unequal length rub within the phrase and resolve at its start." : "The rings run free against each other again.");
  }

  setFx(name: FxName, on: boolean): void {
    // Letting go of a latched effect's key does not release it: only the latch does.
    if (!on && this.latched.has(name)) return;
    this.wake();
    this.engine.setFx(name, on);
    // What the effect left behind as weather while it was held is one step back.
    if (!on) this.store.settle();
  }

  /** The right button on an effect: it stays on until it is latched off again (or the Kreisel stops). */
  latchFx(name: FxName): void {
    this.wake();
    if (this.latched.delete(name)) {
      this.engine.setFx(name, false);
    } else {
      this.latched.add(name);
      this.engine.setFx(name, true);
    }
    this.notify();
  }

  openContext(target: ContextTarget, x: number, y: number, fromKeyboard = false): void {
    this.onContext(target, x, y, fromKeyboard);
  }

  // ---- focus ------------------------------------------------------------------

  select(track: number, step?: number): void {
    const target = clamp(track, 0, TRACK_COUNT - 1);
    const changed = this.selected !== target || this.focus !== "ring" || (step !== undefined && this.keyCursor !== null);
    this.selected = target;
    this.focus = "ring";
    this.piece.key = null;
    // The workbench shows the body of the ring in focus, the voice's window its voice; a ring without one has nothing to show.
    if (this.workshop === "body" && !trackOf(this.project, target).body) this.workshop = null;
    if (this.workshop === "voice" && !trackOf(this.project, target).voice) this.workshop = null;
    // A step comes from the pointer: then the mouse is in charge and the keyboard's cursor steps aside.
    if (step !== undefined) this.keyCursor = null;
    else if (this.keyCursor !== null) this.keyCursor = Math.min(this.keyCursor, patternOf(this.project, target).len - 1);
    if (changed) this.notify();
  }

  /** Turns the wheel and the panel to the piece's ring or to the weather; whatever was open over the wheel closes. */
  turnTo(focus: "piece" | "weather"): void {
    if (this.focus === focus) return;
    this.focus = focus;
    this.workshop = null;
    this.chords.openSlot = null;
    this.rings.paletteOpen = false;
    this.pedals.open = false;
    this.keyCursor = null;
    this.notify();
  }

  /** Opens one of the windows over the wheel; another one that was open closes, and so does a chord's menu. */
  openWorkshop(which: Workshop): void {
    this.workshop = which;
    this.chords.openSlot = null;
    this.rings.paletteOpen = false;
    this.pedals.open = false;
    this.notify();
  }

  closeWorkshop(which: Workshop): void {
    if (this.workshop !== which) return;
    this.workshop = null;
    this.notify();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.notify();
  }

  moveCursor(by: number): void {
    const length = patternOf(this.project, this.selected).len;
    this.keyCursor = wrap((this.keyCursor ?? -by) + by, length);
    this.notify();
  }

  hideCursor(): void {
    if (this.keyCursor === null) return;
    this.keyCursor = null;
    this.notify();
  }

  // ---- steps back, and the whole project ------------------------------------------

  endGesture(): void {
    this.store.settle();
  }

  /** A touch that turned out to be a long press: what it did when it came down is taken back. */
  cancelGesture(gesture: string): void {
    this.store.cancel(gesture);
  }

  resetGlobal(field: "swing" | "pump" | "volume" | "pressure"): void {
    this.setGlobal({ [field]: startProject(this.project.style)[field] });
  }

  setGlobal(change: Partial<Pick<Project, "style" | "bpm" | "swing" | "root" | "scale" | "pump" | "pressure" | "volume" | "chain">>, key?: string): void {
    this.store.edit((project) => { Object.assign(project, change); }, key);
  }

  undo(): void {
    if (!this.store.undo()) return;
    if (this.playing) this.engine.queueScene(this.project.scene);
    this.onDeed({ what: "undo" });
  }

  redo(): void {
    if (!this.store.redo()) return;
    if (this.playing) this.engine.queueScene(this.project.scene);
    this.onDeed({ what: "redo" });
  }

  /**
   * A fresh Kreisel: the one its style starts with, or that one with nothing on its rings.
   * Without a `style` it stays in the style of the Kreisel on the table.
   */
  newProject(empty: boolean, style: StyleId = this.project.style): void {
    const project = startProject(style);
    if (empty) {
      project.scenes[0] = emptySceneFor(style);
      // The techno Kreisel's own piece belongs to its rings: an empty one starts with the plain form.
      if (style === "techno") project.piece = technoPiece();
    }
    this.store.replace(project);
    if (this.playing) this.engine.queueScene(0);
    this.say(empty ? "An empty Kreisel." : style === "techno" ? "The techno Kreisel is here." : "The factory Kreisel is back.", this.takeBack);
  }

  /** Whether the dice throw techno, what the controls go back to, which sounds the palettes show first, and whether the hi-hat is one voice. */
  toggleStyle(): void {
    const style: StyleId = this.project.style === "techno" ? "frei" : "techno";
    this.setGlobal({ style });
    this.say(style === "techno"
      ? "The dice now throw techno: kick on every beat, open hi-hat in between, acid lines. The palettes begin with the techno group, and a closed hi-hat cuts off the open one."
      : "The dice throw freely again. Every hi-hat rings out again.");
  }

  // ---- how it looks ----------------------------------------------------------------

  toggleLights(): void {
    this.lights = !this.lights;
    writeFlag("kreisel.licht", this.lights);
    this.say(this.lights ? "Light show on: every hit throws light on the table, accented ones spray sparks." : "Light show off.");
  }

  /** Onto the stage, or off it again. */
  toggleStage(on = !this.stage): void {
    if (on === this.stage) return;
    this.stage = on;
    if (on) this.say("Stage: only the wheel, in the dark. The button in the corner or Esc brings everything back.");
    else this.notify();
  }

  // ---- messages -----------------------------------------------------------------

  say(text: string, action?: Toast["action"]): void {
    this.toast = action ? { text, action } : { text };
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dismiss(), action ? 9000 : 5000);
    this.notify();
  }

  dismiss(): void {
    this.toast = null;
    this.notify();
  }
}

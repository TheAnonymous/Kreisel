import { Engine, renderFile, type FxName } from "./audio/engine";
import { canListen, listen } from "./audio/listen";
import { diceBild, emptyBild, makeStroke, snapHeight, type RawPoint } from "./bild";
import { decodeLink, encodeLink, packState, unpack, unpackBild } from "./codec";
import { framesToBild } from "./imitate";
import { keep, loadKept, saveKept, type Kept } from "./collection";
import { cleanBody, diceBody } from "./body";
import { diceRumble, hasRumble, RUMBLE_SHAPES, rumbleShape, shakes, SHAPE_ROLL, shapeOf } from "./rumble";
import { diceWeather as throwWeather, hasWeather, WEATHER_STROKE, windOffset } from "./weather";
import { cleanVoice, diceLine, mouthOf, shape, sing, syllables, VOWELS } from "./voice";
import { BAR, BODY_SOUND, clamp, clone, currentScene, emptyRumble, emptyScene, emptyStep, factoryProject, MAX_CHORDS, MAX_NAME, MAX_NOTE_LENGTH, MAX_STEPS, MAX_TURNS, MAX_STROKES, MIN_STEPS, OWN_SOUND, patternOf, PITCH_MAX, PITCH_MIN, RUMBLE_MAX, SCENE_COUNT, SCENE_NAMES, stepAt, TENSION_MAX, TIME_MAX, TRACK_COUNT, VOICE_SOUND, WEATHER_COUNT, WEATHER_MAX, WIND_MAX, trackInfo, trackOf, type Bild, type Body, type Pattern, type Project, type Relay, type Step, type Track, type Voice } from "./model";
import { chordAt } from "./music";
import { activeSteps, clear, dice, resize, rotate, seeded, spread, transpose, vary } from "./patterns";
import { barCount, dicePiece, moveInOrder, resizePiece, rotatePiece, smoothPiece } from "./piece";
import { changedRings, ringsWithContent } from "./relay";
import { Store } from "./store";
import type { EaselHost } from "./ui/easel";
import type { RingHost, Tool } from "./ui/ring";

/*
 * The app: the project on the table, what is selected, and everything that
 * can be done to it. The ring view and the panels call in here; the store
 * tells them when something changed.
 */

/** What a right click (or a long press) can land on. */
export type ContextTarget =
  | { kind: "ring"; track: number; step: number | null }
  | { kind: "piece"; bar: number | null }
  | { kind: "chord"; slot: number }
  | { kind: "hub" }
  | { kind: "weather" }
  | { kind: "scene"; index: number };

export interface Toast {
  text: string;
  action?: { label: string; run(): void };
}

/** Something done that a button on the page stands for. */
export type Deed = { what: "undo" | "redo" | "dice-all" | "share" } | { what: "dice" | "vary" | "clear"; track: number };

export const TOOLS: readonly { id: Tool; name: string; hint: string }[] = [
  { id: "setzen", name: "Setzen", hint: "Klick setzt oder löscht, ziehen malt, nach außen ziehen macht höher" },
  { id: "betonen", name: "Betonen", hint: "Klick wechselt zwischen laut, leise und normal" },
  { id: "zufall", name: "Zufall", hint: "Klick lässt den Schlag nur manchmal kommen" },
  { id: "wirbel", name: "Wirbel", hint: "Klick teilt den Schlag in zwei, drei oder vier" },
  { id: "laenge", name: "Länge", hint: "Am Ring entlang ziehen hält den Ton länger" },
];

export const FX: readonly { id: FxName; name: string; hint: string }[] = [
  { id: "dumpf", name: "Dumpf", hint: "Dreht die Höhen zu" },
  { id: "duenn", name: "Dünn", hint: "Nimmt den Bass weg" },
  { id: "stotter", name: "Stotter", hint: "Wiederholt die letzte Achtel" },
  { id: "wurf", name: "Echo", hint: "Wirft alles ins Echo" },
  { id: "pause", name: "Pause", hint: "Schlagzeug und Bass setzen aus, beim Loslassen kommen sie zurück" },
];

/** New hits start here: the melody on the fifth, everything else on its root. */
const FIRST_PITCH = [0, 0, 0, 0, 0, 0, 4];

/** The brushes of the paint box; the fourth takes strokes away again. */
export const BRUSH_TOOLS: readonly { name: string; hint: string }[] = [
  { name: "Summen", hint: "Ein weicher, reiner Ton" },
  { name: "Sägen", hint: "Ein scharfer, schnarrender Ton" },
  { name: "Zischen", hint: "Rauschen in dieser Höhe: Becken, Besen, Wind" },
  { name: "Radieren", hint: "Einen Strich wegnehmen (auch mit Rechtsklick)" },
];
export const ERASER = 3;

/** Effects that leave weather behind when they are held while "Einspielen" is on: dull is fog, the echo throw is rain, the stutter is hail. */
const TRAILS: readonly (readonly [FxName, number])[] = [["dumpf", 0], ["wurf", 3], ["stotter", 5]];

/** What sets a Klangkörper going: the tools of the workbench. */
export const MALLETS: readonly { name: string; hint: string }[] = [
  { name: "Weich", hint: "Ein weicher Schlägel: rund und dunkel" },
  { name: "Hart", hint: "Ein harter Schlägel: hell, mit einem Klick" },
  { name: "Zupfen", hint: "Mit dem Finger anreißen" },
  { name: "Streichen", hint: "Mit dem Bogen: klingt, solange die Note dauert" },
  { name: "Blasen", hint: "Mit dem Atem: klingt, solange die Note dauert" },
];

export class App implements RingHost, EaselHost {
  readonly store = new Store();
  readonly engine: Engine;
  /** The ring in focus; a first visit starts on the melody, the widest ring to aim at. */
  selected = 6;
  tool: Tool = "setzen";
  solo: number | null = null;
  keyCursor: number | null = null;
  openSlot: number | null = null;
  /** Notes played on the keyboard are written into the ring while it turns. */
  live = false;
  toast: Toast | null = null;
  /** 0..1 while a file of the sound is being rendered. */
  exporting: number | null = null;
  /** Shows the menu for what a right click landed on, at that place of the page (set by whoever draws the menu). */
  onContext: (target: ContextTarget, x: number, y: number, fromKeyboard: boolean) => void = () => undefined;
  /** Something was done that a button stands for: that button answers with a little motion, also when a key did it. */
  onDeed: (deed: Deed) => void = () => undefined;
  /** A ring's pattern taken with "Muster kopieren", to put into another ring or scene. */
  copied: { track: number; pattern: Pattern } | null = null;
  /** Effects that were latched with the right button: they stay on without being held. */
  readonly latched = new Set<FxName>();
  /** Reihum: the name this person plays under (kept in this browser), and the rule a new round would start with. */
  name = readName();
  rule = 0;
  /** The turn being looked back at; `null` for the Kreisel as it is now. */
  lookBack: number | null = null;
  private oldTurn: Project | null = null;
  /** Counts the project's changes: what was worked out about the turn in progress holds until the next one. */
  private stamp = 0;
  private turnMemo: { stamp: number; mine: number[]; heard: number[]; taken: number[] } | null = null;
  /** The piece's ring is in focus instead of one of the seven. */
  pieceFocus = false;
  /** The weather is in focus instead of a ring: strokes on the wheel paint it. */
  weatherFocus = false;
  /** The kind of weather the brush holds (see WEATHER_NAMES), and how wide the brush is (0..2). */
  cloud = 2;
  cloudSize = 0;
  /** The bar a piece starts from. */
  pieceStart = 0;
  /** The bar the keyboard points at on the piece's ring. */
  pieceKey: number | null = null;
  /** The paint box is open: the ring in focus gets its own sound painted. */
  easel = false;
  /** The workbench is open over the wheel: the Klangkörper of the ring in focus is being built. */
  bench = false;
  /** The voice's window is open over the wheel: the line the ring in focus sings is being written. */
  booth = false;
  brush = 0;
  brushSize = 1;
  /** Pictures kept on the shelf, across projects. */
  readonly kept: Kept[] = loadKept();
  /** What the paint box says while the microphone listens; `null` when it does not. */
  listening: string | null = null;
  /** Hears how loud the microphone is while it listens (the paint box shows it). */
  onLoudness: (level: number) => void = () => undefined;
  private stopListening: AbortController | null = null;
  private readonly pitches = [...FIRST_PITCH];
  private readonly listeners = new Set<() => void>();
  private random = seeded(Date.now() >>> 0);
  /** The shape the Nachbeben's dice threw last. */
  private lastShape = -1;
  /** Counts the times a line was sung through, so a newer one stops an older one. */
  private lineRun = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private notified = false;

  constructor() {
    this.engine = new Engine(() => this.store.project, {
      audible: (track) => this.audible(track),
      onScene: (scene) => {
        if (this.oldTurn) {
          // Looking back, the old turn's scenes come up on the table, not today's.
          if (this.oldTurn.scene !== scene && this.oldTurn.scenes[scene]) {
            this.oldTurn.scene = scene;
            this.notify();
          }
        } else if (this.store.project.scene !== scene) {
          this.store.touch((project) => { project.scene = scene; });
        }
      },
      onState: () => {
        // Stopping lets every effect go, latched or held.
        if (!this.engine.playing) this.latched.clear();
        this.notify();
      },
      onStep: (local) => this.trail(local),
      scene: (index) => this.project.scenes[index] ?? null,
      pieceStart: () => (this.project.piece.on ? this.pieceStart % barCount(this.project.piece) : 0),
    });
    this.store.subscribe(() => {
      this.stamp += 1;
      this.engine.sync();
      this.notify();
    });
    this.store.refused = () => this.say("Das ist ein Rückblick auf einen alten Zug: Hier lässt sich nichts ändern. Geh zurück zu jetzt oder bau von hier weiter.");
    window.addEventListener("pagehide", () => this.store.save());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.store.save();
    });
  }

  // ---- reading ----------------------------------------------------------------

  /** The Kreisel on the table: the project, or an old turn of it while looking back. */
  get project(): Project {
    return this.oldTurn ?? this.store.project;
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
    if (this.veiled(track)) return false;
    return this.solo === null ? !this.project.tracks[track]?.mute : this.solo === track;
  }

  /** The chord sounding now, or the first of the scene while nothing plays. */
  chordNow(): number {
    const playhead = this.playhead();
    const scene = currentScene(this.project);
    return playhead === null ? chordAt(scene, (this.openSlot ?? 0) * BAR) : chordAt(scene, playhead);
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

  // ---- transport --------------------------------------------------------------

  wake(): void {
    void this.engine.wake();
  }

  togglePlay(): void {
    this.engine.toggle();
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

  // ---- selection --------------------------------------------------------------

  select(track: number, step?: number): void {
    const target = clamp(track, 0, TRACK_COUNT - 1);
    const changed = this.selected !== target || this.pieceFocus || this.weatherFocus || (step !== undefined && this.keyCursor !== null);
    this.selected = target;
    this.pieceFocus = false;
    this.weatherFocus = false;
    this.pieceKey = null;
    // The workbench shows the body of the ring in focus; a ring without one has nothing to show.
    if (this.bench && !trackOf(this.project, target).body) this.bench = false;
    if (this.booth && !trackOf(this.project, target).voice) this.booth = false;
    // A step comes from the pointer: then the mouse is in charge and the keyboard's cursor steps aside.
    if (step !== undefined) this.keyCursor = null;
    else if (this.keyCursor !== null) this.keyCursor = Math.min(this.keyCursor, patternOf(this.project, target).len - 1);
    if (changed) this.notify();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.notify();
  }

  moveCursor(by: number): void {
    const length = patternOf(this.project, this.selected).len;
    this.keyCursor = (((this.keyCursor ?? -by) + by) % length + length) % length;
    this.notify();
  }

  hideCursor(): void {
    if (this.keyCursor === null) return;
    this.keyCursor = null;
    this.notify();
  }

  // ---- steps ------------------------------------------------------------------

  private note(track: number, step: number): Step {
    return stepAt(patternOf(this.project, track), step);
  }

  private hear(track: number, step: number): void {
    if (!this.playing) void this.engine.audition(track, this.note(track, step), this.chordNow());
  }

  addNote(track: number, step: number, values: Partial<Step>, gesture: string): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => {
      Object.assign(stepAt(patternOf(project, track), step), { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, ...values });
    }, gesture, Infinity);
    this.hear(track, step);
  }

  removeNote(track: number, step: number, gesture: string): void {
    if (this.refuse(track)) return;
    if (!this.note(track, step).on) return;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).on = false; }, gesture, Infinity);
  }

  setPitch(track: number, step: number, pitch: number, gesture: string): void {
    if (this.refuse(track)) return;
    const target = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (this.note(track, step).pitch === target) return;
    this.pitches[track] = target;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).pitch = target; }, gesture, Infinity);
    this.hear(track, step);
  }

  setLength(track: number, step: number, length: number, gesture: string): void {
    if (this.refuse(track)) return;
    const target = clamp(length, 1, MAX_NOTE_LENGTH);
    if (this.note(track, step).len === target) return;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).len = target; }, gesture, Infinity);
  }

  bump(track: number, step: number, tool: Tool, gesture: string): number {
    if (this.refuse(track)) return 0;
    const note = this.note(track, step);
    const fresh = !note.on;
    let value = 0;
    this.store.edit((project) => {
      const target = stepAt(patternOf(project, track), step);
      if (fresh) Object.assign(target, { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0 });
      if (tool === "betonen") value = target.vel = fresh ? 2 : target.vel === 1 ? 2 : target.vel === 2 ? 0 : 1;
      else if (tool === "zufall") value = target.chance = fresh ? 2 : (target.chance + 1) % 4;
      else if (tool === "wirbel") value = target.ratchet = fresh ? 2 : (target.ratchet % 4) + 1;
    }, gesture, Infinity);
    this.hear(track, step);
    return value;
  }

  setValue(track: number, step: number, tool: Tool, value: number, gesture: string): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => {
      const target = stepAt(patternOf(project, track), step);
      if (tool === "betonen") target.vel = value;
      else if (tool === "zufall") target.chance = value;
      else if (tool === "wirbel") target.ratchet = value;
    }, gesture, Infinity);
  }

  endGesture(): void {
    this.store.settle();
  }

  /** A touch that turned out to be a long press: what it did when it came down is taken back. */
  cancelGesture(gesture: string): void {
    this.store.cancel(gesture);
  }

  /** Sets a hit's values directly (from the menu under the right button). */
  setStep(track: number, step: number, values: Partial<Pick<Step, "vel" | "chance" | "ratchet" | "len" | "pitch">>): void {
    if (this.refuse(track) || !this.note(track, step).on) return;
    this.store.edit((project) => {
      const pattern = patternOf(project, track);
      const target = stepAt(pattern, step);
      if (values.vel !== undefined) target.vel = clamp(values.vel, 0, 2);
      if (values.chance !== undefined) target.chance = clamp(values.chance, 0, 3);
      if (values.ratchet !== undefined) target.ratchet = clamp(values.ratchet, 1, 4);
      if (values.len !== undefined) target.len = clamp(values.len, 1, Math.min(MAX_NOTE_LENGTH, pattern.len));
      if (values.pitch !== undefined) target.pitch = clamp(values.pitch, PITCH_MIN, PITCH_MAX);
    }, `schlag${track}.${step}`);
    if (values.pitch !== undefined) this.pitches[track] = this.note(track, step).pitch;
    this.hear(track, step);
  }

  /** The keyboard's Enter: what a click with the current tool would do at the cursor. */
  strikeCursor(): void {
    const step = this.keyCursor;
    if (step === null) {
      this.moveCursor(0);
      return;
    }
    const track = this.selected;
    const note = this.note(track, step);
    if (shakes(track, this.tool)) {
      // On the kick's ring this tool paints the Nachbeben: nothing, half, all.
      const now = currentScene(this.project).rumble[step] ?? 0;
      this.paintRumble(step, now === 0 ? 0.6 : now < RUMBLE_MAX ? 1 : 0, "beben-taste");
    } else if (this.tool === "setzen" || (this.tool === "laenge" && !note.on)) {
      if (note.on && this.tool === "setzen") this.removeNote(track, step, "taste");
      else this.addNote(track, step, {}, "taste");
    } else if (this.tool === "laenge") {
      this.setLength(track, step, (note.len % Math.min(MAX_NOTE_LENGTH, patternOf(this.project, track).len)) + 1, "taste");
    } else {
      this.bump(track, step, this.tool, "taste");
    }
    this.store.settle();
  }

  /** Bends the note under the keyboard cursor, or the whole ring when there is none. */
  nudgePitch(by: number, whole: boolean): void {
    if (this.refuse(this.selected)) return;
    const track = this.selected;
    const step = this.keyCursor;
    if (!whole && step !== null && shakes(track, this.tool)) {
      this.nudgeRumble(by);
      return;
    }
    if (!whole && step !== null && this.note(track, step).on) {
      this.setPitch(track, step, this.note(track, step).pitch + by, "tonhoehe");
    } else {
      this.store.edit((project) => transpose(patternOf(project, track), by), `transponieren${track}`);
    }
  }

  // ---- whole rings --------------------------------------------------------------

  rotate(track: number, by: number): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => {
      const pattern = patternOf(project, track);
      rotate(pattern, by);
      if (track !== 0) return;
      // The kick's ring turns with its Nachbeben.
      const scene = currentScene(project);
      const line = scene.rumble.slice(0, pattern.len);
      line.forEach((value, step) => { scene.rumble[(((step + by) % pattern.len) + pattern.len) % pattern.len] = value; });
    }, `drehen${track}`);
  }

  resizeRing(track: number, length: number): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => resize(patternOf(project, track), clamp(length, MIN_STEPS, MAX_STEPS)), `schritte${track}`);
    if (this.keyCursor !== null) this.keyCursor = Math.min(this.keyCursor, patternOf(this.project, track).len - 1);
  }

  spreadRing(track: number, hits: number): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => spread(patternOf(project, track), hits), `verteilen${track}`);
  }

  diceRing(track: number): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns[track] = dice(track, patternOf(project, track).len, this.random);
    });
    this.onDeed({ what: "dice", track });
  }

  varyRing(track: number): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => vary(track, patternOf(project, track), this.random));
    this.onDeed({ what: "vary", track });
  }

  clearRing(track: number): void {
    if (this.refuse(track)) return;
    const shaking = track === 0 && hasRumble(currentScene(this.project));
    if (activeSteps(patternOf(this.project, track)).length === 0 && !shaking) return;
    this.store.edit((project) => {
      clear(patternOf(project, track));
      // An empty kick ring has no Nachbeben either.
      if (track === 0) currentScene(project).rumble = emptyRumble();
    });
    this.onDeed({ what: "clear", track });
  }

  // ---- the voice: a ring that sings --------------------------------------------------------

  /** The voice of the ring in focus, if it has one. */
  get voice(): Voice | null {
    return trackOf(this.project, this.selected).voice;
  }

  /** Opens the voice's window on the ring in focus; a ring without a voice gets a first line to sing. */
  openBooth(): void {
    if (this.refuse(this.selected)) return;
    const track = this.selected;
    const settings = trackOf(this.project, track);
    if (!settings.voice) {
      this.store.edit((project) => { Object.assign(trackOf(project, track), { voice: cleanVoice({ text: diceLine(this.random) }), sound: VOICE_SOUND }); });
    } else if (settings.sound !== VOICE_SOUND) {
      this.setTrack(track, { sound: VOICE_SOUND });
    }
    this.booth = true;
    this.easel = false;
    this.bench = false;
    this.openSlot = null;
    this.notify();
  }

  closeBooth(): void {
    if (!this.booth) return;
    this.booth = false;
    this.notify();
  }

  /** The ring's voice: picks it, or opens its window if it is picked already or has no line yet. */
  useVoice(): void {
    const settings = trackOf(this.project, this.selected);
    if (!settings.voice || settings.sound === VOICE_SOUND) this.openBooth();
    else this.setSound(this.selected, VOICE_SOUND);
  }

  /** Changes the voice of the ring in focus; changes with the same `key` in quick succession are one step back. */
  shapeVoice(change: Partial<Voice>, key?: string): void {
    const track = this.selected;
    if (this.refuse(track)) return;
    const voice = trackOf(this.project, track).voice;
    if (!voice) return;
    const next = cleanVoice({ ...voice, ...change });
    if (JSON.stringify(next) === JSON.stringify(voice) && trackOf(this.project, track).sound === VOICE_SOUND) return;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { voice: next, sound: VOICE_SOUND }); }, key ? `${key}${track}` : undefined, key === "text" ? 2500 : undefined);
  }

  diceVoice(): void {
    const track = this.selected;
    if (this.refuse(track)) return;
    const voice = trackOf(this.project, track).voice;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { voice: cleanVoice({ ...voice, text: diceLine(this.random, voice?.text) }), sound: VOICE_SOUND }); });
    this.singLine();
  }

  /** Sings the whole line once, syllable by syllable, on the ring's note: to hear what was written. */
  singLine(): void {
    const track = this.selected;
    const voice = trackOf(this.project, track).voice;
    if (!voice || this.veiled(track)) return;
    const count = Math.max(1, syllables(voice.text).length);
    this.lineRun += 1;
    const run = this.lineRun;
    for (let number = 0; number < count; number += 1) {
      setTimeout(() => {
        // A newer line, or the Kreisel itself, has taken over.
        if (run !== this.lineRun || this.playing) return;
        void this.engine.audition(track, { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, len: 2 }, this.chordNow(), number);
      }, number * 250);
    }
  }

  /** The mouth of the voice that sounds right now, for drawing it: how open, how wide, how much. */
  mouth(): { open: number; wide: number; amount: number } | null {
    let best: { open: number; wide: number; amount: number } | null = null;
    let soonest = 0.5;
    this.project.tracks.forEach((track, index) => {
      if (track.sound !== VOICE_SOUND || !track.voice || !this.audible(index)) return;
      const since = this.sinceStruck(index);
      if (since < -0.02 || since >= soonest) return;
      soonest = since;
      const line = syllables(track.voice.text);
      const number = this.engine.sung[index] ?? 0;
      const which = line.length > 0 ? ((number % line.length) + line.length) % line.length : 0;
      const syllable = line[which];
      const sung = syllable ? sing(syllable, line[which + 1] ?? null) : null;
      const formants = shape(sung && !sung.mute ? sung.vowel : (VOWELS.a ?? [750, 1250, 2500]), track.voice, track.x, track.y);
      best = { ...mouthOf(formants), amount: sung?.mute ? 0.15 : Math.max(0, 1 - Math.max(0, since - 0.12) / 0.38) };
    });
    return best;
  }

  // ---- weather: effects painted onto the wheel -------------------------------------------

  /** Puts the weather in focus: the wheel is painted with it, the tools are the kinds of weather. */
  focusWeather(): void {
    if (this.weatherFocus) return;
    this.weatherFocus = true;
    this.pieceFocus = false;
    this.pieceKey = null;
    this.easel = false;
    this.bench = false;
    this.booth = false;
    this.openSlot = null;
    this.keyCursor = null;
    this.notify();
  }

  setCloud(kind: number): void {
    this.cloud = clamp(Math.round(kind), 0, WEATHER_COUNT - 1);
    this.notify();
  }

  setCloudSize(size: number): void {
    this.cloudSize = clamp(Math.round(size), 0, 2);
    this.notify();
  }

  /**
   * Changes weather `kind` on cells of the wheel ([ring, step], as they lie under the pointer right now). Where a
   * wind has carried the weather on, the cell that is there now is the one that changes.
   */
  private skyAt(kind: number, cells: readonly (readonly [number, number])[], change: (now: number) => number, gesture: string): void {
    const scene = currentScene(this.project);
    const offset = windOffset(Math.floor(this.playhead() ?? 0), scene.wind[kind] ?? 0);
    const changes: [number, number, number][] = [];
    for (const [ring, step] of cells) {
      if (this.veiled(ring)) continue;
      const length = scene.patterns[ring]?.len ?? 16;
      const index = (((step - offset) % length) + length) % length;
      const now = scene.weather[kind]?.[ring]?.[index] ?? 0;
      const next = clamp(Math.round(change(now)), 0, WEATHER_MAX);
      if (next !== now) changes.push([ring, index, next]);
    }
    if (changes.length === 0) return;
    this.store.edit((project) => {
      const sky = currentScene(project).weather[kind];
      for (const [ring, index, next] of changes) {
        const line = sky?.[ring];
        if (line) line[index] = next;
      }
    }, gesture, Infinity);
  }

  /** A stroke of the weather brush over cells of the wheel: a little more of the brush's weather there, or none (`erase`). */
  paintWeather(cells: readonly (readonly [number, number])[], erase: boolean, gesture: string): void {
    this.skyAt(this.cloud, cells, (now) => (erase ? 0 : now + WEATHER_STROKE), gesture);
  }

  /** Einspielen: an effect held while the Kreisel turns leaves its weather where the Kreisel is, over every ring. */
  private trail(local: number): void {
    if (!this.live || this.oldTurn) return;
    for (const [fx, kind] of TRAILS) {
      if (!this.engine.fx[fx]) continue;
      const scene = currentScene(this.project);
      const cells = scene.patterns.map((pattern, ring) => [ring, local % pattern.len] as const);
      this.skyAt(kind, cells, (now) => Math.max(now, 10), `spur-${fx}`);
    }
  }

  /** How fast weather `kind` drifts around the wheel, in quarter steps a bar. */
  setWind(kind: number, wind: number, key?: string): void {
    const next = clamp(Math.round(wind), -WIND_MAX, WIND_MAX);
    if ((currentScene(this.project).wind[kind] ?? 0) === next) return;
    this.store.edit((project) => { currentScene(project).wind[kind] = next; }, key ? `${key}${kind}` : undefined);
  }

  /** Clears the sky: all of it, one kind of weather, or what lies over one ring. */
  clearWeather(kind?: number, ring?: number): void {
    if (!hasWeather(currentScene(this.project), kind, ring)) return;
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.weather.forEach((rings, which) => {
        if (kind !== undefined && kind !== which) return;
        rings.forEach((line, where) => {
          if (ring === undefined || ring === where) line.fill(0);
        });
        if (ring === undefined) scene.wind[which] = 0;
      });
    });
  }

  /** The dice: a sky to start from. */
  diceWeather(): void {
    this.store.edit((project) => {
      const scene = currentScene(project);
      const sky = throwWeather(scene.patterns.map((pattern) => pattern.len), this.random);
      scene.weather = sky.weather;
      scene.wind = sky.wind;
    });
    if (!this.playing) this.say("Neues Wetter. Starte den Kreisel, dann hörst du es, und was Wind hat, zieht um das Rad.");
  }

  // ---- the Nachbeben under the kick ---------------------------------------------------

  /** Paints how much the ground shakes at a step of the kick's ring, 0..1. */
  paintRumble(step: number, share: number, gesture: string): void {
    if (this.refuse(0)) return;
    if (step < 0 || step >= patternOf(this.project, 0).len) return;
    const value = clamp(Math.round(share * RUMBLE_MAX), 0, RUMBLE_MAX);
    if (currentScene(this.project).rumble[step] === value) return;
    this.store.edit((project) => { currentScene(project).rumble[step] = value; }, gesture, Infinity);
  }

  /** Lays one of the usual shapes around the kicks and sets how much it rolls; −1 takes the Nachbeben away. */
  shapeRumble(shape: number): void {
    if (this.refuse(0)) return;
    const kicks = activeSteps(patternOf(this.project, 0)).length;
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.rumble = shape < 0 ? emptyRumble() : rumbleShape(patternOf(project, 0), shape);
      if (shape >= 0) project.roll = SHAPE_ROLL[shape] ?? project.roll;
    });
    if (shape >= 0) this.rumbleHint(kicks);
  }

  /** The dice: the next of the usual shapes, a little different every time. */
  diceRumble(): void {
    if (this.refuse(0)) return;
    const pattern = patternOf(this.project, 0);
    const now = shapeOf(pattern, currentScene(this.project).rumble);
    this.lastShape = ((now >= 0 ? now : this.lastShape) + 1) % RUMBLE_SHAPES.length;
    const shape = this.lastShape;
    this.store.edit((project) => {
      currentScene(project).rumble = diceRumble(patternOf(project, 0), shape, this.random);
      project.roll = SHAPE_ROLL[shape] ?? project.roll;
    });
    this.rumbleHint(activeSteps(pattern).length, `Nachbeben: ${RUMBLE_SHAPES[shape]}.`);
  }

  private rumbleHint(kicks: number, text = ""): void {
    if (kicks === 0) this.say("Ohne Kick bebt nichts: Setz zuerst Schläge in den Kick-Ring.");
    else if (!this.playing) this.say(`${text ? `${text} ` : ""}Starte den Kreisel, dann hörst du das Nachbeben zwischen den Kicks.`);
    else if (text) this.say(text);
  }

  /** The Nachbeben's character: how dirty it is, how much it rolls. */
  setRumble(change: Partial<Pick<Project, "dirt" | "roll">>, key?: string): void {
    if (this.refuse(0)) return;
    this.store.edit((project) => {
      if (change.dirt !== undefined) project.dirt = clamp(change.dirt, 0, 1);
      if (change.roll !== undefined) project.roll = clamp(change.roll, 0, 1);
    }, key);
  }

  resetRumble(field: "dirt" | "roll"): void {
    this.setRumble({ [field]: factoryProject()[field] });
  }

  /** Picks the kick's ring and the tool that paints its Nachbeben. */
  paintTheRumble(): void {
    this.select(0);
    this.setTool("laenge");
    this.say("Zieh einmal mit der Maus um den Kick-Ring: außen bebt es stark, innen gar nicht. Die rechte Taste radiert.");
  }

  /** The keyboard on the Nachbeben: a step up or down at the cursor. */
  nudgeRumble(by: number): void {
    const step = this.keyCursor;
    if (step === null) return;
    const now = currentScene(this.project).rumble[step] ?? 0;
    this.paintRumble(step, clamp(now + by * 2, 0, RUMBLE_MAX) / RUMBLE_MAX, "beben-taste");
  }

  diceAll(): void {
    if (Array.from({ length: TRACK_COUNT }, (_, track) => track).some((track) => this.veiled(track))) {
      this.say("Stille Post: Solange Ringe verdeckt sind, würfelt niemand alle auf einmal.");
      return;
    }
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns = scene.patterns.map((pattern, track) => dice(track, pattern.len, this.random));
    });
    this.say("Alle Ringe neu gewürfelt.", { label: "Zurück", run: () => this.undo() });
    this.onDeed({ what: "dice-all" });
  }

  /** Takes a ring's pattern (of the scene on the table) to put somewhere else. */
  copyRing(track: number): void {
    if (this.veiled(track)) return;
    this.copied = { track, pattern: clone(patternOf(this.project, track)) };
    this.say(`Muster von ${trackInfo(track).name} kopiert. Rechtsklick auf einen Ring fügt es ein, auch in einer anderen Szene.`);
  }

  pasteRing(track: number): void {
    const copied = this.copied;
    if (!copied || this.refuse(track)) return;
    this.store.edit((project) => { currentScene(project).patterns[track] = clone(copied.pattern); });
  }

  // ---- sound and mix ------------------------------------------------------------

  setTrack(track: number, change: Partial<Track>, key?: string): void {
    if (this.refuse(track)) return;
    this.store.edit((project) => { Object.assign(trackOf(project, track), change); }, key ? `${key}${track}` : undefined);
  }

  /** Changes the sound and plays it once, so a click on a sound is heard. */
  setSound(track: number, sound: number): void {
    this.setTrack(track, { sound });
    this.preview(track);
  }

  /** One note of the ring as it sounds now. */
  preview(track: number): void {
    if (this.playing && this.audible(track) && activeSteps(patternOf(this.project, track)).length > 0) return;
    void this.engine.audition(track, { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, len: 2 }, this.chordNow());
  }

  /** The right button on a control puts it back where a fresh Kreisel has it. */
  resetTrack(track: number, field: "level" | "hall" | "echo"): void {
    const fresh = trackOf(factoryProject(), track);
    this.setTrack(track, { [field]: fresh[field] });
  }

  resetPad(track: number): void {
    const fresh = trackOf(factoryProject(), track);
    this.setTrack(track, { x: fresh.x, y: fresh.y });
    this.preview(track);
  }

  resetGlobal(field: "swing" | "pump" | "volume"): void {
    this.setGlobal({ [field]: factoryProject()[field] });
  }

  toggleMute(track: number): void {
    this.solo = null;
    this.setTrack(track, { mute: !trackOf(this.project, track).mute });
  }

  toggleSolo(track: number): void {
    this.solo = this.solo === track ? null : track;
    this.engine.sync();
    this.notify();
  }

  setGlobal(change: Partial<Pick<Project, "bpm" | "swing" | "root" | "scale" | "pump" | "volume" | "chain" | "repeats">>, key?: string): void {
    this.store.edit((project) => { Object.assign(project, change); }, key);
  }

  // ---- Reihum: a Kreisel that goes from hand to hand ---------------------------------

  /** The turns the Kreisel on the table has been through (also while looking back at one of them). */
  get relay(): Relay | null {
    return this.store.project.relay;
  }

  /** What the turn in progress has touched, what the turn before it touched, and which rings were taken by then. */
  private turnState(): { mine: number[]; heard: number[]; taken: number[] } {
    const turns = this.relay?.turns ?? [];
    const last = turns[turns.length - 1];
    if (!last) return { mine: [], heard: [], taken: [] };
    if (this.turnMemo?.stamp !== this.stamp) {
      this.turnMemo = {
        stamp: this.stamp,
        mine: changedRings(last.state, packState(this.store.project)),
        heard: changedRings(turns[turns.length - 2]?.state ?? null, last.state),
        taken: ringsWithContent(last.state),
      };
    }
    return this.turnMemo;
  }

  /** The rings touched in the turn in progress. */
  get turnRings(): number[] {
    return this.turnState().mine;
  }

  /** Stille Post, not yet revealed: a ring someone built earlier, other than the one just before, is out of sight and hearing. */
  veiled(track: number): boolean {
    const relay = this.relay;
    if (!relay || relay.rule !== 2 || relay.open || relay.turns.length === 0 || this.oldTurn) return false;
    const { mine, heard, taken } = this.turnState();
    return taken.includes(track) && !heard.includes(track) && !mine.includes(track);
  }

  private refuse(track: number): boolean {
    if (!this.veiled(track)) return false;
    this.say("Stille Post: Dieser Ring ist verdeckt, da hat schon jemand gebaut. Nimm einen, der noch leer ist.");
    return true;
  }

  setName(name: string): void {
    this.name = name.slice(0, MAX_NAME);
    try {
      localStorage.setItem("kreisel.name", this.name);
    } catch {
      // No storage: the name lasts for this visit.
    }
  }

  /** The rule of a round that has not begun; once the first turn is finished, the round keeps its rule. */
  setRule(rule: number): void {
    this.rule = clamp(rule, 0, 2);
    this.notify();
  }

  /**
   * Finishes the turn: the Kreisel as it is now joins the turns, and the link with all of them is copied.
   * Returns whether the turn counted (a rule may say no).
   */
  async finishTurn(): Promise<boolean> {
    if (this.oldTurn) {
      this.say("Geh erst zurück zu jetzt: Ein Rückblick ist kein Zug.");
      return false;
    }
    const name = this.name.trim();
    if (!name) {
      this.say("Trag erst deinen Namen ein, damit die anderen wissen, von wem der Zug ist.");
      return false;
    }
    const relay = this.relay;
    const rule = relay ? relay.rule : this.rule;
    const state = packState(this.store.project);
    const last = relay?.turns[relay.turns.length - 1]?.state ?? null;
    const touched = last === null ? ringsWithContent(state) : changedRings(last, state);
    const names = touched.map((ring) => trackInfo(ring).name).join(", ");
    if (last !== null && JSON.stringify(last) === JSON.stringify(state)) {
      this.say("Du hast noch nichts verändert. Bau erst etwas, dann ist es ein Zug.");
      return false;
    }
    if (rule >= 1 && last !== null && touched.length > 1) {
      this.say(`Die Regel sagt: ein Ring pro Zug. Du hast ${touched.length} angefasst (${names}). Nimm mit Strg+Z etwas zurück.`);
      return false;
    }
    if (rule === 2 && touched.length !== 1) {
      this.say(touched.length === 0 ? "Stille Post: Bau erst deinen Ring." : `Stille Post beginnt mit einem einzigen Ring, hier spielen ${touched.length} (${names}). Fang mit einem leeren Kreisel an.`);
      return false;
    }
    this.store.edit((project) => {
      project.relay ??= { rule, open: false, turns: [] };
      project.relay.turns.push({ name, state });
      if (project.relay.turns.length > MAX_TURNS) project.relay.turns.shift();
    });
    const count = this.relay?.turns.length ?? 1;
    const link = `${location.origin}${location.pathname}#k=${await encodeLink(this.store.project)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.say(`Zug ${count} ist abgeschlossen und der Link kopiert. Schick ihn an die nächste Person.`);
    } catch {
      history.replaceState(null, "", link);
      this.say(`Zug ${count} ist abgeschlossen. Der Link steht in der Adresszeile: von dort kopieren und weiterschicken.`);
    }
    return true;
  }

  /** Stille Post is over: everyone sees and hears everything. */
  revealRelay(): void {
    if (!this.relay || this.relay.open) return;
    this.store.edit((project) => {
      if (project.relay) project.relay.open = true;
    });
    this.say("Aufgedeckt! Jetzt hören alle alles.");
  }

  /** Forgets the turns; the Kreisel stays as it is. */
  endRelay(): void {
    if (!this.relay) return;
    this.look(null);
    this.store.edit((project) => { project.relay = null; });
    this.say("Reihum ist beendet, die Züge sind vergessen.", { label: "Zurück", run: () => this.undo() });
  }

  /** Looks back at the Kreisel as it was after turn `index`, or returns to now (`null`). Nothing can be changed while looking back. */
  look(index: number | null): void {
    const relay = this.relay;
    const turn = index === null ? null : relay?.turns[index];
    if (index !== null && relay?.rule === 2 && !relay.open) {
      this.say("Stille Post: Zurückhören geht erst nach dem Aufdecken.");
      return;
    }
    if (!turn) {
      if (this.oldTurn === null) return;
      this.oldTurn = null;
      this.lookBack = null;
    } else {
      try {
        this.oldTurn = unpack(turn.state, true);
      } catch {
        return;
      }
      this.lookBack = index;
      this.easel = false;
      this.bench = false;
      this.booth = false;
    }
    this.store.locked = this.oldTurn !== null;
    this.stamp += 1;
    this.engine.sync();
    if (this.playing) this.engine.queueScene(this.project.scene);
    this.notify();
  }

  /** Goes on building from an old turn: the Kreisel becomes what it was then, and the later turns are dropped. */
  continueFrom(index: number): void {
    const relay = this.relay;
    const turn = relay?.turns[index];
    if (!relay || !turn) return;
    this.look(null);
    let project: Project;
    try {
      project = unpack(turn.state, true);
    } catch {
      return;
    }
    project.relay = { rule: relay.rule, open: relay.open, turns: relay.turns.slice(0, index + 1) };
    this.store.replace(project);
    if (this.playing) this.engine.queueScene(project.scene);
    this.say(`Du baust von Zug ${index + 1} weiter. Die späteren Züge sind abgezweigt.`, { label: "Zurück", run: () => this.undo() });
  }

  // ---- the piece ------------------------------------------------------------------

  piecePlayhead(): number | null {
    return this.engine.pieceCursor();
  }

  /** Puts the piece's ring in focus: it widens, and the panel shows the piece. */
  focusPiece(): void {
    if (this.pieceFocus) return;
    this.pieceFocus = true;
    this.weatherFocus = false;
    this.easel = false;
    this.bench = false;
    this.booth = false;
    this.openSlot = null;
    this.keyCursor = null;
    this.notify();
  }

  /** Switches between looping the scene on the table and playing by the piece. */
  togglePiece(): void {
    const on = !this.project.piece.on;
    this.store.edit((project) => { project.piece.on = on; });
    if (on) this.say("Der Kreisel spielt jetzt nach dem Stück-Ring: außen ist viel los, innen wenig. Mal die Spannung in den Ring.");
  }

  paintTension(bar: number, tension: number, gesture: string): void {
    const target = clamp(Math.round(tension), 0, TENSION_MAX);
    if (this.project.piece.tension[bar] === undefined || this.project.piece.tension[bar] === target) return;
    this.store.edit((project) => { project.piece.tension[bar] = target; }, gesture, Infinity);
  }

  paintScene(bar: number, gesture: string): void {
    const scene = this.project.scene;
    if (this.project.piece.scenes[bar] === undefined || this.project.piece.scenes[bar] === scene) return;
    this.store.edit((project) => { project.piece.scenes[bar] = scene; }, gesture, Infinity);
  }

  rotatePiece(by: number): void {
    this.store.edit((project) => rotatePiece(project.piece, by), "stueck-drehen");
  }

  /** Lays a scene on the four bars around `bar` (the piece is ticked in fours), or on the whole piece. */
  sceneForBars(bar: number, scene: number, whole = false): void {
    if (!this.project.scenes[scene]) return;
    const from = whole ? 0 : Math.floor(bar / 4) * 4;
    const to = whole ? barCount(this.project.piece) : from + 4;
    this.store.edit((project) => {
      for (let index = from; index < to && index < project.piece.scenes.length; index += 1) project.piece.scenes[index] = scene;
    });
  }

  /** Plays the piece from `bar`: switches it on and starts the Kreisel if need be. */
  playFrom(bar: number): void {
    if (!this.project.piece.on) this.store.edit((project) => { project.piece.on = true; });
    this.seekPiece(bar);
    if (!this.playing) this.togglePlay();
  }

  resizeThePiece(bars: number): void {
    this.store.edit((project) => resizePiece(project.piece, bars), "stueck-laenge");
    const count = barCount(this.project.piece);
    this.pieceStart = Math.min(this.pieceStart, count - 1);
    if (this.pieceKey !== null) this.pieceKey = Math.min(this.pieceKey, count - 1);
  }

  diceThePiece(): void {
    this.store.edit((project) => dicePiece(project.piece, this.random));
  }

  smoothThePiece(): void {
    this.store.edit((project) => smoothPiece(project.piece), "stueck-glaetten");
  }

  /** Moves a ring earlier (−1) or later (+1) in the order in which the rings come in. */
  moveEntry(ring: number, by: number): void {
    this.store.edit((project) => moveInOrder(project.piece, ring, by));
  }

  /** The piece goes on from `bar` at the next bar line; when nothing plays, it will start there. */
  seekPiece(bar: number): void {
    const count = barCount(this.project.piece);
    this.pieceStart = ((Math.round(bar) % count) + count) % count;
    this.engine.seekPiece(this.pieceStart);
    this.notify();
  }

  /** The keyboard on the piece's ring: a pointer moves from bar to bar, plus and minus change the tension there. */
  movePieceKey(by: number): void {
    const count = barCount(this.project.piece);
    this.pieceKey = (((this.pieceKey ?? -by) + by) % count + count) % count;
    this.notify();
  }

  nudgeTension(by: number): void {
    const bar = this.pieceKey;
    if (bar === null) return;
    this.paintTension(bar, (this.project.piece.tension[bar] ?? 0) + by, "spannung-taste");
  }

  // ---- painting sounds -----------------------------------------------------------

  /** The picture of the ring in focus, if it has one. */
  get bild(): Bild | null {
    return trackOf(this.project, this.selected).bild;
  }

  /** Opens the paint box on the ring in focus; a ring without a picture gets a first one to start from. */
  openEasel(): void {
    if (this.refuse(this.selected)) return;
    const track = this.selected;
    const settings = trackOf(this.project, track);
    if (!settings.bild) {
      this.store.edit((project) => { Object.assign(trackOf(project, track), { bild: diceBild(track, this.random), sound: OWN_SOUND }); });
    } else if (settings.sound !== OWN_SOUND) {
      this.setTrack(track, { sound: OWN_SOUND });
    }
    this.easel = true;
    this.bench = false;
    this.booth = false;
    this.openSlot = null;
    this.notify();
    this.preview(track);
  }

  closeEasel(): void {
    if (!this.easel) return;
    this.easel = false;
    this.notify();
  }

  /** The ring's own sound: picks it, or opens the paint box if it is picked already or not painted yet. */
  useOwn(): void {
    const settings = trackOf(this.project, this.selected);
    if (!settings.bild || settings.sound === OWN_SOUND) this.openEasel();
    else this.setSound(this.selected, OWN_SOUND);
  }

  // ---- building sounding bodies ----------------------------------------------------

  /** The Klangkörper of the ring in focus, if it has one. */
  get body(): Body | null {
    return trackOf(this.project, this.selected).body;
  }

  /** Opens the workbench on the ring in focus; a ring without a body gets a first one to start from. */
  openBench(): void {
    if (this.refuse(this.selected)) return;
    const track = this.selected;
    const settings = trackOf(this.project, track);
    if (!settings.body) {
      this.store.edit((project) => { Object.assign(trackOf(project, track), { body: diceBody(track, this.random), sound: BODY_SOUND }); });
    } else if (settings.sound !== BODY_SOUND) {
      this.setTrack(track, { sound: BODY_SOUND });
    }
    this.bench = true;
    this.easel = false;
    this.booth = false;
    this.openSlot = null;
    this.notify();
    this.hearBody();
  }

  closeBench(): void {
    if (!this.bench) return;
    this.bench = false;
    this.notify();
  }

  /** The ring's body: picks it, or opens the workbench if it is picked already or not built yet. */
  useBody(): void {
    const settings = trackOf(this.project, this.selected);
    if (!settings.body || settings.sound === BODY_SOUND) this.openBench();
    else this.setSound(this.selected, BODY_SOUND);
  }

  /** Changes the body of the ring in focus; changes with the same `key` in quick succession are one step back. */
  shapeBody(change: Partial<Body>, key?: string): void {
    const track = this.selected;
    if (this.refuse(track)) return;
    const body = trackOf(this.project, track).body;
    if (!body) return;
    const next = cleanBody({ ...body, ...change });
    if (JSON.stringify(next) === JSON.stringify(body) && trackOf(this.project, track).sound === BODY_SOUND) return;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { body: next, sound: BODY_SOUND }); }, key ? `${key}${track}` : undefined, key?.startsWith("koerper") ? Infinity : undefined);
  }

  /** One note on the body as it is now, also while the Kreisel plays: a knock on the workbench is always heard. */
  hearBody(): void {
    const track = this.selected;
    if (this.veiled(track)) return;
    void this.engine.audition(track, { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, len: 2 }, this.chordNow());
  }

  /** Knocks on the body at `where`; from then on the ring strikes it there. */
  strikeBody(where: number, gesture: string): void {
    this.shapeBody({ where }, gesture);
    this.hearBody();
  }

  diceBody(): void {
    const track = this.selected;
    if (this.refuse(track)) return;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { body: diceBody(track, this.random), sound: BODY_SOUND }); });
    this.hearBody();
  }

  setBrush(brush: number): void {
    this.brush = clamp(brush, 0, ERASER);
    this.notify();
  }

  setBrushSize(size: number): void {
    const target = clamp(size, 0, 2);
    if (target === this.brushSize) return;
    this.brushSize = target;
    this.notify();
  }

  /** One stroke of the brush, through the points it passed (both 0..1). */
  paint(drawn: readonly RawPoint[]): void {
    const track = this.selected;
    const kind = Math.min(this.brush, 2);
    const stroke = makeStroke(kind, this.brushSize, drawn, (y) => snapHeight(track, kind, y));
    if (!stroke) return;
    if ((this.bild?.strokes.length ?? 0) >= MAX_STROKES) {
      this.say(`Mehr als ${MAX_STROKES} Striche passen nicht in einen Klang. Radier einen weg, dann geht es weiter.`);
      return;
    }
    this.store.edit((project) => {
      const settings = trackOf(project, track);
      settings.bild ??= emptyBild();
      settings.bild.strokes.push(stroke);
      settings.sound = OWN_SOUND;
    });
    this.preview(track);
  }

  eraseStroke(index: number, gesture: string): void {
    const track = this.selected;
    if (!this.bild?.strokes[index]) return;
    this.store.edit((project) => { trackOf(project, track).bild?.strokes.splice(index, 1); }, gesture, Infinity);
  }

  /** Takes the newest stroke away. */
  eraseLast(): void {
    const count = this.bild?.strokes.length ?? 0;
    if (count > 0) this.eraseStroke(count - 1, "strich");
    this.store.settle();
  }

  setHold(value: number | null, gesture?: string): void {
    const track = this.selected;
    const target = value === null ? null : clamp(Math.round(value), 2, TIME_MAX - 2);
    if (!this.bild || this.bild.hold === target) return;
    this.store.edit((project) => {
      const bild = trackOf(project, track).bild;
      if (bild) bild.hold = target;
    }, gesture, Infinity);
  }

  diceOwn(): void {
    if (this.refuse(this.selected)) return;
    const track = this.selected;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { bild: diceBild(track, this.random), sound: OWN_SOUND }); });
    this.preview(track);
  }

  clearOwn(): void {
    const track = this.selected;
    if (!this.bild || this.bild.strokes.length === 0) return;
    this.store.edit((project) => {
      const bild = trackOf(project, track).bild;
      if (bild) bild.strokes = [];
    });
  }

  /** Puts the ring's picture on the shelf. */
  keepOwn(): void {
    const bild = this.bild;
    if (!bild || bild.strokes.length === 0) {
      this.say("Hier ist noch nichts gemalt.");
      return;
    }
    if (!keep(this.kept, this.selected, bild)) {
      this.say("Dieses Bild liegt schon im Regal.");
      return;
    }
    saveKept(this.kept);
    this.say("Gemerkt. Das Bild liegt im Regal und passt in jeden Ring, auch in einem anderen Kreisel.");
  }

  /** Takes a picture from the shelf into the ring in focus. */
  useKept(index: number): void {
    if (this.refuse(this.selected)) return;
    const bild = unpackBild(this.kept[index]?.bild);
    if (!bild) return;
    const track = this.selected;
    // Only rings that play notes hold; a drum plays the picture through.
    if (!trackInfo(track).melodic) bild.hold = null;
    this.store.edit((project) => { Object.assign(trackOf(project, track), { bild, sound: OWN_SOUND }); });
    this.preview(track);
  }

  dropKept(index: number): void {
    if (!this.kept[index]) return;
    this.kept.splice(index, 1);
    saveKept(this.kept);
    this.notify();
  }

  /** Listens to one sound made into the microphone and paints what it heard; a second call stops listening. */
  async imitate(): Promise<void> {
    if (this.stopListening) {
      this.stopListening.abort();
      return;
    }
    if (!canListen()) {
      this.say("Dieser Browser gibt hier kein Mikrofon her.");
      return;
    }
    const track = this.selected;
    // The Kreisel would hear itself through the speakers.
    const wasPlaying = this.playing;
    if (wasPlaying) this.engine.stop();
    const stop = new AbortController();
    this.stopListening = stop;
    this.listening = "Mach den Klang vor: summ, klopf oder zisch. Es bleibt alles auf deinem Gerät.";
    this.notify();
    try {
      const frames = await listen({
        signal: stop.signal,
        onLevel: (level, begun) => {
          this.onLoudness(level);
          if (begun && this.listening !== "Ich höre dich …") {
            this.listening = "Ich höre dich …";
            this.notify();
          }
        },
      });
      const bild = framesToBild(frames, track);
      if (!bild) {
        this.say(stop.signal.aborted ? "Vormachen abgebrochen." : "Ich habe nichts gehört. Etwas näher ans Mikrofon, oder lauter?");
      } else {
        this.store.edit((project) => { Object.assign(trackOf(project, track), { bild, sound: OWN_SOUND }); });
        this.say("So habe ich dich verstanden. Mal daran weiter oder mach es noch einmal vor.", { label: "Zurück", run: () => this.undo() });
      }
    } catch (error) {
      const refused = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.say(refused ? "Ohne Mikrofon kein Vormachen. Erlaub es in der Adresszeile, dann klappt es." : "Das Mikrofon ließ sich nicht öffnen.");
    } finally {
      this.stopListening = null;
      this.listening = null;
      this.onLoudness(0);
      this.notify();
      if (wasPlaying) await this.engine.start();
      else if (this.bild) this.preview(track);
    }
  }

  // ---- chords -------------------------------------------------------------------

  openChord(slot: number): void {
    this.openSlot = this.openSlot === slot ? null : slot;
    this.notify();
  }

  closeChord(): void {
    if (this.openSlot === null) return;
    this.openSlot = null;
    this.notify();
  }

  setChord(slot: number, degree: number): void {
    this.store.edit((project) => { currentScene(project).chords[slot] = clamp(degree, 0, 6); });
    void this.engine.audition(5, { ...emptyStep(), on: true, len: 4 }, degree);
  }

  /** A new bar before `slot`, with the chord that is there. */
  insertBar(slot: number): void {
    const chords = currentScene(this.project).chords;
    if (chords.length >= MAX_CHORDS || chords[slot] === undefined) return;
    this.store.edit((project) => {
      const list = currentScene(project).chords;
      list.splice(slot, 0, list[slot] ?? 0);
    });
  }

  removeBar(slot: number): void {
    const chords = currentScene(this.project).chords;
    if (chords.length <= 1 || chords[slot] === undefined) return;
    this.store.edit((project) => { currentScene(project).chords.splice(slot, 1); });
    this.closeChord();
  }

  setBars(count: number): void {
    const target = clamp(count, 1, MAX_CHORDS);
    this.store.edit((project) => {
      const chords = currentScene(project).chords;
      while (chords.length < target) chords.push(chords[chords.length - 1] ?? 0);
      chords.length = target;
    });
    if (this.openSlot !== null) this.openSlot = Math.min(this.openSlot, target - 1);
  }

  // ---- scenes -------------------------------------------------------------------

  /** A filled scene comes up at the next bar; an empty one becomes a copy of the one on the table. */
  pickScene(index: number): void {
    if (index < 0 || index >= SCENE_COUNT) return;
    if (this.oldTurn) {
      // Looking back: move through the old turn's scenes, nothing more.
      if (!this.oldTurn.scenes[index]) return;
      if (this.playing && !this.oldTurn.piece.on) this.engine.queueScene(index);
      else this.oldTurn.scene = index;
      this.notify();
      return;
    }
    if (!this.project.scenes[index]) {
      const from = SCENE_NAMES[this.project.scene];
      this.store.edit((project) => { project.scenes[index] = clone(currentScene(project)); });
      this.say(`Szene ${SCENE_NAMES[index]} ist eine Kopie von ${from}. Jetzt kannst du sie verändern.`);
    }
    if (this.playing && !this.project.piece.on) {
      this.engine.queueScene(index);
      this.notify();
    } else if (this.project.scene !== index) {
      // While a piece plays, the piece decides which scene sounds; this only puts a scene on the table (to change it, or to lay it on the piece).
      this.store.touch((project) => { project.scene = index; });
    }
  }

  /** The first scene that is still empty, or −1. */
  freeScene(): number {
    return this.project.scenes.findIndex((scene) => scene === null);
  }

  /** A copy of scene `index` in the first empty scene, put on the table. */
  copyScene(index: number): void {
    const free = this.freeScene();
    const scene = this.project.scenes[index];
    if (free < 0 || !scene) return;
    this.store.edit((project) => { project.scenes[free] = clone(scene); });
    this.pickScene(free);
    this.say(`Szene ${SCENE_NAMES[free]} ist eine Kopie von ${SCENE_NAMES[index]}.`);
  }

  clearScene(index: number): void {
    const filled = this.project.scenes.filter((scene) => scene !== null).length;
    if (!this.project.scenes[index] || filled <= 1) return;
    this.store.edit((project) => {
      project.scenes[index] = null;
      if (project.scene === index) project.scene = project.scenes.findIndex((scene) => scene !== null);
      // The piece cannot play a scene that is gone: its bars fall to the scene now on the table.
      project.piece.scenes = project.piece.scenes.map((scene) => (scene === index ? project.scene : scene));
    });
    if (this.playing) this.engine.queueScene(this.project.scene);
    this.say(`Szene ${SCENE_NAMES[index]} geleert.`, { label: "Zurück", run: () => this.undo() });
  }

  // ---- project ------------------------------------------------------------------

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

  newProject(empty: boolean): void {
    const project = factoryProject();
    if (empty) project.scenes[0] = emptyScene();
    this.store.replace(project);
    if (this.playing) this.engine.queueScene(0);
    this.say(empty ? "Ein leerer Kreisel." : "Der Werks-Kreisel ist wieder da.", { label: "Zurück", run: () => this.undo() });
  }

  async share(): Promise<void> {
    const link = `${location.origin}${location.pathname}#k=${await encodeLink(this.store.project)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.say("Link kopiert. Wer ihn öffnet, bekommt eine eigene Kopie deines Kreisels.");
      this.onDeed({ what: "share" });
    } catch {
      history.replaceState(null, "", link);
      this.say("Der Link steht jetzt in der Adresszeile: von dort kopieren.");
    }
  }

  /** Opens a Kreisel from a link's `#k=`; the one on the table is kept for "Zurück". */
  async openLink(hash: string): Promise<void> {
    const text = /[#&]k=([^&]+)/.exec(hash)?.[1];
    if (!text) return;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    try {
      const project = await decodeLink(text);
      this.look(null);
      this.store.backup();
      this.store.replace(project);
      const relay = project.relay;
      const last = relay?.turns[relay.turns.length - 1];
      const back = { label: "Zurück zu meinem", run: () => this.undo() };
      if (!relay || !last) this.say("Ein geteilter Kreisel. Deiner ist nicht weg.", back);
      else if (relay.rule === 2 && !relay.open) this.say(`Stille Post von ${last.name}: Du hörst nur den Ring davor. Bau deinen dazu und schick den Link weiter.`, back);
      else this.say(`Reihum: ${last.name} hat Zug ${relay.turns.length} gemacht. Du bist dran.`, back);
    } catch {
      this.say("Dieser Link ließ sich nicht öffnen.");
    }
  }

  /** Saves what the Kreisel plays as a file: Opus, or WAV where this browser cannot write Opus. */
  async exportSound(): Promise<void> {
    if (this.exporting !== null) return;
    this.exporting = 0;
    this.notify();
    try {
      const file = await renderFile(clone(this.project), (share) => {
        this.exporting = share;
        this.notify();
      });
      download(file.blob, `kreisel.${file.kind}`);
      const what = this.project.piece.on ? "Das ganze Stück" : this.project.chain ? "Die ganze Folge" : "Die Szene";
      this.say(`${what} als ${FORMATS[file.kind]} gespeichert${this.project.piece.on || this.project.chain ? "" : " (zweimal durch die Akkorde)"}.`);
    } catch {
      this.say("Die Datei konnte nicht erzeugt werden.");
    } finally {
      this.exporting = null;
      this.notify();
    }
  }

  async toggleRecording(): Promise<void> {
    if (!Engine.canRecord) {
      this.say("Dieser Browser kann hier nicht aufnehmen. Nimm „Als Opus speichern“ im Menü.");
      return;
    }
    const wasRecording = this.engine.recording;
    const file = await this.engine.toggleRecording();
    if (!wasRecording) {
      if (!this.playing) await this.engine.start();
      this.say("Aufnahme läuft: alles, was du hörst und spielst. Noch ein Klick speichert sie.");
    } else if (file) {
      download(file.blob, `kreisel-aufnahme.${file.kind}`);
      this.say(`Aufnahme als ${FORMATS[file.kind]} gespeichert.`);
    } else {
      this.say("Die Aufnahme war still und wurde nicht gespeichert.");
    }
  }

  // ---- playing by hand --------------------------------------------------------------

  toggleLive(): void {
    this.live = !this.live;
    this.say(this.live ? "Einspielen an: Was du auf A bis K spielst, landet im Ring, solange der Kreisel läuft." : "Einspielen aus.");
  }

  /** A key of the home row: plays scale step `degree` on the ring in focus, and writes it down while live. */
  playKey(degree: number): void {
    const track = this.selected;
    if (this.veiled(track)) return;
    const pitch = clamp(degree, PITCH_MIN, PITCH_MAX);
    const note: Step = { ...emptyStep(), on: true, pitch, len: trackInfo(track).melodic ? 2 : 1 };
    void this.engine.audition(track, note, this.chordNow());
    this.pitches[track] = pitch;
    if (!this.live || !this.playing) return;
    const position = this.engine.recordTarget(track);
    if (position === null) return;
    const step = position % patternOf(this.project, track).len;
    this.store.edit((project) => { Object.assign(stepAt(patternOf(project, track), step), { ...emptyStep(), on: true, pitch }); }, "einspielen", 4000);
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

function readName(): string {
  try {
    return (localStorage.getItem("kreisel.name") ?? "").slice(0, MAX_NAME);
  } catch {
    return "";
  }
}

/** How a saved file's format is named; a WAV says why it is not Opus. */
const FORMATS = { opus: "Opus", wav: "WAV (dieser Browser schreibt kein Opus)" } as const;

function download(blob: Blob, name: string): void {
  // Handed over without a type: Firefox looks into a file it knows the type of and renames an Opus file to ".ogx".
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

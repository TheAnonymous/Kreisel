import { Engine, renderWav, type FxName } from "./audio/engine";
import { canListen, listen } from "./audio/listen";
import { diceBild, emptyBild, makeStroke, snapHeight, type RawPoint } from "./bild";
import { decodeLink, encodeLink, unpackBild } from "./codec";
import { framesToBild } from "./imitate";
import { keep, loadKept, saveKept, type Kept } from "./collection";
import { BAR, clamp, clone, currentScene, emptyScene, emptyStep, factoryProject, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MAX_STROKES, MIN_STEPS, OWN_SOUND, patternOf, PITCH_MAX, PITCH_MIN, SCENE_COUNT, SCENE_NAMES, stepAt, TENSION_MAX, TIME_MAX, TRACK_COUNT, trackInfo, trackOf, type Bild, type Project, type Step, type Track } from "./model";
import { chordAt } from "./music";
import { activeSteps, clear, dice, resize, rotate, seeded, spread, transpose, vary } from "./patterns";
import { barCount, dicePiece, moveInOrder, resizePiece, rotatePiece, smoothPiece } from "./piece";
import { Store } from "./store";
import type { EaselHost } from "./ui/easel";
import type { RingHost, Tool } from "./ui/ring";

/*
 * The app: the project on the table, what is selected, and everything that
 * can be done to it. The ring view and the panels call in here; the store
 * tells them when something changed.
 */

export interface Toast {
  text: string;
  action?: { label: string; run(): void };
}

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
  /** 0..1 while a WAV is being rendered. */
  exporting: number | null = null;
  /** The piece's ring is in focus instead of one of the seven. */
  pieceFocus = false;
  /** The bar a piece starts from. */
  pieceStart = 0;
  /** The bar the keyboard points at on the piece's ring. */
  pieceKey: number | null = null;
  /** The paint box is open: the ring in focus gets its own sound painted. */
  easel = false;
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
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private notified = false;

  constructor() {
    this.engine = new Engine(() => this.store.project, {
      audible: (track) => this.audible(track),
      onScene: (scene) => {
        if (this.store.project.scene !== scene) this.store.touch((project) => { project.scene = scene; });
      },
      onState: () => this.notify(),
      pieceStart: () => (this.project.piece.on ? this.pieceStart % barCount(this.project.piece) : 0),
    });
    this.store.subscribe(() => {
      this.engine.sync();
      this.notify();
    });
    window.addEventListener("pagehide", () => this.store.save());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.store.save();
    });
  }

  // ---- reading ----------------------------------------------------------------

  get project(): Project {
    return this.store.project;
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
    this.wake();
    this.engine.setFx(name, on);
  }

  // ---- selection --------------------------------------------------------------

  select(track: number, step?: number): void {
    const target = clamp(track, 0, TRACK_COUNT - 1);
    const changed = this.selected !== target || this.pieceFocus || (step !== undefined && this.keyCursor !== null);
    this.selected = target;
    this.pieceFocus = false;
    this.pieceKey = null;
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
    this.store.edit((project) => {
      Object.assign(stepAt(patternOf(project, track), step), { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, ...values });
    }, gesture, Infinity);
    this.hear(track, step);
  }

  removeNote(track: number, step: number, gesture: string): void {
    if (!this.note(track, step).on) return;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).on = false; }, gesture, Infinity);
  }

  setPitch(track: number, step: number, pitch: number, gesture: string): void {
    const target = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (this.note(track, step).pitch === target) return;
    this.pitches[track] = target;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).pitch = target; }, gesture, Infinity);
    this.hear(track, step);
  }

  setLength(track: number, step: number, length: number, gesture: string): void {
    const target = clamp(length, 1, MAX_NOTE_LENGTH);
    if (this.note(track, step).len === target) return;
    this.store.edit((project) => { stepAt(patternOf(project, track), step).len = target; }, gesture, Infinity);
  }

  bump(track: number, step: number, tool: Tool, gesture: string): number {
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

  /** The keyboard's Enter: what a click with the current tool would do at the cursor. */
  strikeCursor(): void {
    const step = this.keyCursor;
    if (step === null) {
      this.moveCursor(0);
      return;
    }
    const track = this.selected;
    const note = this.note(track, step);
    if (this.tool === "setzen" || (this.tool === "laenge" && !note.on)) {
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
    const track = this.selected;
    const step = this.keyCursor;
    if (!whole && step !== null && this.note(track, step).on) {
      this.setPitch(track, step, this.note(track, step).pitch + by, "tonhoehe");
    } else {
      this.store.edit((project) => transpose(patternOf(project, track), by), `transponieren${track}`);
    }
  }

  // ---- whole rings --------------------------------------------------------------

  rotate(track: number, by: number): void {
    this.store.edit((project) => rotate(patternOf(project, track), by), `drehen${track}`);
  }

  resizeRing(track: number, length: number): void {
    this.store.edit((project) => resize(patternOf(project, track), clamp(length, MIN_STEPS, MAX_STEPS)), `schritte${track}`);
    if (this.keyCursor !== null) this.keyCursor = Math.min(this.keyCursor, patternOf(this.project, track).len - 1);
  }

  spreadRing(track: number, hits: number): void {
    this.store.edit((project) => spread(patternOf(project, track), hits), `verteilen${track}`);
  }

  diceRing(track: number): void {
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns[track] = dice(track, patternOf(project, track).len, this.random);
    });
  }

  varyRing(track: number): void {
    this.store.edit((project) => vary(track, patternOf(project, track), this.random));
  }

  clearRing(track: number): void {
    if (activeSteps(patternOf(this.project, track)).length === 0) return;
    this.store.edit((project) => clear(patternOf(project, track)));
  }

  diceAll(): void {
    this.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns = scene.patterns.map((pattern, track) => dice(track, pattern.len, this.random));
    });
    this.say("Alle Ringe neu gewürfelt.", { label: "Zurück", run: () => this.undo() });
  }

  // ---- sound and mix ------------------------------------------------------------

  setTrack(track: number, change: Partial<Track>, key?: string): void {
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

  // ---- the piece ------------------------------------------------------------------

  piecePlayhead(): number | null {
    return this.engine.pieceCursor();
  }

  /** Puts the piece's ring in focus: it widens, and the panel shows the piece. */
  focusPiece(): void {
    if (this.pieceFocus) return;
    this.pieceFocus = true;
    this.easel = false;
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
    const track = this.selected;
    const settings = trackOf(this.project, track);
    if (!settings.bild) {
      this.store.edit((project) => { Object.assign(trackOf(project, track), { bild: diceBild(track, this.random), sound: OWN_SOUND }); });
    } else if (settings.sound !== OWN_SOUND) {
      this.setTrack(track, { sound: OWN_SOUND });
    }
    this.easel = true;
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
    if (this.store.undo() && this.playing) this.engine.queueScene(this.project.scene);
  }

  redo(): void {
    if (this.store.redo() && this.playing) this.engine.queueScene(this.project.scene);
  }

  newProject(empty: boolean): void {
    const project = factoryProject();
    if (empty) project.scenes[0] = emptyScene();
    this.store.replace(project);
    if (this.playing) this.engine.queueScene(0);
    this.say(empty ? "Ein leerer Kreisel." : "Der Werks-Kreisel ist wieder da.", { label: "Zurück", run: () => this.undo() });
  }

  async share(): Promise<void> {
    const link = `${location.origin}${location.pathname}#k=${await encodeLink(this.project)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.say("Link kopiert. Wer ihn öffnet, bekommt eine eigene Kopie deines Kreisels.");
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
      this.store.backup();
      this.store.replace(project);
      this.say("Ein geteilter Kreisel. Deiner ist nicht weg.", { label: "Zurück zu meinem", run: () => this.undo() });
    } catch {
      this.say("Dieser Link ließ sich nicht öffnen.");
    }
  }

  async exportWav(): Promise<void> {
    if (this.exporting !== null) return;
    this.exporting = 0;
    this.notify();
    try {
      const blob = await renderWav(clone(this.project), (share) => {
        this.exporting = share;
        this.notify();
      });
      download(blob, "kreisel.wav");
      this.say(this.project.piece.on ? "Das ganze Stück als WAV gespeichert." : this.project.chain ? "Die ganze Folge als WAV gespeichert." : "Die Szene als WAV gespeichert (zweimal durch die Akkorde).");
    } catch {
      this.say("Das WAV konnte nicht erzeugt werden.");
    } finally {
      this.exporting = null;
      this.notify();
    }
  }

  async toggleRecording(): Promise<void> {
    if (!Engine.canRecord) {
      this.say("Dieser Browser kann hier nicht aufnehmen. Nimm „Als WAV speichern“ im Menü.");
      return;
    }
    const wasRecording = this.engine.recording;
    const blob = await this.engine.toggleRecording();
    if (!wasRecording) {
      if (!this.playing) await this.engine.start();
      this.say("Aufnahme läuft: alles, was du hörst und spielst. Noch ein Klick speichert sie.");
    } else if (blob) {
      download(blob, "kreisel-aufnahme.wav");
      this.say("Aufnahme als WAV gespeichert.");
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

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

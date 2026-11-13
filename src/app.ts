import { Engine, renderWav, type FxName } from "./audio/engine";
import { decodeLink, encodeLink } from "./codec";
import { BAR, clamp, clone, currentScene, emptyScene, emptyStep, factoryProject, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MIN_STEPS, patternOf, PITCH_MAX, PITCH_MIN, SCENE_COUNT, SCENE_NAMES, stepAt, TRACK_COUNT, trackInfo, trackOf, type Project, type Step, type Track } from "./model";
import { chordAt } from "./music";
import { activeSteps, clear, dice, resize, rotate, seeded, spread, transpose, vary } from "./patterns";
import { Store } from "./store";
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

export class App implements RingHost {
  readonly store = new Store();
  readonly engine: Engine;
  selected = 4;
  tool: Tool = "setzen";
  solo: number | null = null;
  keyCursor: number | null = null;
  openSlot: number | null = null;
  /** Notes played on the keyboard are written into the ring while it turns. */
  live = false;
  toast: Toast | null = null;
  /** 0..1 while a WAV is being rendered. */
  exporting: number | null = null;
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
    const changed = this.selected !== target || (step !== undefined && this.keyCursor !== null);
    this.selected = target;
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
    if (this.playing) {
      this.engine.queueScene(index);
      this.notify();
    } else if (this.project.scene !== index) {
      this.store.touch((project) => { project.scene = index; });
    }
  }

  clearScene(index: number): void {
    const filled = this.project.scenes.filter((scene) => scene !== null).length;
    if (!this.project.scenes[index] || filled <= 1) return;
    this.store.edit((project) => {
      project.scenes[index] = null;
      if (project.scene === index) project.scene = project.scenes.findIndex((scene) => scene !== null);
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
      this.say(this.project.chain ? "Die ganze Folge als WAV gespeichert." : "Die Szene als WAV gespeichert (zweimal durch die Akkorde).");
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

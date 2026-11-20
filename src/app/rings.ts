import { hasRumble, shakes } from "../rumble";
import { clamp, clone, currentScene, emptyRumble, emptyStep, startProject, MAX_NOTE_LENGTH, MAX_STEPS, MIN_STEPS, patternOf, PITCH_MAX, PITCH_MIN, RUMBLE_MAX, stepAt, TRACK_COUNT, trackInfo, trackOf, type Pattern, type Step, type Track, wrap } from "../model";
import { activeSteps, clear, dice, resize, rotate, spread, transpose, vary } from "../patterns";
import { alongPalette, PALETTE_ORDER } from "../sounds/index";
import type { App, Tool } from "./app";

/** New hits start here: the melody on the fifth, everything else on its root. */
const FIRST_PITCH = [0, 0, 0, 0, 0, 0, 4];

/*
 * The rings themselves: the hits in them, whole patterns, and how each ring sounds and sits in the mix.
 */
export class RingDesk {
  /** The one ring that is heard alone, if one is. */
  solo: number | null = null;
  /** Einspielen: notes played on the keyboard are written into the ring while it turns. */
  live = false;
  /** A ring's pattern taken with "Muster kopieren", to put into another ring or scene. */
  copied: { track: number; pattern: Pattern } | null = null;
  /** The palette with all the ready-made sounds of the ring in focus is open. */
  paletteOpen = false;
  /** The pitch each ring's last hit had: where its next one starts. */
  private readonly pitches = [...FIRST_PITCH];

  constructor(private readonly app: App) {}

  private note(track: number, step: number): Step {
    return stepAt(patternOf(this.app.project, track), step);
  }

  private hear(track: number, step: number): void {
    if (!this.app.playing) void this.app.engine.audition(track, this.note(track, step), this.app.chordNow());
  }

  addNote(track: number, step: number, values: Partial<Step>, gesture: string): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      Object.assign(stepAt(patternOf(project, track), step), { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, ...values });
    }, gesture, Infinity);
    this.hear(track, step);
  }

  removeNote(track: number, step: number, gesture: string): void {
    if (this.app.relay.refuse(track)) return;
    if (!this.note(track, step).on) return;
    this.app.store.edit((project) => { stepAt(patternOf(project, track), step).on = false; }, gesture, Infinity);
  }

  setPitch(track: number, step: number, pitch: number, gesture: string): void {
    if (this.app.relay.refuse(track)) return;
    const target = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (this.note(track, step).pitch === target) return;
    this.pitches[track] = target;
    this.app.store.edit((project) => { stepAt(patternOf(project, track), step).pitch = target; }, gesture, Infinity);
    this.hear(track, step);
  }

  setLength(track: number, step: number, length: number, gesture: string): void {
    if (this.app.relay.refuse(track)) return;
    const target = clamp(length, 1, MAX_NOTE_LENGTH);
    if (this.note(track, step).len === target) return;
    this.app.store.edit((project) => { stepAt(patternOf(project, track), step).len = target; }, gesture, Infinity);
  }

  bump(track: number, step: number, tool: Tool, gesture: string): number {
    if (this.app.relay.refuse(track)) return 0;
    const note = this.note(track, step);
    const fresh = !note.on;
    let value = 0;
    this.app.store.edit((project) => {
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
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const target = stepAt(patternOf(project, track), step);
      if (tool === "betonen") target.vel = value;
      else if (tool === "zufall") target.chance = value;
      else if (tool === "wirbel") target.ratchet = value;
    }, gesture, Infinity);
  }

  /** Sets a hit's values directly (from the menu under the right button). */
  setStep(track: number, step: number, values: Partial<Pick<Step, "vel" | "chance" | "ratchet" | "len" | "pitch">>): void {
    if (this.app.relay.refuse(track) || !this.note(track, step).on) return;
    this.app.store.edit((project) => {
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
    const step = this.app.keyCursor;
    if (step === null) {
      this.app.moveCursor(0);
      return;
    }
    const track = this.app.selected;
    const note = this.note(track, step);
    if (shakes(track, this.app.tool)) {
      // On the kick's ring this tool paints the Nachbeben: nothing, half, all.
      const now = currentScene(this.app.project).rumble[step] ?? 0;
      this.app.rumble.paint(step, now === 0 ? 0.6 : now < RUMBLE_MAX ? 1 : 0, "beben-taste");
    } else if (this.app.tool === "setzen" || (this.app.tool === "laenge" && !note.on)) {
      if (note.on && this.app.tool === "setzen") this.removeNote(track, step, "taste");
      else this.addNote(track, step, {}, "taste");
    } else if (this.app.tool === "laenge") {
      this.setLength(track, step, (note.len % Math.min(MAX_NOTE_LENGTH, patternOf(this.app.project, track).len)) + 1, "taste");
    } else {
      this.bump(track, step, this.app.tool, "taste");
    }
    this.app.store.settle();
  }

  /** Bends the note under the keyboard cursor, or the whole ring when there is none. */
  nudgePitch(by: number, whole: boolean): void {
    if (this.app.relay.refuse(this.app.selected)) return;
    const track = this.app.selected;
    const step = this.app.keyCursor;
    if (!whole && step !== null && shakes(track, this.app.tool)) {
      this.app.rumble.nudge(by);
      return;
    }
    if (!whole && step !== null && this.note(track, step).on) {
      this.setPitch(track, step, this.note(track, step).pitch + by, "tonhoehe");
    } else {
      this.app.store.edit((project) => transpose(patternOf(project, track), by), `transponieren${track}`);
    }
  }

  rotate(track: number, by: number): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const pattern = patternOf(project, track);
      rotate(pattern, by);
      if (track !== 0) return;
      // The kick's ring turns with its Nachbeben.
      const scene = currentScene(project);
      const line = scene.rumble.slice(0, pattern.len);
      line.forEach((value, step) => { scene.rumble[wrap(step + by, pattern.len)] = value; });
    }, `drehen${track}`);
  }

  resize(track: number, length: number): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => resize(patternOf(project, track), clamp(length, MIN_STEPS, MAX_STEPS)), `schritte${track}`);
    if (this.app.keyCursor !== null) this.app.keyCursor = Math.min(this.app.keyCursor, patternOf(this.app.project, track).len - 1);
  }

  spread(track: number, hits: number): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => spread(patternOf(project, track), hits), `verteilen${track}`);
  }

  dice(track: number): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns[track] = dice(track, patternOf(project, track).len, this.app.random, project.style);
    });
    this.app.onDeed({ what: "dice", track });
  }

  vary(track: number): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => vary(track, patternOf(project, track), this.app.random));
    this.app.onDeed({ what: "vary", track });
  }

  clear(track: number): void {
    if (this.app.relay.refuse(track)) return;
    const shaking = track === 0 && hasRumble(currentScene(this.app.project));
    if (activeSteps(patternOf(this.app.project, track)).length === 0 && !shaking) return;
    this.app.store.edit((project) => {
      clear(patternOf(project, track));
      // An empty kick ring has no Nachbeben either.
      if (track === 0) currentScene(project).rumble = emptyRumble();
    });
    this.app.onDeed({ what: "clear", track });
  }

  diceAll(): void {
    if (Array.from({ length: TRACK_COUNT }, (_, track) => track).some((track) => this.app.relay.veiled(track))) {
      this.app.say("Stille Post: Solange Ringe verdeckt sind, würfelt niemand alle auf einmal.");
      return;
    }
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      scene.patterns = scene.patterns.map((pattern, track) => dice(track, pattern.len, this.app.random, project.style));
    });
    this.app.say("Alle Ringe neu gewürfelt.", this.app.takeBack);
    this.app.onDeed({ what: "dice-all" });
  }

  /** Takes a ring's pattern (of the scene on the table) to put somewhere else. */
  copy(track: number): void {
    if (this.app.relay.veiled(track)) return;
    this.copied = { track, pattern: clone(patternOf(this.app.project, track)) };
    this.app.say(`Muster von ${trackInfo(track).name} kopiert. Rechtsklick auf einen Ring fügt es ein, auch in einer anderen Szene.`);
  }

  paste(track: number): void {
    const copied = this.copied;
    if (!copied || this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => { currentScene(project).patterns[track] = clone(copied.pattern); });
  }

  setTrack(track: number, change: Partial<Track>, key?: string): void {
    if (this.app.relay.refuse(track)) return;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), change); }, key ? `${key}${track}` : undefined);
  }

  /** Changes the sound and plays it once, so a click on a sound is heard. Trying one sound after another is one step back. */
  setSound(track: number, sound: number): void {
    this.setTrack(track, { sound }, "sound");
    this.preview(track);
  }

  /** Goes to the sound before or after on the ring's palette. */
  stepSound(track: number, by: 1 | -1): void {
    this.setSound(track, alongPalette(trackOf(this.app.project, track).sound, by));
  }

  /** Takes some other sound from the ring's palette. */
  diceSound(track: number): void {
    const now = trackOf(this.app.project, track).sound;
    const others = PALETTE_ORDER.filter((sound) => sound !== now);
    this.setSound(track, others[Math.floor(this.app.random() * others.length)] ?? 0);
  }

  togglePalette(): void {
    this.paletteOpen = !this.paletteOpen;
    this.app.notify();
  }

  closePalette(): void {
    if (!this.paletteOpen) return;
    this.paletteOpen = false;
    this.app.notify();
  }

  /** Strikes the ring once, at the pitch its last hit had; a voice sings syllable `number` of its line. */
  strike(track: number, number = 0): void {
    void this.app.engine.audition(track, { ...emptyStep(), on: true, pitch: this.pitches[track] ?? 0, len: 2 }, this.app.chordNow(), number);
  }

  /** One note of the ring as it sounds now, unless the Kreisel is playing it anyway. */
  preview(track: number): void {
    if (this.app.playing && this.app.audible(track) && activeSteps(patternOf(this.app.project, track)).length > 0) return;
    this.strike(track);
  }

  /** The right button on a control puts it back where a fresh Kreisel has it. */
  resetTrack(track: number, field: "level" | "hall" | "echo"): void {
    const fresh = trackOf(startProject(this.app.project.style), track);
    this.setTrack(track, { [field]: fresh[field] });
  }

  resetPad(track: number): void {
    const fresh = trackOf(startProject(this.app.project.style), track);
    this.setTrack(track, { x: fresh.x, y: fresh.y });
    this.preview(track);
  }

  toggleMute(track: number): void {
    this.solo = null;
    this.setTrack(track, { mute: !trackOf(this.app.project, track).mute });
  }

  toggleSolo(track: number): void {
    this.solo = this.solo === track ? null : track;
    this.app.engine.sync();
    this.app.notify();
  }

  toggleLive(): void {
    this.live = !this.live;
    this.app.say(this.live ? "Einspielen an: Was du auf A bis K spielst, landet im Ring, solange der Kreisel läuft." : "Einspielen aus.");
  }

  /** A key of the home row: plays scale step `degree` on the ring in focus, and writes it down while live. */
  playKey(degree: number): void {
    const track = this.app.selected;
    if (this.app.relay.veiled(track)) return;
    const pitch = clamp(degree, PITCH_MIN, PITCH_MAX);
    const note: Step = { ...emptyStep(), on: true, pitch, len: trackInfo(track).melodic ? 2 : 1 };
    void this.app.engine.audition(track, note, this.app.chordNow());
    this.pitches[track] = pitch;
    if (!this.live || !this.app.playing) return;
    const position = this.app.engine.recordTarget(track);
    if (position === null) return;
    const step = position % patternOf(this.app.project, track).len;
    this.app.store.edit((project) => { Object.assign(stepAt(patternOf(project, track), step), { ...emptyStep(), on: true, pitch }); }, "einspielen", 4000);
  }
}

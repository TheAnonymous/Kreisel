import {
  AudioHost,
  audibleRange,
  crash,
  createBus,
  createPingPong,
  createReverb,
  Cues,
  duck,
  encodePcm16Wav,
  encodeWav,
  hallImpulse,
  Kit,
  Master,
  MasterRecorder,
  midiToHz,
  renderInChunks,
  Transport,
  trimmedLength,
  type ChannelBus,
} from "klangwerk";
import { charged, noteSeconds } from "../acid";
import { ACID_SOUND, BAR, BODY_SOUND, currentScene, OWN_SOUND, VOICE_SOUND, stepAt, TRACK_COUNT, TRACK_INFO, TRACK_KINDS, type Acid, type Project, type Scene, type Step, type Track, wrap } from "../model";
import { bassMidi, chordAt, chordMidis, leadMidi, percMidi } from "../music";
import { seeded, type Random } from "../patterns";
import { hasRumble } from "../rumble";
import { barCount, dropsQuiet, gateLevel, planBar, type BarPlan } from "../piece";
import { playBild } from "./bild";
import { playBody } from "./body";
import { buildDrive, buildGroup, shadeDrive, shadeGroup, type KickDrive, type KickGroup } from "./kick";
import { playVoice } from "./voice";
import { buildRumble, hitRumble, shadeRumble, stepRumble, stillRumble, type Rumble } from "./rumble";
import { buildPress, shadePress, type Press } from "./press";
import { buildChain, clearChain, driveChain, stepChain, type Chain } from "./weather";
import { brightness, shaded, shadesSound, weatherOver } from "../weather";
import { hitNumber } from "../voice";
import { soundFile, type SoundFile } from "./opus";
import { playAcid, type AcidNote } from "./acid";
import { glides, playHit, type Hit } from "./sounds";

/*
 * The sound of a Kreisel: seven channel buses with hall and echo sends into a
 * master that never clips, a player that turns the rings into notes step by
 * step (live from a worker's heartbeat, or offline for a WAV), and the
 * effects held under the fingers.
 */

type Bus = ChannelBus<"hall" | "echo">;

export interface Graph {
  context: BaseAudioContext;
  kit: Kit;
  master: Master;
  /** "Druck": where the sum is pressed before the master hears it. */
  press: Press;
  mix: GainNode;
  buses: Bus[];
  /** Where each ring's notes go in; swapped for a fresh one to cut what still rings. */
  inlets: GainNode[];
  hall: AudioNode;
  echo: ReturnType<typeof createPingPong>;
  /** Everything into the echo while the throw is held. */
  throwSend: GainNode;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  analyser: AnalyserNode | null;
  /** What makes the kick hard, before anything else hears it. */
  drive: KickDrive;
  /** The Nachbeben under the kick. */
  rumble: Rumble;
  /** Where the kick and its Nachbeben leave for the mix together. */
  group: KickGroup;
  /** What the weather does to each ring's sound. */
  chains: Chain[];
}

/** Evens out how loud the rings are at the same level setting. */
const TRIM = [1, 0.85, 1.1, 0.85, 0.8, 0.9, 0.95] as const;
const VELOCITY = [0.42, 0.78, 1] as const;
const CHANCES = [1, 0.75, 0.5, 0.25] as const;

export function buildGraph(context: BaseAudioContext): Graph {
  const kit = new Kit(context, { noiseSeed: 4711 });
  const highpass = kit.filter("highpass", 20, 0.7);
  const lowpass = kit.filter("lowpass", 20_000, 0.7);
  const master = new Master(context, { chain: [highpass, lowpass, "gate"], open: true });
  // Mix, hall and echo meet in the press on their way to the master; at rest it lets them through as they come.
  const press = buildPress(kit, master.input);
  const mix = kit.gain(1);
  mix.connect(press.input);
  const hall = createReverb(kit, hallImpulse(context, 2.4, { decay: 4.5 }), { to: press.input, level: 0.8 });
  const echo = createPingPong(kit, { feedback: 0.42, tone: 3400, to: press.input, level: 0.7 });
  const throwSend = kit.gain(0);
  mix.connect(throwSend).connect(echo.input);
  const group = buildGroup(kit, mix);
  const buses = TRACK_KINDS.map((_, index) => createBus(context, { level: 0, to: index === 0 ? group.input : mix, sends: { hall: hall.input, echo: echo.input } }));
  const rumble = buildRumble(kit, group.input);
  const chains = buses.map((bus) => buildChain(kit, bus.input, bus.output, hall.input, echo.input));
  // The kick is driven first; as hard as it comes out, it goes on to its bus and down into the cellar.
  const drive = buildDrive(kit);
  if (chains[0]) drive.output.connect(chains[0].input);
  drive.output.connect(rumble.input);
  const inlets = chains.map((chain, index) => {
    const inlet = kit.gain(1);
    inlet.connect(index === 0 ? drive.input : chain.input);
    return inlet;
  });
  let analyser: AnalyserNode | null = null;
  if (typeof AudioContext !== "undefined" && context instanceof AudioContext) {
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    master.output.connect(analyser);
  }
  return { context, kit, master, press, mix, buses, inlets, hall: hall.input, echo, throwSend, lowpass, highpass, analyser, drive, rumble, group, chains };
}

export const stepSeconds = (project: Project): number => 15 / project.bpm;

/** Levels, sends, the echo's time and the volume, as the project has them now. */
export function applyMix(graph: Graph, project: Project, audible: (track: number) => boolean, time: number, glideTime = 0.015): void {
  graph.buses.forEach((bus, index) => {
    const track = project.tracks[index];
    if (!track) return;
    const level = audible(index) ? track.level ** 1.5 * (TRIM[index] ?? 1) : 0;
    bus.output.gain.setTargetAtTime(level, time, glideTime);
    bus.sends.hall.gain.setTargetAtTime(track.hall, time, glideTime);
    bus.sends.echo.gain.setTargetAtTime(track.echo, time, glideTime);
    const chain = graph.chains[index];
    if (chain) driveChain(chain, track.drive, time);
  });
  shadeDrive(graph.drive, project.hard, time, glideTime);
  shadePress(graph.press, project.pressure, time, glideTime);
  // The Nachbeben is as loud as the kick's ring is set, and silent with it.
  const kick = project.tracks[0];
  shadeRumble(graph.rumble, project.dirt, project.roll, kick && audible(0) ? kick.level ** 1.5 * (TRIM[0] ?? 1) : 0, time, glideTime);
  // A dotted eighth: the echo answers between the beats.
  const echoTime = Math.min(1.9, 3 * stepSeconds(project));
  graph.echo.left.delayTime.setTargetAtTime(echoTime, time, 0.05);
  graph.echo.right.delayTime.setTargetAtTime(echoTime, time, 0.05);
  graph.master.setVolume(project.volume, time);
}

/** Lets what still rings in the rings' inlets fade and gives them fresh ones; hall and echo ring out. */
function hush(graph: Graph, time: number): void {
  graph.inlets = graph.inlets.map((old, index) => {
    old.gain.setTargetAtTime(0, time, 0.03);
    setTimeout(() => old.disconnect(), 600);
    const inlet = graph.kit.gain(1);
    const chain = graph.chains[index];
    if (index === 0) inlet.connect(graph.drive.input);
    else if (chain) inlet.connect(chain.input);
    return inlet;
  });
  stillRumble(graph.rumble, time);
  for (const chain of graph.chains) clearChain(chain, time);
}

/**
 * Noise that rises until `end` and then stays up until it is cut: the breath
 * held during a pause. (Klangwerk's riser reads its two seconds of noise only
 * once; a pause can be held for longer.)
 */
function rise(kit: Kit, out: AudioNode, start: number, end: number, peak: number): { cut(time: number): void } {
  const source = kit.context.createBufferSource();
  source.buffer = kit.noise;
  source.loop = true;
  const tone = kit.filter("bandpass", 300, 2.5);
  tone.frequency.setValueAtTime(300, start);
  tone.frequency.exponentialRampToValueAtTime(7000, end);
  const amp = kit.gain(0);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(peak, end);
  source.connect(tone).connect(amp).connect(out);
  source.start(start);
  source.stop(start + 120);
  return {
    cut: (time: number) => {
      amp.gain.cancelScheduledValues(time);
      amp.gain.setTargetAtTime(0, time, 0.012);
      source.stop(time + 0.15);
    },
  };
}

/** Turns steps into notes, and remembers each ring's last note for slides. */
class Voices {
  private readonly last: ({ hz: number; until: number } | null)[] = Array.from({ length: TRACK_COUNT }, () => null);
  /** The note each ring's acid machine is playing, for the one that follows it. */
  private readonly acid: (AcidNote | null)[] = Array.from({ length: TRACK_COUNT }, () => null);
  /** Whether that note was one of a roll: a roll is struck every time, and nothing is tied to it. */
  private readonly rolled: boolean[] = Array.from({ length: TRACK_COUNT }, () => false);
  /** What earlier accents have left on each ring's machine, and when that was counted. */
  private readonly charge: { amount: number; at: number }[] = Array.from({ length: TRACK_COUNT }, () => ({ amount: 0, at: 0 }));

  constructor(private readonly graph: Graph) {}

  /**
   * Plays `step` of ring `track` at `time`; `stepTime` is how long one step lasts, `level` scales how loud it is.
   * `quakes` says that the ground shakes in this scene (then an acid machine leaves the lows to it).
   */
  strike(project: Project, track: number, step: Step, chord: number, time: number, stepTime: number, level = 1, bright = 0, number = 0, quakes = false): void {
    const plain = project.tracks[track];
    // Sun and fog reach into the sound itself where a ring has a brightness of its own: note by note, as a filter is played.
    const settings = plain && bright !== 0 ? { ...plain, x: shaded(plain.x, bright) } : plain;
    const inlet = this.graph.inlets[track];
    if (!settings || !inlet) return;
    const melodic = TRACK_INFO[TRACK_KINDS[track] ?? "kick"].melodic;
    const count = Math.max(1, step.ratchet);
    const midis = track === 3 ? [percMidi(project, step.pitch)]
      : track === 4 ? [bassMidi(project, chord, step.pitch)]
      : track === 5 ? chordMidis(project, chord, step.pitch)
      : track === 6 ? [leadMidi(project, step.pitch)]
      : [];
    const held = melodic ? step.len : 1;
    const duration = count > 1 ? (stepTime / count) * 0.9 : noteSeconds(settings.sound, held, stepTime);
    for (let repeat = 0; repeat < count; repeat += 1) {
      const at = time + (repeat * stepTime) / count;
      const frequency = midiToHz(midis[0] ?? 60);
      const before = this.last[track];
      const glideFrom = glides(track, settings.sound) && before && before.until > at - 0.012 && before.hz !== frequency ? before.hz : null;
      const hit = { gain: (VELOCITY[step.vel] ?? 0.78) * (repeat === 0 ? 1 : 0.7) * level, accent: step.vel === 2, pitch: step.pitch, midis, duration, glideFrom, root: project.root };
      // The ring's own sound is its picture or its body; without one (or with an empty picture) it is silent.
      if (settings.sound === ACID_SOUND) {
        if (settings.acid) this.acid[track] = this.playAcid(track, settings, settings.acid, at, hit, quakes, count > 1);
      } else if (settings.sound === VOICE_SOUND) {
        // A voice sings the syllable that this hit is in the ring's line (a roll repeats it).
        if (settings.voice) playVoice(this.graph.kit, inlet, track, settings, at, hit, settings.voice, number);
      } else if (settings.sound === BODY_SOUND) {
        if (settings.body) playBody(this.graph.kit, inlet, track, settings, at, hit, settings.body);
      } else if (settings.sound !== OWN_SOUND) {
        playHit(this.graph.kit, inlet, track, settings, at, hit);
      } else if (settings.bild) {
        playBild(this.graph.kit, inlet, track, settings, at, hit, settings.bild);
      }
      this.last[track] = { hz: frequency, until: at + duration };
      if (track === 0 && project.pump > 0) {
        for (const pumped of [4, 5, 6]) {
          const bus = this.graph.buses[pumped];
          if (bus) duck(bus.pump.gain, at, project.pump * 0.8, { release: 0.1 });
        }
      }
    }
  }

  /**
   * One note of a ring's acid machine. The machine has one voice: the note before lets go, and where it was held
   * into this one, this one slides out of it. Accents that follow closely push one another higher.
   */
  private playAcid(track: number, settings: Track, acid: Acid, at: number, hit: Hit, quakes: boolean, roll: boolean): AcidNote | null {
    const inlet = this.graph.inlets[track];
    if (!inlet) return null;
    const before = this.acid[track] ?? null;
    const tied = before && !roll && !this.rolled[track] && before.until > at - 0.012 ? before : null;
    this.rolled[track] = roll;
    if (before && before.until > at) before.cut(at);
    const charge = this.charge[track];
    if (hit.accent && charge) {
      charge.amount = charged(charge.amount, at - charge.at);
      charge.at = at;
    }
    // The charge an accent meets is what the ones before it left: its own is for the next.
    const met = hit.accent && charge ? charge.amount - 1 : 0;
    return playAcid(this.graph.kit, inlet, at, settings, acid, hit, tied, met, quakes);
  }
}

export interface StepReport {
  /** The step that sounds, counted from the scene's start (a stutter repeats positions). */
  position: number;
  /** The same without stutter: steps since the scene began. */
  local: number;
  scene: number;
  chord: number;
  /** One bit per ring that struck. */
  fired: number;
  time: number;
  duration: number;
  /** While a piece plays: the bar that sounds, with the step inside it as its fraction. `null` otherwise. */
  bar: number | null;
}

function nextFilled(project: Project, from: number): number {
  for (let offset = 1; offset <= project.scenes.length; offset += 1) {
    const index = (from + offset) % project.scenes.length;
    if (project.scenes[index]) return index;
  }
  return from;
}

/** How many bars the chain plays: every filled scene, its chords `repeats` times. */
export function chainBars(project: Project): number {
  return project.scenes.reduce((sum, scene) => sum + (scene ? scene.chords.length * project.repeats : 0), 0);
}

/** Walks through the scenes step by step; the same for the live sound and for renders. */
export class Player {
  scene = 0;
  /** Steps since the scene began: the next one to schedule. */
  local = 0;
  queued: number | null = null;
  /** While the pause is held, drums and bass drop out. */
  pause = false;
  chord = 0;
  /** The bar the piece jumps to at the next bar line. */
  seek: number | null = null;
  /** An effect key holds the master lowpass: the piece leaves it alone meanwhile. */
  filterHeld = false;
  private stutter: { at: number; start: number } | null = null;
  private readonly voices: Voices;
  private readonly skip = new Set<string>();
  private readonly random: Random;
  /** What the bar of the piece that sounds asks for; `null` while no piece plays. */
  private plan: BarPlan | null = null;
  private pieceBar = 0;
  private pieceSteps = 0;
  private barNow = 0;
  private cutoff = 20_000;
  private runUp: { cut(time: number): void } | null = null;
  /** How much the kick and its Nachbeben are pressed into one right now; −1 before the first step. */
  private glued = -1;

  constructor(
    private readonly graph: Graph,
    private readonly project: () => Project,
    private readonly audible: (track: number) => boolean,
    private readonly report: (report: StepReport) => void = () => undefined,
    seed = 20_261_113,
  ) {
    this.voices = new Voices(graph);
    this.random = seeded(seed);
  }

  /** Back to the start of `scene`; a piece begins at bar `bar`. */
  reset(scene: number, bar = 0): void {
    this.scene = scene;
    this.local = 0;
    this.queued = null;
    this.stutter = null;
    this.skip.clear();
    this.plan = null;
    this.pieceBar = bar;
    this.pieceSteps = 0;
    this.seek = null;
    this.glued = -1;
  }

  /** Where the master lowpass sits by the piece's line right now (wide open without a piece). */
  get cutoffNow(): number {
    return this.cutoff;
  }

  /** The piece no longer plays: the run-up stops and the sound opens up again. */
  leavePiece(time: number): void {
    this.runUp?.cut(time);
    this.runUp = null;
    if (this.plan && !this.filterHeld) {
      const frequency = this.graph.lowpass.frequency;
      frequency.cancelScheduledValues(time);
      frequency.setTargetAtTime(20_000, time, 0.08);
    }
    this.cutoff = 20_000;
    this.plan = null;
  }

  /** A bar line of the piece: its scene, who plays, how open the sound is, and run-ups and landings. */
  private barLine(project: Project, time: number, duration: number): void {
    const piece = project.piece;
    const count = barCount(piece);
    if (this.seek !== null) {
      this.pieceBar = wrap(this.seek, count);
      this.seek = null;
    }
    const bar = this.pieceBar % count;
    const plan = planBar(piece, bar);
    if (project.scenes[plan.scene] && plan.scene !== this.scene) {
      this.scene = plan.scene;
      this.local = 0;
      this.stutter = null;
      this.skip.clear();
    }
    this.queued = null;
    const { kit, mix, hall, lowpass } = this.graph;
    if (this.runUp) {
      // The landing after a run-up.
      this.runUp.cut(time);
      this.runUp = null;
      crash(kit, mix, time, 0.36, 1.6).connect(hall);
    }
    if (plan.rise) this.runUp = rise(kit, mix, time, time + BAR * duration, 0.15);
    if (!this.filterHeld) {
      lowpass.frequency.cancelScheduledValues(time);
      lowpass.frequency.setValueAtTime(this.cutoff, time);
      if (plan.cutoff !== this.cutoff) lowpass.frequency.exponentialRampToValueAtTime(plan.cutoff, time + 0.14);
      if (plan.cutoffEnd !== plan.cutoff) lowpass.frequency.exponentialRampToValueAtTime(plan.cutoffEnd, time + BAR * duration);
    }
    this.cutoff = plan.cutoffEnd;
    this.plan = plan;
    this.barNow = bar;
    this.pieceBar = bar + 1;
  }

  /** Repeats the two steps just played for as long as it is held. */
  setStutter(on: boolean): void {
    this.stutter = on ? { at: this.local, start: Math.max(0, this.local - 2) } : null;
  }

  /** A note played by hand lands on step `local` of `track`: the ring must not strike it a second time. */
  skipOnce(track: number, local: number): void {
    if (local >= this.local) this.skip.add(`${track}:${local}`);
  }

  step(time: number, duration: number): void {
    const project = this.project();
    // A piece takes over at a bar line and then decides scene, entries and sound bar by bar.
    if (project.piece.on && (this.plan !== null || this.local % BAR === 0)) {
      if (this.plan === null) this.pieceSteps = 0;
      if (this.pieceSteps % BAR === 0) this.barLine(project, time, duration);
      if (this.plan?.fall && this.pieceSteps % BAR === BAR - 4) {
        // Before a steep fall, the last beat is thrown into the echo.
        this.graph.throwSend.gain.setValueAtTime(0.85, time);
        this.graph.throwSend.gain.setValueAtTime(0, time + 4 * duration);
      }
    } else {
      if (this.plan !== null) this.leavePiece(time);
      if (this.local % BAR === 0) this.changeScene(project);
    }
    const scene = project.scenes[this.scene] ?? currentScene(project);
    const position = this.stutter ? this.stutter.start + ((this.local - this.stutter.at) % 2) : this.local;
    const chord = chordAt(scene, position);
    this.chord = chord;
    let fired = 0;
    // The Nachbeben is the kick's: silent where the kick is (muted, paused, not yet in the piece).
    const kicks = scene.patterns[0];
    const shaking = kicks && this.audible(0) && !this.pause && (!this.plan || (this.plan.gates[0] ?? 0) > 0);
    const quakes = Boolean(shaking && kicks && hasRumble(scene, kicks.len));
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const pattern = scene.patterns[track];
      if (!pattern) continue;
      // The weather over this ring at this step; the wind has carried it on by as far as the Kreisel has played.
      const over = weatherOver(scene, track, position % pattern.len, this.local);
      const chain = this.graph.chains[track];
      if (chain) stepChain(chain, over, time, duration);
      const step = stepAt(pattern, position % pattern.len);
      if (!step.on) continue;
      if (this.skip.delete(`${track}:${this.local}`)) continue;
      if (step.chance > 0 && this.random() >= (CHANCES[step.chance] ?? 1)) continue;
      if (!this.audible(track)) continue;
      if (this.pause && track <= 4) continue;
      // In a piece, a ring plays once the tension has reached it; freshly in, it leaves its quiet steps out.
      const gate = this.plan ? (this.plan.gates[track] ?? 0) : 1;
      if (gate <= 0 || (this.plan && step.vel === 0 && dropsQuiet(gate))) continue;
      fired |= 1 << track;
      this.voices.strike(project, track, step, chord, time, duration, this.plan ? gateLevel(gate) : 1, shadesSound(track) ? brightness(over) : 0, hitNumber(pattern, position % pattern.len, this.local), quakes);
      if (track === 0) hitRumble(this.graph.rumble, time, duration);
    }
    // The Nachbeben: as much as the line in the kick's ring lets out at this step, at the pitch of the bar's chord.
    stepRumble(this.graph.rumble, shaking ? (scene.rumble[position % kicks.len] ?? 0) : 0, midiToHz(bassMidi(project, chord, 0)), time, duration);
    // Where a scene shakes, the kick and the Nachbeben leave as one, the more the dirtier; a kick without one is left alone.
    const glued = quakes ? 0.3 + 0.7 * project.dirt : 0;
    if (glued !== this.glued) {
      shadeGroup(this.graph.group, glued, time, 0.04);
      this.glued = glued;
    }
    const bar = this.plan ? this.barNow + (this.pieceSteps % BAR) / BAR : null;
    this.report({ position, local: this.local, scene: this.scene, chord, fired, time, duration, bar });
    this.local += 1;
    if (this.plan) this.pieceSteps += 1;
  }

  /** Plays one step by hand, over `chord`; a voice sings syllable `number` of its line. */
  play(track: number, step: Step, time: number, chord: number, number = 0): void {
    const project = this.project();
    this.voices.strike(project, track, step, chord, time, stepSeconds(project), 1, 0, number, hasRumble(currentScene(project)));
  }

  private changeScene(project: Project): void {
    let next: number | null = null;
    if (this.queued !== null && project.scenes[this.queued]) {
      next = this.queued;
    } else if (project.chain) {
      const scene = project.scenes[this.scene];
      if (this.local >= (scene?.chords.length ?? 1) * project.repeats * BAR) next = nextFilled(project, this.scene);
    } else if (!project.scenes[this.scene]) {
      next = project.scene;
    }
    this.queued = null;
    if (next === null) return;
    this.scene = next;
    this.local = 0;
    this.stutter = null;
    this.skip.clear();
  }
}

export type FxName = "dumpf" | "duenn" | "stotter" | "wurf" | "pause";
const FX_NAMES: readonly FxName[] = ["dumpf", "duenn", "stotter", "wurf", "pause"];

export interface EngineView {
  /** Whether a ring is heard (not muted, not silenced by another ring's solo). */
  audible(track: number): boolean;
  /** The player moved on to another scene. */
  onScene(scene: number): void;
  /** Playing, recording or an effect changed. */
  onState(): void;
  /** It has stopped, and with that it lets every effect go. */
  onStopped(): void;
  /** The bar a piece starts from. */
  pieceStart(): number;
  /** A step is heard: how many steps the scene has played by now. */
  onStep?(local: number): void;
  /** Scene `index` as it is now. */
  scene?(index: number): Scene | null;
}

export class Engine {
  playing = false;
  recording = false;
  /** The step heard right now, for the runners on the rings. */
  heard: StepReport | null = null;
  /** When each ring last struck, on the listener's clock. */
  readonly struck: number[] = Array.from({ length: TRACK_COUNT }, () => -10);
  /** Which hit of its line each ring last played (a voice sings a syllable a hit). */
  readonly sung: number[] = Array.from({ length: TRACK_COUNT }, () => 0);
  readonly fx: Record<FxName, boolean> = { dumpf: false, duenn: false, stotter: false, wurf: false, pause: false };

  private readonly host = new AudioHost<Graph>((context) => buildGraph(context), { latencyHint: "interactive" });
  private readonly cues = new Cues(() => this.host.visualTime());
  private readonly transport: Transport;
  private player: Player | null = null;
  private recorder: MasterRecorder | null = null;
  private rise: { cut(time: number): void } | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;

  constructor(private readonly project: () => Project, private readonly view: EngineView) {
    this.transport = new Transport({
      stepDuration: () => stepSeconds(this.project()),
      swing: () => this.project().swing * 0.42,
      step: (_step, time) => this.player?.step(time, stepSeconds(this.project())),
      skipGroup: BAR,
    });
  }

  get graph(): Graph | null {
    return this.host.graph;
  }

  /** The listener's clock: the audio clock minus what is still on its way to the speaker. */
  now(): number {
    return this.host.visualTime();
  }

  /** Wakes the sound inside a tap or key press, so the first note is not swallowed. */
  async wake(): Promise<boolean> {
    const first = this.host.context === null;
    const ready = await this.host.unlock();
    if (first && this.host.graph && this.host.context) {
      applyMix(this.host.graph, this.project(), this.view.audible, this.host.context.currentTime, 0.001);
      this.player = new Player(this.host.graph, this.project, this.view.audible, (report) => this.onStep(report));
    }
    return ready;
  }

  async start(): Promise<void> {
    if (this.playing || !(await this.wake())) return;
    const context = this.host.context;
    if (!context || !this.player) return;
    this.player.reset(this.project().scene, this.view.pieceStart());
    this.transport.begin(context, context.currentTime + 0.06);
    this.playing = true;
    // An effect that was switched on while it stood takes hold now: a stutter and a pause need something that plays.
    for (const name of FX_NAMES) if (this.fx[name]) this.applyFx(name);
    this.view.onState();
  }

  stop(): void {
    if (!this.playing) return;
    this.transport.halt();
    this.playing = false;
    this.cues.cancel();
    this.heard = null;
    const graph = this.host.graph;
    if (graph) {
      this.player?.leavePiece(graph.context.currentTime);
      hush(graph, graph.context.currentTime);
    }
    this.view.onStopped();
    for (const name of FX_NAMES) this.setFx(name, false);
    this.view.onState();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else void this.start();
  }

  /** The project changed: bring levels, sends and tempo along. */
  sync(): void {
    const graph = this.host.graph;
    if (graph) applyMix(graph, this.project(), this.view.audible, graph.context.currentTime);
  }

  /** Switch to `scene` at the next bar line (at once when nothing plays). */
  queueScene(scene: number): void {
    if (this.playing && this.player) this.player.queued = scene;
  }

  get queuedScene(): number | null {
    return this.playing ? (this.player?.queued ?? null) : null;
  }

  /** Where the runner of a ring is, in steps since the scene began; `null` when nothing plays. */
  cursor(): number | null {
    const heard = this.heard;
    if (!this.playing || !heard) return null;
    const share = (this.host.visualTime() - heard.time) / heard.duration;
    return heard.position + Math.max(0, Math.min(1, share));
  }

  /** Where a piece is, in bars with fractions; `null` when none plays. */
  pieceCursor(): number | null {
    const heard = this.heard;
    if (!this.playing || !heard || heard.bar === null) return null;
    const share = (this.host.visualTime() - heard.time) / heard.duration;
    return heard.bar + Math.max(0, Math.min(1, share)) / BAR;
  }

  /** Jump to `bar` of the piece at the next bar line. */
  seekPiece(bar: number): void {
    if (this.playing && this.player) this.player.seek = bar;
  }

  /** Plays a step by hand, for the keyboard and for hearing what was just painted. */
  async audition(track: number, step: Step, chord: number, number = 0): Promise<void> {
    if (!(await this.wake())) return;
    const context = this.host.context;
    if (context && this.player) {
      this.player.play(track, step, context.currentTime + 0.008, chord, number);
      this.struck[track] = this.host.visualTime() + 0.008;
      this.sung[track] = number;
    }
  }

  /**
   * The step a note played right now belongs to while the rings turn: the one
   * heard, or the next if that is nearer. The player is told so the ring does
   * not strike a note twice that was just played by hand.
   */
  recordTarget(track: number): number | null {
    const heard = this.heard;
    if (!this.playing || !heard || !this.player) return null;
    const share = (this.host.visualTime() - heard.time) / heard.duration;
    const ahead = share >= 0.5 ? 1 : 0;
    if (ahead === 1) this.player.skipOnce(track, heard.local + 1);
    return heard.position + ahead;
  }

  setFx(name: FxName, on: boolean): void {
    if (this.fx[name] === on) return;
    this.fx[name] = on;
    this.applyFx(name);
    this.view.onState();
  }

  /** Brings the sound in line with whether an effect is on: when it changes, and at the start for one that was on already. */
  private applyFx(name: FxName): void {
    const on = this.fx[name];
    const graph = this.host.graph;
    if (!graph) return;
    const now = graph.context.currentTime;
    if (name === "dumpf") {
      // A piece keeps the lowpass moving by its line: the key takes it over and hands it back.
      if (this.player) this.player.filterHeld = on;
      graph.lowpass.frequency.cancelScheduledValues(now);
      graph.lowpass.frequency.setTargetAtTime(on ? 300 : (this.player?.cutoffNow ?? 20_000), now, on ? 0.2 : 0.07);
      graph.lowpass.Q.setTargetAtTime(on ? 6 : 0.7, now, 0.05);
    } else if (name === "duenn") {
      graph.highpass.frequency.setTargetAtTime(on ? 1300 : 20, now, on ? 0.2 : 0.07);
      graph.highpass.Q.setTargetAtTime(on ? 5 : 0.7, now, 0.05);
    } else if (name === "wurf") {
      graph.throwSend.gain.setTargetAtTime(on ? 0.9 : 0, now, 0.02);
    } else if (name === "stotter") {
      this.player?.setStutter(on && this.playing);
    } else if (this.player) {
      this.player.pause = on && this.playing;
      if (on && this.playing) {
        this.rise = rise(graph.kit, graph.mix, now, now + 2 * BAR * stepSeconds(this.project()), 0.22);
      } else {
        this.rise?.cut(now);
        if (this.rise && this.playing) crash(graph.kit, graph.mix, now + 0.01, 0.4, 1.5).connect(graph.hall);
        this.rise = null;
      }
    }
  }

  /** The loudest sample leaving the master right now, 0..1. */
  level(): number {
    const analyser = this.host.graph?.analyser;
    if (!analyser) return 0;
    this.samples ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  static get canRecord(): boolean {
    return MasterRecorder.supported();
  }

  get recordedSeconds(): number {
    return this.recorder?.seconds ?? 0;
  }

  /** Starts recording what is heard; a second call ends it and returns the file (`null` if it was silent). */
  async toggleRecording(): Promise<SoundFile | null> {
    if (this.recording && this.recorder) {
      const taken = await this.recorder.stop();
      this.recording = false;
      this.view.onState();
      const range = audibleRange(taken);
      if (!range) return null;
      const float = (samples: Int16Array): Float32Array => Float32Array.from(samples.subarray(range.start, range.end), (sample) => sample / 0x8000);
      return soundFile(float(taken.left), float(taken.right), taken.sampleRate, () => encodePcm16Wav(taken, range.start, range.end));
    }
    if (!(await this.wake())) return null;
    const context = this.host.audioContext;
    const graph = this.host.graph;
    if (!context || !graph) return null;
    this.recorder ??= new MasterRecorder(() => void this.toggleRecording());
    await this.recorder.start(context, graph.master.output);
    this.recording = true;
    this.view.onState();
    return null;
  }

  private onStep(report: StepReport): void {
    this.cues.at(report.time, () => {
      const before = this.heard?.scene;
      this.heard = report;
      for (let track = 0; track < TRACK_COUNT; track += 1) {
        if (!(report.fired & (1 << track))) continue;
        this.struck[track] = report.time;
        // Which hit of its ring's line this was (for the mouth that is drawn singing it).
        const pattern = (this.view.scene?.(report.scene))?.patterns[track];
        if (pattern) this.sung[track] = hitNumber(pattern, report.position % pattern.len, report.local);
      }
      if (report.scene !== before) this.view.onScene(report.scene);
      this.view.onStep?.(report.local);
    });
  }
}

export interface RenderPlan {
  /** Steps of music. */
  steps: number;
  seconds: number;
}

/** What a WAV of the project holds: the piece once round, the whole chain, or the scene on the table twice through its chords. */
export function renderPlan(project: Project): RenderPlan {
  const bars = project.piece.on ? barCount(project.piece) : project.chain ? chainBars(project) : currentScene(project).chords.length * 2;
  const steps = bars * BAR;
  return { steps, seconds: steps * stepSeconds(project) + 3 };
}

/** Renders the project faster than it plays: what would be heard, and how many of its samples are music (the rest rings out). */
export async function renderBuffer(project: Project, onProgress: (share: number) => void = () => undefined, sampleRate = 48_000): Promise<{ buffer: AudioBuffer; length: number }> {
  const plan = renderPlan(project);
  const context = new OfflineAudioContext(2, Math.ceil(plan.seconds * sampleRate), sampleRate);
  const graph = buildGraph(context);
  const audible = (track: number): boolean => !project.tracks[track]?.mute;
  applyMix(graph, project, audible, 0, 0.001);
  const player = new Player(graph, () => project, audible);
  player.reset(project.chain ? project.scenes.findIndex((scene) => scene !== null) : project.scene);
  const transport = new Transport({
    stepDuration: () => stepSeconds(project),
    swing: () => project.swing * 0.42,
    step: (step, time) => {
      if (step >= plan.steps) transport.halt();
      else player.step(time, stepSeconds(project));
    },
  });
  transport.begin(context, 0.05);
  const buffer = await renderInChunks(context, (until) => transport.renderUntil(until), plan.seconds, 2, onProgress);
  return { buffer, length: trimmedLength(buffer, Math.round(plan.steps * stepSeconds(project) * sampleRate)) };
}

/** Renders the project and saves it as Opus (as a 16-bit WAV where the browser cannot write Opus). */
export async function renderFile(project: Project, onProgress: (share: number) => void = () => undefined, sampleRate = 48_000): Promise<SoundFile> {
  const { buffer, length } = await renderBuffer(project, onProgress, sampleRate);
  return soundFile(buffer.getChannelData(0).subarray(0, length), buffer.getChannelData(1).subarray(0, length), sampleRate, () => encodeWav(buffer, length));
}

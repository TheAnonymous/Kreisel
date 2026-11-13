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
import { BAR, currentScene, OWN_SOUND, stepAt, TRACK_COUNT, TRACK_INFO, TRACK_KINDS, type Project, type Step } from "../model";
import { bassMidi, chordAt, chordMidis, leadMidi, percMidi } from "../music";
import { seeded, type Random } from "../patterns";
import { playBild } from "./bild";
import { glides, playHit } from "./sounds";

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
  const mix = kit.gain(1);
  mix.connect(master.input);
  const hall = createReverb(kit, hallImpulse(context, 2.4, { decay: 4.5 }), { to: master.input, level: 0.8 });
  const echo = createPingPong(kit, { feedback: 0.42, tone: 3400, to: master.input, level: 0.7 });
  const throwSend = kit.gain(0);
  mix.connect(throwSend).connect(echo.input);
  const buses = TRACK_KINDS.map(() => createBus(context, { level: 0, to: mix, sends: { hall: hall.input, echo: echo.input } }));
  const inlets = buses.map((bus) => {
    const inlet = kit.gain(1);
    inlet.connect(bus.input);
    return inlet;
  });
  let analyser: AnalyserNode | null = null;
  if (typeof AudioContext !== "undefined" && context instanceof AudioContext) {
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    master.output.connect(analyser);
  }
  return { context, kit, master, mix, buses, inlets, hall: hall.input, echo, throwSend, lowpass, highpass, analyser };
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
  });
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
    const bus = graph.buses[index];
    if (bus) inlet.connect(bus.input);
    return inlet;
  });
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

  constructor(private readonly graph: Graph) {}

  /** Plays `step` of ring `track` at `time`; `stepTime` is how long one step lasts. */
  strike(project: Project, track: number, step: Step, chord: number, time: number, stepTime: number): void {
    const settings = project.tracks[track];
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
    const duration = count > 1 ? (stepTime / count) * 0.9 : held * stepTime * 0.92;
    for (let repeat = 0; repeat < count; repeat += 1) {
      const at = time + (repeat * stepTime) / count;
      const frequency = midiToHz(midis[0] ?? 60);
      const before = this.last[track];
      const glideFrom = glides(track, settings.sound) && before && before.until > at - 0.012 && before.hz !== frequency ? before.hz : null;
      const hit = { gain: (VELOCITY[step.vel] ?? 0.78) * (repeat === 0 ? 1 : 0.7), accent: step.vel === 2, pitch: step.pitch, midis, duration, glideFrom };
      // The ring's own sound is its picture; without one (or with an empty one) it is silent.
      if (settings.sound !== OWN_SOUND) playHit(this.graph.kit, inlet, track, settings, at, hit);
      else if (settings.bild) playBild(this.graph.kit, inlet, track, settings, at, hit, settings.bild);
      this.last[track] = { hz: frequency, until: at + duration };
      if (track === 0 && project.pump > 0) {
        for (const pumped of [4, 5, 6]) {
          const bus = this.graph.buses[pumped];
          if (bus) duck(bus.pump.gain, at, project.pump * 0.8, { release: 0.1 });
        }
      }
    }
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
  private stutter: { at: number; start: number } | null = null;
  private readonly voices: Voices;
  private readonly skip = new Set<string>();
  private readonly random: Random;

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

  reset(scene: number): void {
    this.scene = scene;
    this.local = 0;
    this.queued = null;
    this.stutter = null;
    this.skip.clear();
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
    if (this.local % BAR === 0) this.changeScene(project);
    const scene = project.scenes[this.scene] ?? currentScene(project);
    const position = this.stutter ? this.stutter.start + ((this.local - this.stutter.at) % 2) : this.local;
    const chord = chordAt(scene, position);
    this.chord = chord;
    let fired = 0;
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const pattern = scene.patterns[track];
      if (!pattern) continue;
      const step = stepAt(pattern, position % pattern.len);
      if (!step.on) continue;
      if (this.skip.delete(`${track}:${this.local}`)) continue;
      if (step.chance > 0 && this.random() >= (CHANCES[step.chance] ?? 1)) continue;
      if (!this.audible(track)) continue;
      if (this.pause && track <= 4) continue;
      fired |= 1 << track;
      this.voices.strike(project, track, step, chord, time, duration);
    }
    this.report({ position, local: this.local, scene: this.scene, chord, fired, time, duration });
    this.local += 1;
  }

  /** Plays one step by hand, over `chord`. */
  play(track: number, step: Step, time: number, chord: number): void {
    const project = this.project();
    this.voices.strike(project, track, step, chord, time, stepSeconds(project));
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

export interface EngineView {
  /** Whether a ring is heard (not muted, not silenced by another ring's solo). */
  audible(track: number): boolean;
  /** The player moved on to another scene. */
  onScene(scene: number): void;
  /** Playing, recording or an effect changed. */
  onState(): void;
}

export class Engine {
  playing = false;
  recording = false;
  /** The step heard right now, for the runners on the rings. */
  heard: StepReport | null = null;
  /** When each ring last struck, on the listener's clock. */
  readonly struck: number[] = Array.from({ length: TRACK_COUNT }, () => -10);
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
    this.player.reset(this.project().scene);
    this.transport.begin(context, context.currentTime + 0.06);
    this.playing = true;
    this.view.onState();
  }

  stop(): void {
    if (!this.playing) return;
    this.transport.halt();
    this.playing = false;
    this.cues.cancel();
    this.heard = null;
    const graph = this.host.graph;
    if (graph) hush(graph, graph.context.currentTime);
    for (const name of Object.keys(this.fx) as FxName[]) this.setFx(name, false);
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

  /** Plays a step by hand, for the keyboard and for hearing what was just painted. */
  async audition(track: number, step: Step, chord: number): Promise<void> {
    if (!(await this.wake())) return;
    const context = this.host.context;
    if (context && this.player) {
      this.player.play(track, step, context.currentTime + 0.008, chord);
      this.struck[track] = this.host.visualTime() + 0.008;
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
    const graph = this.host.graph;
    if (graph) {
      const now = graph.context.currentTime;
      if (name === "dumpf") {
        graph.lowpass.frequency.setTargetAtTime(on ? 300 : 20_000, now, on ? 0.2 : 0.07);
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
    this.view.onState();
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

  /** Starts recording what is heard; a second call ends it and returns the WAV (`null` if it was silent). */
  async toggleRecording(): Promise<Blob | null> {
    if (this.recording && this.recorder) {
      const taken = await this.recorder.stop();
      this.recording = false;
      this.view.onState();
      const range = audibleRange(taken);
      return range ? new Blob([encodePcm16Wav(taken, range.start, range.end)], { type: "audio/wav" }) : null;
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
        if (report.fired & (1 << track)) this.struck[track] = report.time;
      }
      if (report.scene !== before) this.view.onScene(report.scene);
    });
  }
}

export interface RenderPlan {
  /** Steps of music. */
  steps: number;
  seconds: number;
}

/** What a WAV of the project holds: the whole chain, or the scene on the table twice through its chords. */
export function renderPlan(project: Project): RenderPlan {
  const bars = project.chain ? chainBars(project) : currentScene(project).chords.length * 2;
  const steps = bars * BAR;
  return { steps, seconds: steps * stepSeconds(project) + 3 };
}

/** Renders the project faster than it plays, as a 16-bit WAV. */
export async function renderWav(project: Project, onProgress: (share: number) => void = () => undefined, sampleRate = 44_100): Promise<Blob> {
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
  return new Blob([encodeWav(buffer, trimmedLength(buffer, Math.round(plan.steps * stepSeconds(project) * sampleRate)))], { type: "audio/wav" });
}

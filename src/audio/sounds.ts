import { clap, fmBell, fmPiano, kick, midiToHz, noiseHit, snare, toneHit, voice, type Automation, type FilterSpec, type Kit, type OscSpec } from "klangwerk";
import type { Track } from "../model";
import { drumOf, toneOf, trimOf, type Drum, type Tone } from "../sounds/index";
import type { FilterRow } from "../sounds/shapes";

/*
 * The ready-made sounds of the seven rings, built from Klangwerk's voices.
 * Every sound reads the ring's two macros: x is its tone or brightness, y how
 * long it rings. A step's own pitch tunes a drum (or opens the hi-hat) and
 * picks the note of a tuned ring.
 *
 * A ring's four classics are written out here, as they always were. The
 * other sounds on its palette are recipes (src/sounds/), which the two players
 * below turn into sound: one for what is struck, one for what is played.
 */

export interface Hit {
  /** How loud the step is, 0..1. */
  gain: number;
  accent: boolean;
  /** The step's pitch as stored, in scale steps. */
  pitch: number;
  /** The notes to play: none for kick, snare and hi-hat, one for the others, three for a chord. */
  midis: readonly number[];
  /** Seconds the note is held. */
  duration: number;
  /** Hz a tied note slides in from. */
  glideFrom: number | null;
}

type Play = (kit: Kit, out: AudioNode, time: number, track: Track, hit: Hit) => void;

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
/** Like `lerp`, but even to the ear: for frequencies and times. */
const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const hz = (value: number): number => Math.max(20, Math.min(18_000, value));
const semitones = (count: number): number => 2 ** (count / 12);

// ---- recipes from the palette -------------------------------------------------

const filterOf = ([type, frequency, q, gain]: FilterRow, times = 1): FilterSpec => {
  const at = hz(frequency * times);
  if (q === undefined) return [type, at];
  return gain === undefined ? [type, at, q] : [type, at, q, gain];
};

const CURVES = new Map<number, Float32Array<ArrayBuffer>>();

/** The bend of a distortion: the harder it is driven, the earlier it flattens. */
function curveOf(drive: number): Float32Array<ArrayBuffer> {
  const known = CURVES.get(drive);
  if (known) return known;
  const steepness = 1 + drive * 6;
  const curve = new Float32Array(1025);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.tanh(steepness * (index / 512 - 1)) / Math.tanh(steepness);
  CURVES.set(drive, curve);
  return curve;
}

/**
 * Where a recipe's parts go, and how loud they are sent there. A clean sound goes straight to `out`, and its trim (see
 * trims.ts) is part of how loud it is played. A distorted one goes through the distortion first and is trimmed behind
 * it, so that turning it down does not also make it cleaner.
 */
function route(kit: Kit, out: AudioNode, drive: number | undefined, trim: number): { target: AudioNode; send: number } {
  if (!drive || drive <= 0) return { target: out, send: trim };
  const shaper = kit.context.createWaveShaper();
  shaper.curve = curveOf(drive);
  shaper.oversample = "2x";
  shaper.connect(kit.gain(trim)).connect(out);
  return { target: shaper, send: 1 };
}

/** What a ring's pad and a step's pitch do to a struck recipe. */
interface Shaping {
  /** Multiplies where the tones sound: the tuning (for the tuned drum, the note itself in Hz). */
  tone: number;
  /** Multiplies the frequencies the noise is filtered at. */
  air: number;
  /** Stretches everything that rings. */
  ring: number;
  /** The pad's length as it stands, 0..1. */
  long: number;
}

/** Plays a struck recipe: every part its own little hit. */
function playDrum(kit: Kit, out: AudioNode, time: number, recipe: Drum, gain: number, trim: number, shaping: Shaping): void {
  const { target, send } = route(kit, out, recipe.drive, trim);
  for (const part of recipe.parts) {
    const at = time + (part.after ?? 0);
    const peak = part.level * gain * send;
    if ("clap" in part) {
      clap(kit, target, at, { frequency: hz(part.clap * shaping.air), burst: 1.3 * peak, floor: 0.16 * peak, level: peak, tail: lerp(part.tail[0], part.tail[1], shaping.long) });
      continue;
    }
    const decay = part.decay * (part.tight ? 1 : shaping.ring);
    if ("tone" in part) {
      toneHit(kit, target, at, {
        wave: part.tone,
        frequency: hz(part.at * shaping.tone),
        peak,
        decay,
        attack: part.attack ?? 0.002,
        ...(part.fall ? { drop: { to: hz(part.fall[0] * shaping.tone), time: part.fall[1] } } : {}),
        ...(part.filter ? { filters: [filterOf(part.filter, shaping.tone)] } : {}),
      });
    } else {
      noiseHit(kit, target, at, { duration: decay * 5 + 0.05, filters: part.noise.map((filter) => filterOf(filter, shaping.air)), peak, decay, attack: part.attack ?? 0.001 });
    }
  }
}

/** Plays one note of a played recipe: oscillators through a filter into an amp, with whatever else the recipe asks for. */
function playTone(kit: Kit, out: AudioNode, time: number, recipe: Tone, track: Track, hit: Hit, frequency: number, gain: number, trim: number): void {
  const { x, y } = track;
  const bright = hit.accent ? 1.4 : 1;
  const { target, send } = route(kit, out, recipe.drive, trim);
  const level = recipe.level * gain * send;

  const amp = kit.gain();
  let end: number;
  if (recipe.amp[0] === "hold") {
    const [, attack, sustain, decay, release, releaseLong] = recipe.amp;
    end = kit.hold(amp.gain, time, level, hit.duration, attack, sustain, decay, lerp(release, releaseLong, y));
  } else {
    const [, decay, decayLong, attack] = recipe.amp;
    const rings = Math.max(lerp(decay, decayLong, y), hit.duration * 0.7);
    kit.strike(amp.gain, time, level, rings, attack ?? 0.003);
    end = time + rings + 0.05;
  }
  amp.connect(target);

  let tone: BiquadFilterNode | null = null;
  if (recipe.filter) {
    const { type = "lowpass", from, to, q, env } = recipe.filter;
    const rest = expo(from, to, x) * bright;
    tone = kit.filter(type, hz(rest), q);
    if (env) {
      const [open, seconds, secondsLong] = env;
      tone.frequency.setValueAtTime(hz(rest * open), time);
      tone.frequency.exponentialRampToValueAtTime(hz(rest), time + (secondsLong === undefined ? seconds : lerp(seconds, secondsLong, y)));
    }
    tone.connect(amp);
  }

  const slides = recipe.glide === true && hit.glideFrom !== null;
  const oscs = recipe.oscs.map(([wave, loud = 1, cents = 0, times = 1, direct = false]) => {
    const pitch = frequency * times;
    const osc = kit.osc(wave, pitch, cents);
    const from = slides ? (hit.glideFrom ?? frequency) * times : recipe.bend ? pitch * recipe.bend[0] : null;
    if (from !== null) {
      osc.frequency.setValueAtTime(from, time);
      osc.frequency.exponentialRampToValueAtTime(pitch, time + (slides ? 0.06 : (recipe.bend?.[1] ?? 0.06)));
    }
    osc.connect(kit.gain(typeof loud === "number" ? loud : lerp(loud[0], loud[1], x))).connect(direct || !tone ? amp : tone);
    return osc;
  });

  // What moves the oscillators' pitch: a modulator (FM) and a vibrato, each shared by all of them.
  const movers: OscillatorNode[] = [];
  if (recipe.fm) {
    const { times, index, settle = 0.1, seconds = 0.15 } = recipe.fm;
    const modulator = kit.osc("sine", frequency * times);
    const deep = lerp(index[0], index[1], x) * frequency * bright;
    // The depth starts out at its full value rather than being set to it at the strike: a browser that lets the
    // fall begin from where the gain stood before (Firefox) would otherwise start it from nothing.
    const depth = kit.gain(deep);
    depth.gain.setTargetAtTime(deep * settle, time, seconds);
    modulator.connect(depth);
    for (const osc of oscs) depth.connect(osc.frequency);
    movers.push(modulator);
  }
  if (recipe.vibrato) {
    const [cents, delay = 0.2, rise = 0.2, rate = 5.4] = recipe.vibrato;
    // Only on notes long enough for it.
    if (hit.duration >= delay + 0.05) {
      const lfo = kit.osc("sine", rate);
      const depth = kit.gain();
      depth.gain.setValueAtTime(0, time);
      depth.gain.linearRampToValueAtTime(0, time + delay);
      depth.gain.linearRampToValueAtTime(cents, time + delay + rise);
      lfo.connect(depth);
      for (const osc of oscs) depth.connect(osc.detune);
      movers.push(lfo);
    }
  }
  if (recipe.noise) {
    const [filter, loud, decay, attack = 0.001] = recipe.noise;
    noiseHit(kit, target, time, { duration: decay * 5 + 0.05, filters: [filterOf(filter)], peak: loud * gain * send, decay, attack });
  }
  kit.stopAll([...oscs, ...movers], time, end);
}

// ---- kick -------------------------------------------------------------------

const KICKS = [
  { top: 150, bottom: 48, sweep: 0.08, decay: 0.3, level: 0.95, knockHz: 120, knock: 0.12, clickHz: 3000, click: 0.2 },
  { top: 235, bottom: 54, sweep: 0.05, decay: 0.2, level: 1, knockHz: 140, knock: 0.24, clickHz: 3600, click: 0.42 },
  { top: 105, bottom: 41, sweep: 0.12, decay: 0.75, level: 0.95, knockHz: 100, knock: 0.08, clickHz: 2500, click: 0.1 },
  { top: 128, bottom: 52, sweep: 0.06, decay: 0.2, level: 0.85, knockHz: 90, knock: 0.2, clickHz: 1800, click: 0.08 },
] as const;

const playKick: Play = (kit, out, time, track, hit) => {
  const tune = semitones(hit.pitch) * expo(0.78, 1.3, track.x);
  const recipe = drumOf(0, track.sound);
  if (recipe) {
    playDrum(kit, out, time, recipe, hit.gain, trimOf(0, track.sound), { tone: tune, air: 1, ring: expo(0.5, 2, track.y), long: track.y });
    return;
  }
  const preset = KICKS[track.sound] ?? KICKS[0];
  kick(kit, out, time, {
    top: preset.top * tune,
    bottom: preset.bottom * tune,
    sweep: preset.sweep,
    decay: preset.decay * expo(0.5, 2, track.y),
    level: preset.level * hit.gain,
    knock: { frequency: preset.knockHz * tune, level: preset.knock * hit.gain },
    click: { tone: preset.clickHz, level: preset.click * hit.gain },
  });
};

// ---- snare ------------------------------------------------------------------

const playSnare: Play = (kit, out, time, track, hit) => {
  const tune = semitones(hit.pitch);
  const tone = expo(0.6, 1.7, track.x);
  const ring = expo(0.5, 2.2, track.y);
  const gain = hit.gain;
  const recipe = drumOf(1, track.sound);
  if (recipe) {
    playDrum(kit, out, time, recipe, gain, trimOf(1, track.sound), { tone: tune, air: tone * tune, ring, long: track.y });
    return;
  }
  if (track.sound === 0) {
    snare(kit, out, time, {
      top: 230 * tune,
      bottom: 165 * tune,
      bodyLevel: 0.5 * gain,
      bodyDecay: 0.11 * ring,
      noise: 0.4 * ring,
      filter: ["highpass", hz(2100 * tone)],
      level: 0.5 * gain,
      decay: 0.15 * ring,
    });
  } else if (track.sound === 1) {
    clap(kit, out, time, { frequency: hz(1250 * tone * tune), burst: 1.3 * gain, floor: 0.16 * gain, level: 1 * gain, tail: lerp(0.1, 0.5, track.y) });
  } else if (track.sound === 2) {
    toneHit(kit, out, time, { wave: "square", frequency: hz(820 * tone * tune), filters: [["highpass", 500]], peak: 0.38 * gain, decay: 0.03 * ring, attack: 0.001 });
    noiseHit(kit, out, time, { duration: 0.04, filters: [["bandpass", hz(3400 * tone), 1.4]], peak: 0.5 * gain, decay: 0.014, attack: 0.0005 });
  } else {
    const filters: FilterSpec[] = [["bandpass", hz(2600 * tone * tune), 2.5]];
    noiseHit(kit, out, time, { duration: 0.05, filters, peak: 0.8 * gain, decay: 0.008, attack: 0.0005 });
    noiseHit(kit, out, time + 0.013, { duration: 0.3, filters, peak: 1.7 * gain, decay: 0.05 * ring, attack: 0.0005 });
  }
};

// ---- hi-hat -----------------------------------------------------------------

const HATS: readonly { filters: (bright: number) => FilterSpec[]; peak: number; decay: number; attack: number }[] = [
  { filters: (bright) => [["highpass", hz(7600 * bright)]], peak: 0.42, decay: 0.04, attack: 0.001 },
  { filters: (bright) => [["highpass", hz(5200 * bright)], ["peaking", hz(8300 * bright), 5, 12], ["peaking", hz(11_200 * bright), 6, 9]], peak: 0.24, decay: 0.05, attack: 0.001 },
  { filters: (bright) => [["bandpass", hz(6000 * bright), 0.9]], peak: 0.5, decay: 0.05, attack: 0.014 },
  { filters: (bright) => [["highpass", hz(3800 * bright)], ["peaking", hz(6000 * bright), 1.5, 6]], peak: 0.26, decay: 0.09, attack: 0.002 },
];

const playHat: Play = (kit, out, time, track, hit) => {
  // Outwards the hat opens, inwards it gets even shorter.
  const open = hit.pitch > 0 ? 1 + hit.pitch * 1.1 : 1 / (1 - hit.pitch * 0.25);
  const ring = expo(0.5, 2.4, track.y) * open;
  const bright = expo(0.72, 1.4, track.x);
  const recipe = drumOf(2, track.sound);
  if (recipe) {
    playDrum(kit, out, time, recipe, hit.gain, trimOf(2, track.sound), { tone: bright, air: bright, ring, long: track.y });
    return;
  }
  const preset = HATS[track.sound] ?? HATS[0]!;
  const decay = preset.decay * ring;
  noiseHit(kit, out, time, { duration: decay * 5 + 0.05, filters: preset.filters(bright), peak: preset.peak * hit.gain, decay, attack: preset.attack });
};

// ---- tuned drum -------------------------------------------------------------

const playPerc: Play = (kit, out, time, track, hit) => {
  const base = midiToHz(hit.midis[0] ?? 45) * semitones(lerp(-7, 7, track.x));
  const ring = expo(0.5, 2.2, track.y);
  const gain = hit.gain;
  const recipe = drumOf(3, track.sound);
  if (recipe) {
    playDrum(kit, out, time, recipe, gain, trimOf(3, track.sound), { tone: base, air: 1, ring, long: track.y });
    return;
  }
  if (track.sound === 0) {
    toneHit(kit, out, time, { wave: "sine", frequency: base, drop: { to: base * 0.62, time: 0.14 * ring }, peak: 0.8 * gain, decay: 0.26 * ring, attack: 0.002 });
    noiseHit(kit, out, time, { duration: 0.03, filters: [["bandpass", 2000, 1]], peak: 0.12 * gain, decay: 0.01, attack: 0.0005 });
  } else if (track.sound === 1) {
    toneHit(kit, out, time, { wave: "sine", frequency: base * 2, drop: { to: base * 1.72, time: 0.03 }, peak: 0.7 * gain, decay: 0.16 * ring, attack: 0.001 });
    noiseHit(kit, out, time, { duration: 0.04, filters: [["bandpass", 2500, 1]], peak: 0.2 * gain, decay: 0.012, attack: 0.0005 });
  } else if (track.sound === 2) {
    const filters: FilterSpec[] = [["bandpass", hz(base * 5.2), 1.6]];
    toneHit(kit, out, time, { wave: "square", frequency: base * 4, filters, peak: 0.42 * gain, decay: 0.22 * ring, attack: 0.001 });
    toneHit(kit, out, time, { wave: "square", frequency: base * 5.93, filters, peak: 0.42 * gain, decay: 0.22 * ring, attack: 0.001 });
  } else {
    toneHit(kit, out, time, { wave: "triangle", frequency: base * 8, peak: 0.6 * gain, decay: 0.045 * ring, attack: 0.0005 });
    toneHit(kit, out, time, { wave: "sine", frequency: base * 5.4, peak: 0.3 * gain, decay: 0.02 * ring, attack: 0.0005 });
  }
};

// ---- bass -------------------------------------------------------------------

function glide(hit: Hit): Pick<OscSpec, "glide"> {
  return hit.glideFrom === null ? {} : { glide: { from: hit.glideFrom, time: 0.06 } };
}

/** A filter that opens at the strike and closes to `rest` within `time`. */
const pluck = (rest: number, open: number, time: number): Automation[] => [["set", hz(rest * open), 0], ["exp", hz(rest), time]];

const playBass: Play = (kit, out, time, track, hit) => {
  const frequency = midiToHz(hit.midis[0] ?? 36);
  const gain = hit.gain;
  const recipe = toneOf(4, track.sound);
  if (recipe) {
    playTone(kit, out, time, recipe, track, hit, frequency, gain, trimOf(4, track.sound));
    return;
  }
  const bright = hit.accent ? 1.5 : 1;
  const duration = hit.duration;
  if (track.sound === 0) {
    voice(kit, out, time, {
      oscs: [{ wave: "sine", frequency, direct: true, ...glide(hit) }, { wave: "triangle", frequency, level: lerp(0.15, 0.9, track.x), ...glide(hit) }],
      filter: { type: "lowpass", frequency: hz(expo(180, 1400, track.x) * bright), q: 0.7 },
      amp: { hold: [0.46 * gain, duration, 0.006, 0.9, 0.2, lerp(0.05, 0.5, track.y)] },
      duration,
    });
  } else if (track.sound === 1) {
    const rest = expo(160, 3200, track.x) * bright;
    voice(kit, out, time, {
      oscs: [{ wave: "sawtooth", frequency, detune: -9 }, { wave: "sawtooth", frequency, detune: 9 }, { wave: "sine", frequency, level: 0.8, direct: true }],
      filter: { type: "lowpass", frequency: hz(rest), q: 2.5, env: pluck(rest, 3.5, 0.16) },
      amp: { hold: [0.24 * gain, duration, 0.005, 0.8, 0.25, lerp(0.05, 0.45, track.y)] },
      duration,
    });
  } else if (track.sound === 2) {
    const rest = expo(110, 1500, track.x);
    voice(kit, out, time, {
      oscs: [{ wave: "sawtooth", frequency, ...glide(hit) }],
      filter: { type: "lowpass", frequency: hz(rest), q: 13, env: pluck(rest, hit.accent ? 10 : 5, lerp(0.08, 0.5, track.y)) },
      amp: { hold: [0.46 * gain, duration * 0.9, 0.004, 0.75, 0.15, 0.06] },
      duration,
    });
  } else {
    const rest = expo(250, 2600, track.x) * bright;
    voice(kit, out, time, {
      oscs: [{ wave: "square", frequency, level: 0.5 }, { wave: "sine", frequency, level: 0.9, direct: true }],
      filter: { type: "lowpass", frequency: hz(rest * 0.6), q: 4, env: pluck(rest * 0.6, 6.5, 0.07) },
      amp: { strike: [0.75 * gain, Math.max(lerp(0.12, 0.7, track.y), duration * 0.8), 0.003] },
      duration,
    });
  }
};

// ---- chords -----------------------------------------------------------------

const playChord: Play = (kit, out, time, track, hit) => {
  const gain = hit.gain / Math.sqrt(Math.max(1, hit.midis.length));
  const bright = hit.accent ? 1.4 : 1;
  const duration = hit.duration;
  const recipe = toneOf(5, track.sound);
  for (const midi of hit.midis) {
    const frequency = midiToHz(midi);
    if (recipe) {
      playTone(kit, out, time, recipe, track, hit, frequency, gain, trimOf(5, track.sound));
    } else if (track.sound === 0) {
      voice(kit, out, time, {
        oscs: [{ wave: "sawtooth", frequency, detune: -8 }, { wave: "sawtooth", frequency, detune: 8 }],
        filter: { type: "lowpass", frequency: hz(expo(350, 5200, track.x) * bright), q: 0.8 },
        amp: { hold: [0.2 * gain, duration, 0.06, 0.85, 0.5, lerp(0.15, 1.6, track.y)] },
        duration,
      });
    } else if (track.sound === 1) {
      const rest = expo(400, 4500, track.x) * bright;
      voice(kit, out, time, {
        oscs: [{ wave: "sawtooth", frequency }, { wave: "square", frequency, level: 0.5, detune: 6 }],
        filter: { type: "lowpass", frequency: hz(rest), q: 3, env: pluck(rest, 4, 0.12) },
        amp: { strike: [0.42 * gain, Math.max(lerp(0.12, 0.9, track.y), duration * 0.7), 0.003] },
        duration,
      });
    } else if (track.sound === 2) {
      fmPiano(kit, out, time, { frequency, index: frequency * lerp(0.4, 3, track.x) * bright, level: 0.32 * gain, duration: duration * lerp(0.6, 1.6, track.y) });
    } else {
      voice(kit, out, time, {
        oscs: [{ wave: "sine", frequency }, { wave: "sine", frequency: frequency * 2, level: lerp(0.2, 0.7, track.x) }, { wave: "sine", frequency: frequency * 3, level: lerp(0, 0.4, track.x) * bright }],
        amp: { hold: [0.2 * gain, duration, 0.008, 1, 0.1, lerp(0.04, 0.5, track.y)] },
        duration,
      });
    }
  }
};

// ---- melody -----------------------------------------------------------------

const playLead: Play = (kit, out, time, track, hit) => {
  const frequency = midiToHz(hit.midis[0] ?? 69);
  const gain = hit.gain;
  const recipe = toneOf(6, track.sound);
  if (recipe) {
    playTone(kit, out, time, recipe, track, hit, frequency, gain, trimOf(6, track.sound));
    return;
  }
  const bright = hit.accent ? 1.4 : 1;
  const duration = hit.duration;
  if (track.sound === 0) {
    const rest = expo(500, 5000, track.x) * bright;
    voice(kit, out, time, {
      oscs: [{ wave: "sawtooth", frequency }, { wave: "triangle", frequency, level: 0.5, detune: 5 }],
      filter: { type: "lowpass", frequency: hz(rest), q: 2.5, env: pluck(rest, 5, 0.1) },
      amp: { strike: [0.42 * gain, Math.max(lerp(0.12, 1.1, track.y), duration * 0.7), 0.003] },
      duration,
    });
  } else if (track.sound === 1) {
    fmBell(kit, out, time, { frequency, index: frequency * lerp(0.8, 5, track.x) * bright, ratio: 3.5, level: 0.36 * gain, decay: Math.max(lerp(0.3, 2.2, track.y), duration) });
  } else if (track.sound === 2) {
    voice(kit, out, time, {
      oscs: [{ wave: "sine", frequency, vibrato: { cents: 14, delay: 0.12, rise: 0.15 }, ...glide(hit) }, { wave: "triangle", frequency, level: lerp(0, 0.5, track.x) * bright, ...glide(hit) }],
      amp: { hold: [0.25 * gain, duration, 0.025, 0.9, 0.1, lerp(0.06, 0.6, track.y)] },
      duration,
    });
  } else {
    voice(kit, out, time, {
      oscs: [{ wave: "sawtooth", frequency, detune: -7, vibrato: { cents: 9 } }, { wave: "sawtooth", frequency, detune: 7 }],
      filter: { type: "lowpass", frequency: hz(expo(700, 6500, track.x) * bright), q: 1.8 },
      amp: { hold: [0.24 * gain, duration, 0.012, 0.75, 0.2, lerp(0.06, 0.7, track.y)] },
      duration,
    });
  }
};

const PLAYERS: readonly Play[] = [playKick, playSnare, playHat, playPerc, playBass, playChord, playLead];

/** Sounds whose tied notes slide into each other: of the classics the acid bass, the sub and the whistle, and from the palette whatever says so. */
export function glides(trackIndex: number, sound: number): boolean {
  const recipe = toneOf(trackIndex, sound);
  if (recipe) return recipe.glide === true;
  return (trackIndex === 4 && (sound === 0 || sound === 2)) || (trackIndex === 6 && sound === 2);
}

export function playHit(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit): void {
  PLAYERS[trackIndex]?.(kit, out, time, track, hit);
}

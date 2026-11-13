import { clap, fmBell, fmPiano, kick, midiToHz, noiseHit, snare, toneHit, voice, type Automation, type FilterSpec, type Kit, type OscSpec } from "klangwerk";
import type { Track } from "../model";

/*
 * The sounds of the seven rings, four each, built from Klangwerk's voices.
 * Every sound reads the ring's two macros: x is its tone or brightness, y how
 * long it rings. A step's own pitch tunes a drum (or opens the hi-hat) and
 * picks the note of a tuned ring.
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

// ---- kick -------------------------------------------------------------------

const KICKS = [
  { top: 150, bottom: 48, sweep: 0.08, decay: 0.3, level: 0.95, knockHz: 120, knock: 0.12, clickHz: 3000, click: 0.2 },
  { top: 235, bottom: 54, sweep: 0.05, decay: 0.2, level: 1, knockHz: 140, knock: 0.24, clickHz: 3600, click: 0.42 },
  { top: 105, bottom: 41, sweep: 0.12, decay: 0.75, level: 0.95, knockHz: 100, knock: 0.08, clickHz: 2500, click: 0.1 },
  { top: 128, bottom: 52, sweep: 0.06, decay: 0.2, level: 0.85, knockHz: 90, knock: 0.2, clickHz: 1800, click: 0.08 },
] as const;

const playKick: Play = (kit, out, time, track, hit) => {
  const preset = KICKS[track.sound] ?? KICKS[0];
  const tune = semitones(hit.pitch) * expo(0.78, 1.3, track.x);
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
  const preset = HATS[track.sound] ?? HATS[0]!;
  // Outwards the hat opens, inwards it gets even shorter.
  const open = hit.pitch > 0 ? 1 + hit.pitch * 1.1 : 1 / (1 - hit.pitch * 0.25);
  const decay = preset.decay * expo(0.5, 2.4, track.y) * open;
  noiseHit(kit, out, time, { duration: decay * 5 + 0.05, filters: preset.filters(expo(0.72, 1.4, track.x)), peak: preset.peak * hit.gain, decay, attack: preset.attack });
};

// ---- tuned drum -------------------------------------------------------------

const playPerc: Play = (kit, out, time, track, hit) => {
  const base = midiToHz(hit.midis[0] ?? 45) * semitones(lerp(-7, 7, track.x));
  const ring = expo(0.5, 2.2, track.y);
  const gain = hit.gain;
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
  for (const midi of hit.midis) {
    const frequency = midiToHz(midi);
    if (track.sound === 0) {
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

/** Sounds whose tied notes slide into each other: the acid bass, the sub and the whistle. */
export function glides(trackIndex: number, sound: number): boolean {
  return (trackIndex === 4 && (sound === 0 || sound === 2)) || (trackIndex === 6 && sound === 2);
}

export function playHit(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit): void {
  PLAYERS[trackIndex]?.(kit, out, time, track, hit);
}

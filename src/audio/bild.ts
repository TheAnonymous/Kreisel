import { midiToHz, type Kit } from "klangwerk";
import { heightToHz, strokeLevel } from "../bild";
import { TIME_MAX, trackInfo, type Bild, type Stroke, type Track } from "../model";
import type { Hit } from "./sounds";

/*
 * Makes a painted sound audible. Every stroke becomes one oscillator (or one
 * band of noise) whose pitch follows the stroke through time and whose
 * loudness follows the paint running out. A ring that plays notes moves the
 * whole picture to each note; where the picture holds, a long note stands
 * still until it ends and then plays the rest.
 */

const SIZE = [0.36, 0.64, 1] as const;
/** A saw is much louder than a sine of the same height. */
const KIND = [0.62, 0.26, 0.5] as const;
/** Evens out painted sounds against each ring's built-in ones (measured, ring by ring). */
const RING = [0.9, 0.8, 1, 1.15, 0.72, 0.58, 0.6] as const;
const ATTACK = 0.004;
const RELEASE = 0.014;
/** A dab of the brush is this long. */
const DAB = 0.022;

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const hz = (value: number): number => Math.max(20, Math.min(18_000, value));
const semitones = (count: number): number => 2 ** (count / 12);

/** How long the whole picture lasts for this ring, in seconds: the sound pad's vertical axis stretches it. */
export function bildSeconds(trackIndex: number, track: Track, pitch = 0): number {
  const base = expo(0.4, 2.5, track.y);
  // An open hi-hat takes longer over the same picture.
  if (trackIndex === 2) return base * (pitch > 0 ? 1 + pitch * 0.5 : 1 / (1 - pitch * 0.25));
  return base;
}

interface Moment {
  /** Seconds after the note began. */
  at: number;
  hz: number;
  level: number;
}

/**
 * A stroke as moments in time. `hold` is where the picture stands still (a
 * share of its width, or `null`), `extra` how many seconds it stands there.
 */
export function strokeMoments(stroke: Stroke, span: number, hold: number | null, extra: number, ratio: number): Moment[] {
  const count = stroke.points.length >> 1;
  const raw: { t: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) raw.push({ t: (stroke.points[index * 2] ?? 0) / TIME_MAX, y: stroke.points[index * 2 + 1] ?? 0 });
  const first = raw[0];
  if (!first) return [];
  const dab = DAB / span;
  let last = raw[raw.length - 1] ?? first;
  if (last.t - first.t < dab) {
    last = { t: first.t + dab, y: last.y };
    raw.splice(1, raw.length, last);
  }
  const length = last.t - first.t;
  const moments: Moment[] = [];
  const add = (t: number, y: number, held: boolean): void => {
    const at = t * span + (held ? extra : 0);
    const before = moments[moments.length - 1];
    moments.push({ at: before ? Math.max(at, before.at + 0.0002) : at, hz: hz(heightToHz(y) * ratio), level: strokeLevel(stroke, (t - first.t) / length) });
  };
  for (let index = 0; index < raw.length; index += 1) {
    const point = raw[index]!;
    const before = raw[index - 1];
    if (hold !== null && before && before.t <= hold && point.t > hold) {
      // The stroke crosses the hold: it arrives there, waits, and goes on.
      const share = (hold - before.t) / (point.t - before.t);
      const y = lerp(before.y, point.y, share);
      add(hold, y, false);
      if (extra > 0) add(hold, y, true);
    }
    add(point.t, point.y, hold !== null && point.t > hold);
  }
  return moments;
}

function playStroke(kit: Kit, out: AudioNode, time: number, stroke: Stroke, moments: readonly Moment[], peak: number): void {
  const first = moments[0];
  const last = moments[moments.length - 1];
  if (!first || !last) return;
  const context = kit.context;
  const start = time + first.at;
  const end = time + last.at;
  // Low tones need more level to be heard as loud as high ones (a kick is judged by where it lands), bright hiss needs less.
  const lowest = moments.reduce((low, moment) => Math.min(low, moment.hz), first.hz);
  const tilt = stroke.kind === 2 ? Math.min(1, (2000 / first.hz) ** 0.3) : Math.max(0.45, Math.min(1.5, (250 / lowest) ** 0.3));
  const top = peak * (SIZE[stroke.size] ?? 1) ** 1.2 * (KIND[stroke.kind] ?? 1) * tilt;
  const amp = kit.gain(0);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(top * first.level, start + ATTACK);

  let pitch: AudioParam;
  let source: AudioScheduledSourceNode;
  if (stroke.kind === 2) {
    const noise = context.createBufferSource();
    noise.buffer = kit.noise;
    noise.loop = true;
    const band = kit.filter("bandpass", first.hz, 1.1);
    noise.connect(band).connect(amp);
    noise.start(start, ((start * 7.31) % 1.5) + 0.01);
    pitch = band.frequency;
    source = noise;
  } else {
    const osc = context.createOscillator();
    osc.type = stroke.kind === 1 ? "sawtooth" : "sine";
    osc.connect(amp);
    osc.start(start);
    pitch = osc.frequency;
    source = osc;
  }
  pitch.setValueAtTime(first.hz, start);
  for (let index = 1; index < moments.length; index += 1) {
    const moment = moments[index]!;
    const at = time + moment.at;
    pitch.exponentialRampToValueAtTime(moment.hz, at);
    amp.gain.linearRampToValueAtTime(top * moment.level, Math.max(at, start + ATTACK + index * 0.0002));
  }
  amp.gain.linearRampToValueAtTime(0, end + RELEASE);
  source.stop(end + RELEASE + 0.02);
  amp.connect(out);
}

/** Plays the ring's picture as one hit: once for a drum, once per note for a ring that plays notes. */
export function playBild(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit, bild: Bild): void {
  if (bild.strokes.length === 0) return;
  const info = trackInfo(trackIndex);
  const span = bildSeconds(trackIndex, track, hit.pitch);
  // Rings whose pad says "Ton" tune the picture with it; the others shade its brightness.
  const tunes = info.xLabel === "Ton";
  const tune = tunes ? semitones(lerp(-7, 7, track.x)) : 1;
  const ratios = info.refHz > 0
    ? hit.midis.map((midi) => (midiToHz(midi) / info.refHz) * tune)
    : [semitones(trackIndex === 2 ? 0 : hit.pitch) * tune];
  const hold = info.melodic && bild.hold !== null ? bild.hold / TIME_MAX : null;
  const extra = hold === null ? 0 : Math.max(0, hit.duration - hold * span);
  const paint = bild.strokes.reduce((sum, stroke) => sum + (SIZE[stroke.size] ?? 1), 0);
  const peak = (hit.gain * 0.9 * (RING[trackIndex] ?? 1)) / Math.max(1, paint) ** 0.5 / Math.sqrt(ratios.length);

  for (const ratio of ratios) {
    let into = out;
    if (!tunes && Math.abs(track.x - 0.5) > 0.05) {
      const shade = track.x < 0.5 ? kit.filter("lowpass", expo(280, 15_000, track.x / 0.45), 0.7) : kit.filter("highshelf", 2200, 0.7);
      if (track.x > 0.5) shade.gain.value = ((track.x - 0.55) / 0.45) * 11;
      shade.connect(out);
      into = shade;
    }
    for (const stroke of bild.strokes) {
      playStroke(kit, into, time, stroke, strokeMoments(stroke, span, hold, extra, ratio), peak);
    }
  }
}

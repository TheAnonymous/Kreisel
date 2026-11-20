import { Kit } from "klangwerk";
import { TRACK_INFO, TRACK_KINDS, type Project } from "../model";
import { bassMidi, chordMidis, leadMidi, percMidi } from "../music";
import { playHit } from "./sounds";

/*
 * One hit of a ready-made sound by itself, rendered faster than it plays,
 * and what can be measured on it: for bringing a ring's palette to an even
 * loudness (`npm run level`) and for the tests. No bus, no hall, no weather:
 * only what the sound itself puts out.
 */

export interface Heard {
  /** The highest sample. */
  peak: number;
  /** The loudest twentieth of a second, as its root mean square. */
  loud: number;
  /** Seconds until it has fallen 40 dB below its peak for good. */
  seconds: number;
  /** How bright it is: the Hz that as many zero crossings would make in a pure tone. */
  bright: number;
}

const SAMPLE_RATE = 44_100;
const WINDOW = Math.round(SAMPLE_RATE / 20);

export function measure(samples: Float32Array, sampleRate = SAMPLE_RATE): Heard {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  let loud = 0;
  for (let start = 0; start + WINDOW <= samples.length; start += WINDOW >> 1) {
    let sum = 0;
    for (let index = start; index < start + WINDOW; index += 1) sum += (samples[index] ?? 0) ** 2;
    loud = Math.max(loud, Math.sqrt(sum / WINDOW));
  }
  let last = samples.length - 1;
  while (last > 0 && Math.abs(samples[last] ?? 0) <= peak / 100) last -= 1;
  let crossings = 0;
  for (let index = 1; index <= last; index += 1) {
    if ((samples[index] ?? 0) >= 0 !== (samples[index - 1] ?? 0) >= 0) crossings += 1;
  }
  return { peak, loud, seconds: last / sampleRate, bright: last === 0 ? 0 : (crossings / 2) * (sampleRate / last) };
}

/**
 * Renders one hit of ring `track` with ready-made sound `sound` and the pad's
 * point at (x, y): a plain hit at the ring's own pitch, in the project's key,
 * half a second long for the rings that play notes (so that a slow sound has arrived).
 */
export async function hear(project: Project, track: number, sound: number, x = 0.5, y = 0.5, seconds = 3): Promise<Heard> {
  const settings = project.tracks[track];
  if (!settings) return { peak: 0, loud: 0, seconds: 0, bright: 0 };
  const context = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const kit = new Kit(context, { noiseSeed: 4711 });
  const midis = track === 3 ? [percMidi(project, 0)] : track === 4 ? [bassMidi(project, 0, 0)] : track === 5 ? chordMidis(project, 0, 0) : track === 6 ? [leadMidi(project, 0)] : [];
  const melodic = TRACK_INFO[TRACK_KINDS[track] ?? "kick"].melodic;
  playHit(kit, context.destination, track, { ...settings, sound, x, y }, 0.01, { gain: 0.78, accent: false, pitch: 0, midis, duration: melodic ? 0.5 : 0.1, glideFrom: null });
  const buffer = await context.startRendering();
  return measure(buffer.getChannelData(0));
}

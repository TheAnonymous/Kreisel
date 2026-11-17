import { midiToHz, type Kit } from "klangwerk";
import { drumHz, renderBody, sustains, type Shading } from "../body";
import { trackInfo, type Body, type Track } from "../model";
import type { Hit } from "./sounds";

/*
 * Makes a Klangkörper audible. The body's sound is worked out once as a
 * stretch of samples (body.ts) and kept; a hit plays it back. A note within
 * half an octave of a kept sound plays that one a little faster or slower,
 * which is what a slightly smaller or bigger body would do anyway. A ring
 * has one body: a new hit takes over from the one still ringing, as a bar
 * struck again does.
 */

interface Kept {
  buffer: AudioBuffer;
  /** The pitch the samples were made for. */
  hz: number;
  loopStart: number;
  loopEnd: number;
  release: number;
}

const kept = new Map<string, Kept>();
const MOST = 56;

/** Evens out bodies against each ring's built-in sounds (measured, ring by ring). */
const RING = [0.72, 0.9, 0.6, 0.52, 0.95, 0.88, 0.8] as const;
/** A bowed or blown body has no blow to be loud with: it is lifted to stand beside the struck ones (measured, too). */
const SUSTAINED = 2;

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const semitones = (count: number): number => 2 ** (count / 12);

function soundFor(context: BaseAudioContext, body: Body, hz: number, shading: Shading): Kept {
  // Half-octave bands: the kept sound is never played more than three semitones off.
  const band = Math.round(Math.log2(hz / 55) * 2);
  const center = 55 * 2 ** (band / 2);
  const rate = context.sampleRate;
  const key = [body.kind, body.size, body.tight, body.material, body.exciter, body.where, band, rate, shading.tuned ? 1 : 0, shading.bright, shading.ring, shading.force].join("|");
  const found = kept.get(key);
  if (found) {
    // Used again: it goes to the back of the queue for being dropped.
    kept.delete(key);
    kept.set(key, found);
    return found;
  }
  const rendered = renderBody(body, center, rate, shading);
  const buffer = new AudioBuffer({ length: rendered.samples.length, sampleRate: rate, numberOfChannels: 1 });
  buffer.copyToChannel(rendered.samples as Float32Array<ArrayBuffer>, 0);
  const made = { buffer, hz: center, loopStart: rendered.loopStart / rate, loopEnd: rendered.loopEnd / rate, release: rendered.release };
  kept.set(key, made);
  if (kept.size > MOST) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  return made;
}

/** What still rings in each ring's inlet. */
const ringing = new WeakMap<AudioNode, { hush: GainNode; source: AudioBufferSourceNode }[]>();

/** Plays the ring's body as one hit: once for a drum, once per note for a ring that plays notes. */
export function playBody(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit, body: Body): void {
  const info = trackInfo(trackIndex);
  const context = kit.context;
  const tuned = info.refHz > 0;
  // Rings whose pad says "Ton" tune the body with it; the others shade its brightness.
  const tunes = info.xLabel === "Ton";
  const tune = tunes ? semitones(lerp(-7, 7, track.x)) : 1;
  // An open hi-hat rings longer on the same body.
  const open = trackIndex === 2 ? (hit.pitch > 0 ? 1 + hit.pitch * 0.5 : 1 / (1 - hit.pitch * 0.25)) : 1;
  const shading: Shading = {
    tuned,
    bright: tunes ? 0.5 : Math.round(track.x * 16) / 16,
    ring: 2 ** (Math.round(Math.log2(expo(0.4, 2.2, track.y) * open) * 4) / 4),
    force: hit.accent ? 2 : hit.gain < 0.6 ? 0 : 1,
  };
  const pitches = tuned
    ? hit.midis.map((midi) => midiToHz(midi) * tune)
    : [drumHz(body) * semitones(trackIndex === 2 ? 0 : hit.pitch) * tune];

  // The body is struck again: what it was still sounding gives way.
  for (const old of ringing.get(out) ?? []) {
    old.hush.gain.setTargetAtTime(0, time, 0.016);
    try {
      old.source.stop(time + 0.16);
    } catch {
      // It has stopped already.
    }
  }
  const voices: { hush: GainNode; source: AudioBufferSourceNode }[] = [];
  const held = sustains(body);
  pitches.forEach((pitch, index) => {
    const sound = soundFor(context, body, pitch, shading);
    const source = context.createBufferSource();
    source.buffer = sound.buffer;
    source.playbackRate.value = pitch / sound.hz;
    // Low tones need more level to be heard as loud as high ones.
    const tilt = Math.max(0.6, Math.min(1.5, (250 / pitch) ** 0.25));
    const amp = kit.gain((hit.gain * 0.9 * (RING[trackIndex] ?? 1) * tilt * (held ? SUSTAINED : 1)) / Math.sqrt(pitches.length));
    const hush = kit.gain(1);
    source.connect(amp).connect(hush).connect(out);
    // Plucked and struck chords are rolled a little, from the lowest note up.
    const at = time + (held ? 0 : index * 0.011);
    source.start(at);
    if (held) {
      source.loop = true;
      source.loopStart = sound.loopStart;
      source.loopEnd = sound.loopEnd;
      // A bow needs a moment even where the note is short.
      const end = at + Math.max(hit.duration, 0.16);
      amp.gain.setTargetAtTime(0, end, sound.release);
      source.stop(end + sound.release * 7 + 0.05);
    }
    voices.push({ hush, source });
  });
  ringing.set(out, voices);
}

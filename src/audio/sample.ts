import type { Kit } from "klangwerk";
import type { Sample, Track } from "../model";
import { hitSemitones, HIT, homeMidi, MAX_SECONDS, padFilter, padLength, padSteps, playedSpan, rateOf, rootHz, sliceOf, sliceRate, sliceSpan, stretchOf } from "../sample";
import { levelFor, mixdown, reversed } from "../sample-analysis";
import { decodeAiff, decodeWav, sniff, type Pcm } from "../sample-files";
import { cycleFor, stretch } from "../stretch";
import type { Hit } from "./sounds";

/*
 * A ring's sample, as sound. A recording is decoded once (by the browser
 * itself for the formats it reads; AIFF, which no browser reads, by
 * src/sample-files.ts) and kept ready here under its name. A hit then plays a
 * stretch of that buffer: all of the played part for a hit, one slice of it
 * in slices, faster or slower as its pitch asks. Where it is stretched, the
 * played part is made longer first (src/stretch.ts) and kept: a stretched
 * recording is one more buffer, not a way of playing.
 *
 * A ring's sample has one voice: a new hit lets the one before it go. That is
 * what keeps a chopped break tight and a long shout from piling up on itself.
 */

/** A recording that is ready to be played. */
export interface Ready {
  buffer: AudioBuffer;
  /** The same turned round, made when a ring first plays it backwards. */
  turned: AudioBuffer | null;
  /** Parts of it made longer or shorter at their own pitch, by what they were made of: the few that were asked for last. */
  stretched: Map<string, AudioBuffer>;
  seconds: number;
  /** The factor that brings it to the level the rings' own sounds have. */
  even: number;
}

/** The recordings that are ready, by the name they are kept under. One set for the page: what plays live and what is rendered offline share it. */
const ready = new Map<string, Ready>();

/** The rate everything is decoded at: the rate the Kreisel is rendered at, and the one most sound cards run at. */
const RATE = 48_000;
/**
 * A hit comes in over `IN` seconds (nearly at once: a drum keeps its edge) while the one before it goes out over the
 * same time, both in a straight line. So a slice that follows straight on from the one before it (a hit on every step
 * of a record that fits its steps) is heard without a seam: the two are the same sound there and add up to it. A
 * sound that ends by itself, or is cut short by the pad, goes out over `OUT`.
 */
const IN = 0.0005;
const OUT = 0.006;
/** How many stretched parts of one recording are kept: a tempo that is being moved asks for a new one at every stop. */
const KEPT = 3;
/** Evens out samples against each ring's built-in sounds (the level a recording is brought to is the same for all rings; the rings' own sounds are not equally loud). */
const RING = [1, 0.9, 0.8, 0.9, 0.9, 0.7, 0.75] as const;

/**
 * Decodes a sound file. The browser reads what it can (WAV, MP3, Ogg Vorbis, Opus, FLAC, AAC, WebM); what it cannot
 * (AIFF, a WAV it does not like) is read here. Throws with a sentence for the page when nothing can read it.
 */
export async function decodeSound(bytes: ArrayBuffer): Promise<Pcm> {
  const kind = sniff(new Uint8Array(bytes));
  const own = (): Pcm | null => (kind.format === "aiff" ? decodeAiff(new Uint8Array(bytes)) : kind.format === "wav" ? decodeWav(new Uint8Array(bytes)) : null);
  if (kind.format === "aiff") {
    const pcm = own();
    if (pcm) return pcm;
    throw new Error(`This is ${kind.label}, but in a form the Kreisel cannot read (it is compressed).`);
  }
  if (kind.format === "midi") throw new Error("This is a MIDI file: notes, not sound. The sampler takes recordings.");
  try {
    // Decoding empties the bytes it is given: it gets a copy.
    const buffer = await new OfflineAudioContext(2, 1, RATE).decodeAudioData(bytes.slice(0));
    // No more of it is copied than a ring takes (and one sample more, by which it is seen that there was more).
    const most = Math.floor(MAX_SECONDS * buffer.sampleRate) + 1;
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) => buffer.getChannelData(channel).slice(0, most));
    if (channels.length === 0 || buffer.length === 0) throw new Error("empty");
    return { channels, sampleRate: buffer.sampleRate };
  } catch {
    const pcm = own();
    if (pcm) return pcm;
    if (kind.format === "unknown") throw new Error("This file is not a sound the Kreisel can read. It takes WAV, AIFF, MP3, Ogg, Opus, FLAC and M4A.");
    if (kind.format === "wav") throw new Error("This WAV is in a form the Kreisel cannot read (it is compressed, or has many channels). Save it as a plain 16- or 24-bit WAV, or as FLAC, MP3, Ogg or Opus.");
    if (kind.format === "mp4") throw new Error("This M4A could not be read. It may hold Apple Lossless, which browsers do not play. Save it as WAV, FLAC, MP3, Ogg or Opus.");
    throw new Error(`This browser cannot read this file (${kind.label}). Try WAV, FLAC, MP3, Ogg or Opus.`);
  }
}

/** Makes a decoded recording ready under `id` (cut to the longest a ring takes), and says how long it is. */
export function takeSound(id: string, pcm: Pcm): Ready {
  const length = Math.min(pcm.channels[0]?.length ?? 0, Math.floor(MAX_SECONDS * pcm.sampleRate));
  const buffer = new AudioBuffer({ length: Math.max(1, length), sampleRate: pcm.sampleRate, numberOfChannels: Math.max(1, pcm.channels.length) });
  pcm.channels.forEach((channel, index) => buffer.copyToChannel(channel.subarray(0, length), index));
  const made: Ready = { buffer, turned: null, stretched: new Map(), seconds: buffer.duration, even: levelFor(mixdown(pcm.channels.map((channel) => channel.subarray(0, length))), pcm.sampleRate) };
  // Taken anew it is the newest: what is let go first is what came first.
  ready.delete(id);
  ready.set(id, made);
  return made;
}

/** The recording kept ready under `id`, if it is. */
export const readySound = (id: string): Ready | undefined => ready.get(id);

/** Forgets what is ready under `id` (its recording was dropped). */
export const forgetSound = (id: string): boolean => ready.delete(id);

/** How many recordings stay ready although no ring names them: the ones tried last, for going back and forth. */
const SPARE = 4;

/**
 * Lets go of decoded recordings that nothing names any more (a minute of sound is 23 MB once decoded), all but the
 * few that came last. Says which went, so that they are looked for again when a ring names them once more.
 */
export function spareSounds(named: ReadonlySet<string>): string[] {
  const loose = [...ready.keys()].filter((id) => !named.has(id));
  const gone = loose.slice(0, Math.max(0, loose.length - SPARE));
  for (const id of gone) ready.delete(id);
  return gone;
}

/** One channel of a ready recording as numbers (both as one), for looking at it: its waveform, its hits, its pitch. */
export function soundOf(made: Ready): Float32Array {
  return mixdown(Array.from({ length: made.buffer.numberOfChannels }, (_, channel) => made.buffer.getChannelData(channel)));
}

function turnedRound(made: Ready): AudioBuffer {
  if (!made.turned) {
    const { buffer } = made;
    const turned = new AudioBuffer({ length: buffer.length, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels });
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) turned.copyToChannel(reversed(buffer.getChannelData(channel)), channel);
    made.turned = turned;
  }
  return made.turned;
}

/**
 * The part of `buffer` between the shares `from` and `to`, made `factor` times as long at its own pitch, in cycles of
 * `cycle` samples. Made once and kept for as long as the same is asked for.
 */
function stretchedPart(made: Ready, buffer: AudioBuffer, back: boolean, from: number, to: number, factor: number, cycle: number): AudioBuffer {
  const first = Math.floor(from * buffer.length);
  const last = Math.max(first + 1, Math.min(buffer.length, Math.ceil(to * buffer.length)));
  const name = `${back ? "b" : "f"}|${first}|${last}|${factor.toFixed(3)}|${cycle}`;
  const kept = made.stretched.get(name);
  if (kept) {
    // Asked for again: it is the newest once more.
    made.stretched.delete(name);
    made.stretched.set(name, kept);
    return kept;
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => stretch(buffer.getChannelData(channel).subarray(first, last), factor, cycle));
  const long = new AudioBuffer({ length: Math.max(1, channels[0]?.length ?? 1), sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels });
  channels.forEach((channel, index) => long.copyToChannel(channel, index));
  made.stretched.set(name, long);
  for (const old of made.stretched.keys()) {
    if (made.stretched.size <= KEPT) break;
    made.stretched.delete(old);
  }
  return long;
}

/** What still sounds in each ring's inlet. */
const sounding = new WeakMap<AudioNode, { hush: GainNode; source: AudioBufferSourceNode }[]>();

/** Where a hit lies on its ring: its step, how many steps the ring has, and how long a step is. */
export interface Place {
  step: number;
  steps: number;
  stepSeconds: number;
}

/**
 * Plays the ring's sample as one hit. As a hit: all of the played part, at the hit's pitch (of a chord, its lowest
 * note: one sampled chord moved up and down is the rave stab). It plays out however long its note is drawn, as a
 * sampler's pad does: the next hit lets it go, and the sound pad makes it shorter. In slices: on from the slice the hit lies on (or the one so many further on or back that its place across
 * the ring says) until the next hit comes. The sound pad shapes both: across, a filter; up, how long a hit rings. A
 * recording that is not ready (not in this browser, or still being read) is silent.
 */
export function playSample(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit, sample: Sample, place: Place): void {
  const made = ready.get(sample.id);
  if (!made) return;
  const context = kit.context;
  const whole = sample.back ? turnedRound(made) : made.buffer;

  // One voice: what the ring was still playing gives way.
  for (const old of sounding.get(out) ?? []) {
    old.hush.gain.cancelScheduledValues(time);
    old.hush.gain.setValueAtTime(1, time);
    old.hush.gain.linearRampToValueAtTime(0, time + IN);
    try {
      old.source.stop(time + IN + 0.005);
    } catch {
      // It has stopped already.
    }
  }

  const level = hit.gain * sample.gain * made.even * (RING[trackIndex] ?? 1);
  const tone = padFilter(track.x);
  const [from, to] = playedSpan(sample);
  const partSeconds = (to - from) * whole.duration;
  // Stretched, the played part is a buffer of its own. Its cycles buzz at the key's root as it is heard: tuned up it
  // runs faster and the buzz would rise with it, so the cycles are made that much longer.
  // Never longer than the longest recording a ring takes: a minute stretched eight times would be 180 MB.
  const by = Math.min(stretchOf(sample, partSeconds, place.steps, place.stepSeconds), Math.max(1, MAX_SECONDS / Math.max(partSeconds, 0.001)));
  const long = Math.abs(by - 1) < 0.001 ? null : stretchedPart(made, whole, sample.back, from, to, by, cycleFor(whole.sampleRate, rootHz(hit.root) / rateOf(sample.tune)));
  const buffer = long ?? whole;
  /** Where the played part begins in what is played, and how long it is there, in seconds. */
  const start = long ? 0 : from * whole.duration;
  const length = long ? long.duration : partSeconds;

  const play = (skip: number, rate: number, held: number | null): void => {
    const rest = length - skip;
    if (rest <= 0 || rate <= 0) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const amp = kit.gain(0);
    const hush = kit.gain(1);
    if (tone) source.connect(kit.filter(tone.type, tone.hz, 0.7)).connect(amp);
    else source.connect(amp);
    amp.connect(hush).connect(out);
    // How long it sounds: its own length at this speed, or as long as it is held, whichever is over first.
    const own = rest / rate;
    const lasts = held === null ? own : Math.min(own, Math.max(held, 0.03));
    // It comes in at once (a drum keeps its edge) and its end is taken down: a stretch of a recording rarely ends on nothing.
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(level, time + IN);
    amp.gain.setValueAtTime(level, Math.max(time + IN, time + lasts - OUT));
    amp.gain.linearRampToValueAtTime(0, time + lasts);
    source.start(time, start + skip, rest);
    source.stop(time + lasts + 0.01);
    sounding.set(out, [{ hush, source }]);
  };

  if (sample.mode === HIT) {
    const home = homeMidi(hit.root, trackIndex);
    const midi = home === null || hit.midis.length === 0 ? null : Math.min(...hit.midis);
    const rate = rateOf(hitSemitones(sample, midi, home, hit.pitch));
    play(0, rate, (length / rate) * padLength(track.y));
  } else {
    const span = sliceSpan(sample, sliceOf(place.step, hit.pitch, place.steps, sample.turn), place.steps);
    const steps = padSteps(track.y);
    // The needle is dropped on the hit's slice and plays on to the end of the played part: the next hit lets it go before that.
    const share = to > from ? (span.from - from) / (to - from) : 0;
    play(share * length, long ? rateOf(sample.tune) : sliceRate(sample, ((span.to - span.from) * whole.duration), place.stepSeconds), steps === null ? null : steps * place.stepSeconds);
  }
}

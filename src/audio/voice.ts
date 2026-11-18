import { midiToHz, type Kit } from "klangwerk";
import { trackInfo, type Track, type Voice } from "../model";
import { plan, shape, sing, syllables, VOWELS, type Formants, type Sung } from "../voice";
import type { Hit } from "./sounds";

/*
 * Makes the voice audible. A syllable is a buzz at the note's pitch (the
 * vocal cords) through three band filters (the mouth) that move from sound
 * to sound as voice.ts lays them out in time; hisses and pops are noise
 * through a filter of their own. The vowel lands on the beat, the
 * consonants before it come ahead of the beat as far as there is time. A
 * ring has one singer: a new syllable takes over from the one before.
 */

/** Evens out voices against each ring's built-in sounds (measured, ring by ring). */
const RING = [1.1, 0.75, 0.45, 1.05, 1.15, 1.05, 0.9] as const;
/** The pitch a ring without notes speaks at. */
const SPOKEN = [98, 147, 196] as const;
/** How wide each of the three formants is, as a filter's Q, and how loud. */
const SHARP = [6, 12, 16] as const;
const LOUD = [1.6, 2, 1.4] as const;

const semitones = (count: number): number => 2 ** (count / 12);
const A: Formants = VOWELS.a ?? [750, 1250, 2500];
/** A ring without a line sings "a" (which the sound pad then pulls where it likes). */
const BARE: Sung = { before: [], vowel: A, glide: null, after: [], mute: false };

/** What still sounds in each ring's inlet. */
const singing = new WeakMap<AudioNode, { hush: GainNode; stop(time: number): void }[]>();

/** Sings syllable number `number` of the ring's line as one hit: once for a drum, once per note for a ring that plays notes. */
export function playVoice(kit: Kit, out: AudioNode, trackIndex: number, track: Track, time: number, hit: Hit, voice: Voice, number: number): void {
  const context = kit.context;
  const info = trackInfo(trackIndex);
  const line = syllables(voice.text);
  const which = line.length > 0 ? ((number % line.length) + line.length) % line.length : 0;
  const syllable = line[which];
  const sung = syllable ? sing(syllable, line[which + 1] ?? null) : BARE;
  const laid = plan(sung, hit.duration, (formants) => shape(formants, voice, track.x, track.y));
  const pitches = info.refHz > 0 ? hit.midis.map((midi) => midiToHz(midi)) : [(SPOKEN[trackIndex] ?? 147) * semitones(hit.pitch)];
  // The consonants come ahead of the beat; where there is no time for that, the whole syllable comes a little late.
  const beat = Math.max(time, context.currentTime + 0.004 + laid.lead);
  const level = hit.gain * 0.62 * (RING[trackIndex] ?? 1);

  // The singer goes on to the next syllable: the one before gives way.
  for (const old of singing.get(out) ?? []) {
    old.hush.gain.setTargetAtTime(0, beat - laid.lead, 0.012);
    old.stop(beat - laid.lead + 0.12);
  }
  const hush = kit.gain(1);
  hush.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const end = beat + laid.end;

  // Hisses and pops: once, however many notes are sung.
  for (const noise of laid.noises) {
    const source = context.createBufferSource();
    source.buffer = kit.noise;
    source.loop = true;
    const filter = kit.filter(noise.type, noise.hz, noise.q);
    const amp = kit.gain(0);
    const at = beat + noise.at;
    const seconds = noise.ms / 1000;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(noise.level * level, at + Math.min(0.004, seconds * 0.3));
    amp.gain.setTargetAtTime(0, at + seconds * 0.6, Math.max(0.004, seconds * 0.18));
    source.connect(filter).connect(amp).connect(hush);
    source.start(at, (at * 3.7) % 1.2);
    source.stop(at + seconds + 0.08);
    sources.push(source);
  }

  const first = laid.line[0];
  if (!first) return;
  const start = beat + first.at;
  for (const pitch of pitches) {
    // The vocal cords: a buzz, a little softer at the top.
    const cords = context.createOscillator();
    cords.type = "sawtooth";
    cords.frequency.value = pitch;
    const soften = kit.filter("lowpass", Math.max(3200, Math.min(7000, pitch * 14)), 0.5);
    const voiced = kit.gain(0);
    cords.connect(soften).connect(voiced);
    // Breath: always a little of it in the voice, and all there is in an h.
    const air = context.createBufferSource();
    air.buffer = kit.noise;
    air.loop = true;
    const airy = kit.filter("highpass", 700, 0.5);
    const breath = kit.gain(0);
    air.connect(airy).connect(breath);
    // The mouth: three resonances, and a little of the buzz as it is for body.
    const mix = kit.gain(level / Math.sqrt(pitches.length));
    const formants = SHARP.map((sharp, index) => {
      const filter = kit.filter("bandpass", first.f[index] ?? 500, sharp);
      const loud = kit.gain(LOUD[index] ?? 0.5);
      voiced.connect(filter);
      breath.connect(filter);
      filter.connect(loud).connect(mix);
      filter.frequency.setValueAtTime(first.f[index] ?? 500, start);
      return filter;
    });
    // A low voice needs its own note to be heard under the resonances: the lower it sings, the more of the plain buzz.
    const body = kit.filter("lowpass", Math.max(260, pitch * 2.6), 0.5);
    const plain = kit.gain(Math.max(0.08, Math.min(0.9, 0.12 * (220 / pitch) ** 1.3)));
    voiced.connect(body).connect(plain).connect(mix);
    mix.connect(hush);

    const clear = 1 - voice.breath * 0.7;
    voiced.gain.setValueAtTime(0, start);
    breath.gain.setValueAtTime(0, start);
    for (const point of laid.line) {
      const at = beat + point.at;
      formants.forEach((filter, index) => filter.frequency.setTargetAtTime(point.f[index] ?? 500, at, 0.012));
      voiced.gain.setTargetAtTime(point.level * clear, at, point.level > 0 ? 0.008 : 0.006);
      breath.gain.setTargetAtTime(point.level * voice.breath * 0.5, at, 0.01);
    }
    for (const sigh of laid.breaths) {
      const at = beat + sigh.at;
      breath.gain.setTargetAtTime(0.55, at, 0.006);
      breath.gain.setTargetAtTime(voice.breath * 0.5, at + sigh.ms / 1000, 0.008);
    }
    for (const roll of laid.rolls) {
      // A rolled r: the voice flutters.
      const from = beat + roll.at;
      for (let flap = 0; flap * 0.036 < roll.ms / 1000; flap += 1) {
        voiced.gain.setTargetAtTime(0.12 * clear, from + flap * 0.036, 0.004);
        voiced.gain.setTargetAtTime(0.5 * clear, from + flap * 0.036 + 0.018, 0.004);
      }
    }
    // A held note wavers a little, as a sung one does.
    if (hit.duration > 0.32) {
      const waver = context.createOscillator();
      waver.frequency.value = 5.6;
      const depth = kit.gain(0);
      depth.gain.setValueAtTime(0, beat + 0.2);
      depth.gain.linearRampToValueAtTime(pitch * 0.008, beat + 0.45);
      waver.connect(depth).connect(cords.frequency);
      waver.start(beat);
      waver.stop(end + 0.1);
      sources.push(waver);
    }
    cords.start(start);
    cords.stop(end + 0.1);
    air.start(start, (start * 5.3) % 1.3);
    air.stop(end + 0.1);
    sources.push(cords, air);
  }
  singing.set(out, [{
    hush,
    stop: (when: number) => {
      for (const source of sources) {
        try {
          source.stop(when);
        } catch {
          // It has stopped already.
        }
      }
    },
  }]);
}

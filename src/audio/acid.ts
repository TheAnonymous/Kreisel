import { midiToHz, type Kit } from "klangwerk";
import { biteOf, resonanceDb, restHz, SLIDE_SECONDS, THIN_BELOW } from "../acid";
import type { Acid, Track } from "../model";
import type { Hit } from "./sounds";

/*
 * The acid machine made audible (its rules are in src/acid.ts). One note is a
 * saw or a square through two low-passes in a row, the first of which rings
 * at its corner, and a gate. The machine has one voice: a new note lets go of
 * the one before it, and where the two are tied the new one is not struck
 * again but goes on from where the old one was, in pitch and in filter.
 */

/** A note the machine is playing, for the note that follows it. */
export interface AcidNote {
  hz: number;
  /** When it ends by itself. */
  until: number;
  /** Lets go of it at `time`: the next note takes over. */
  cut(time: number): void;
  /** Hz its filter stands at at `time`. */
  cutoffAt(time: number): number;
}

/**
 * How much louder the machine is played the further its filter is open, 0..1: 6 dB from one end to the other. Left
 * alone it gets quieter as the filter opens, by 5 dB in Chromium and by 8 dB in Firefox, whose saw has less in its
 * overtones; with this it stays within about 2 dB in the one and 4 dB in the other.
 */
const evenOut = (x: number): number => 0.8 * 2 ** Math.min(1, Math.max(0, x));

/** The Q of a filter section that neither lifts nor dips at its corner, as the browser's low-pass takes it (in dB). */
const FLAT = -3.0103;
const TOP_HZ = 16_000;

/**
 * Plays one note. `tied` is the note before it where that one still sounds
 * (then this one slides out of it); `charge` is what earlier accents have
 * left; `thin` takes its lows away, for when the ground shakes under it.
 */
export function playAcid(kit: Kit, out: AudioNode, time: number, track: Track, acid: Acid, hit: Hit, tied: AcidNote | null, charge: number, thin: boolean): AcidNote {
  const context = kit.context;
  const hz = midiToHz(hit.midis[0] ?? 36);
  const rest = restHz(track.x);
  const bite = biteOf(acid, hit.accent, charge, track.y);
  const struck = Math.min(TOP_HZ, rest * bite.open);
  // A tied note is not struck again: its filter goes on from where the note before left it. Only an accent kicks it open anew.
  const start = Math.max(rest, tied ? Math.max(Math.min(TOP_HZ, tied.cutoffAt(time)), hit.accent ? struck : 0) : struck);
  const end = time + hit.duration;

  const osc = context.createOscillator();
  osc.type = acid.square ? "square" : "sawtooth";
  if (tied && tied.hz !== hz) {
    osc.frequency.setValueAtTime(tied.hz, time);
    osc.frequency.exponentialRampToValueAtTime(hz, time + SLIDE_SECONDS);
  } else {
    osc.frequency.setValueAtTime(hz, time);
  }

  // The second low-pass stands a little above the first: the slope gets steeper, the ringing stays the first one's.
  const ringing = kit.filter("lowpass", start, resonanceDb(track.y));
  const smooth = kit.filter("lowpass", Math.min(TOP_HZ, start * 1.5), FLAT);
  ringing.frequency.setValueAtTime(start, time);
  ringing.frequency.setTargetAtTime(rest, time, bite.seconds);
  smooth.frequency.setValueAtTime(Math.min(TOP_HZ, start * 1.5), time);
  smooth.frequency.setTargetAtTime(Math.min(TOP_HZ, rest * 1.5), time, bite.seconds);

  // A square has more in it than a saw, a ringing filter adds to what passes it, and a filter that rests low rings on
  // the note itself and is louder for it: all three are evened out (set by measurement, see window.kreisel.whole()).
  const level = 0.46 * hit.gain * bite.loud * (acid.square ? 0.6 : 1) * (1 - 0.3 * track.y) * evenOut(track.x);
  const gate = kit.gain(0);
  gate.gain.setValueAtTime(0, time);
  gate.gain.linearRampToValueAtTime(level, time + (tied ? 0.006 : 0.003));
  gate.gain.setTargetAtTime(0, end, 0.008);

  osc.connect(ringing).connect(smooth);
  let last: AudioNode = smooth;
  if (thin) {
    const high = kit.filter("highpass", THIN_BELOW, FLAT);
    smooth.connect(high);
    last = high;
  }
  last.connect(gate).connect(out);
  osc.start(time);
  osc.stop(end + 0.1);

  return {
    hz,
    until: end,
    cut(at: number): void {
      gate.gain.cancelScheduledValues(at);
      gate.gain.setTargetAtTime(0, at, 0.004);
      osc.stop(at + 0.06);
    },
    cutoffAt: (at: number): number => rest + (start - rest) * Math.exp(-Math.max(0, at - time) / bite.seconds),
  };
}

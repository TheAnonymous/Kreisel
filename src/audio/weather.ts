import type { Kit } from "klangwerk";
import { ringGains } from "../press";

/*
 * What the weather does to a ring's sound. Every ring's notes pass through a
 * short chain on their way to the ring's bus: fog closes a filter, sun lifts
 * the highs, sparks drive the sound into a shaper, hail chops it. Clouds and
 * rain send what leaves the bus into the hall and the echo. Step by step the
 * player says how much of each kind lies on the ring right now.
 *
 * The shaper is also the ring's "Drive": a ring can be driven all the time,
 * and the sparks that lie on it come on top.
 */

export interface Chain {
  /** Where the ring's notes go in. */
  input: GainNode;
  fog: BiquadFilterNode;
  sun: BiquadFilterNode;
  dry: GainNode;
  push: GainNode;
  wet: GainNode;
  chop: GainNode;
  cloud: GainNode;
  rain: GainNode;
  /** The ring's own Zerre, 0..1: how hard it is driven under a clear sky. */
  drive: number;
  /** What was asked for last, kind by kind, so nothing is scheduled twice. */
  last: number[];
}

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const GLIDE = 0.012;

/** A soft knee that bites harder the more it is driven. */
function bite(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.tanh((index / 1024 - 1) * 2.5);
  return curve;
}

/** The chain of one ring: into `to` (the ring's bus), with weather sends from `tap` (what leaves the bus) to hall and echo. */
export function buildChain(kit: Kit, to: AudioNode, tap: AudioNode, hall: AudioNode, echo: AudioNode): Chain {
  const context = kit.context;
  const input = kit.gain(1);
  const fog = kit.filter("lowpass", 19_000, 0.7);
  const sun = kit.filter("highshelf", 3200, 0.7);
  sun.gain.value = 0;
  const dry = kit.gain(1);
  const push = kit.gain(1);
  const shaper = context.createWaveShaper();
  shaper.curve = bite();
  shaper.oversample = "2x";
  const wet = kit.gain(0);
  const chop = kit.gain(1);
  input.connect(fog).connect(sun);
  sun.connect(dry).connect(chop);
  sun.connect(push).connect(shaper).connect(wet).connect(chop);
  chop.connect(to);
  const cloud = kit.gain(0);
  const rain = kit.gain(0);
  tap.connect(cloud).connect(hall);
  tap.connect(rain).connect(echo);
  return { input, fog, sun, dry, push, wet, chop, cloud, rain, drive: 0, last: [0, 0, 0, 0, 0, 0] };
}

/** Sets the three gains around the shaper for the ring's Zerre and the sparks over it. */
function shape(chain: Chain, sparks: number, time: number): void {
  const gains = ringGains(chain.drive, sparks);
  chain.dry.gain.setTargetAtTime(gains.dry, time, GLIDE);
  chain.push.gain.setTargetAtTime(gains.push, time, GLIDE);
  chain.wet.gain.setTargetAtTime(gains.wet, time, GLIDE);
}

/** The ring's own Zerre, 0..1. The sparks that lie on the ring right now stay on top of it. */
export function driveChain(chain: Chain, drive: number, time: number): void {
  if (drive === chain.drive) return;
  chain.drive = drive;
  shape(chain, chain.last[4] ?? 0, time);
}

/** A step of the ring: how much of each kind of weather (fog, sun, clouds, rain, sparks, hail; each 0..1) lies on it now. */
export function stepChain(chain: Chain, over: readonly number[], time: number, step: number): void {
  const [fog = 0, sun = 0, cloud = 0, rain = 0, sparks = 0, hail = 0] = over;
  const { last } = chain;
  if (fog !== last[0]) chain.fog.frequency.setTargetAtTime(expo(19_000, 450, fog ** 0.8), time, GLIDE);
  if (sun !== last[1]) chain.sun.gain.setTargetAtTime(sun * 7, time, GLIDE);
  if (cloud !== last[2]) chain.cloud.gain.setTargetAtTime(cloud * 0.9, time, GLIDE);
  if (rain !== last[3]) chain.rain.gain.setTargetAtTime(rain * 0.85, time, GLIDE);
  if (sparks !== last[4]) shape(chain, sparks, time);
  if (hail > 0) {
    // Twice a step the sound is let through and cut off again, the deeper the more hail there is.
    const gain = chain.chop.gain;
    gain.cancelScheduledValues(time);
    for (let half = 0; half < 2; half += 1) {
      const at = time + (half * step) / 2;
      gain.setTargetAtTime(1, at, 0.002);
      gain.setTargetAtTime(1 - hail * 0.97, at + step * 0.2, 0.004);
    }
    gain.setTargetAtTime(1, time + step, 0.002);
  } else if (last[5] !== 0) {
    chain.chop.gain.cancelScheduledValues(time);
    chain.chop.gain.setTargetAtTime(1, time, 0.003);
  }
  chain.last = [fog, sun, cloud, rain, sparks, hail];
}

/** Clear sky over the ring (the Kreisel stops: a note played by hand sounds as the ring itself does). */
export function clearChain(chain: Chain, time: number): void {
  stepChain(chain, [0, 0, 0, 0, 0, 0], time, 0.1);
}

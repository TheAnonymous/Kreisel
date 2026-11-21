import type { Kit } from "klangwerk";

/*
 * What makes a kick hard, in the order a techno kick is built: the clean
 * kick is driven into a clipper before anything else hears it, so its tail
 * is pressed up into a body that stands; what the drive adds on top is taken
 * off again after it. The Nachbeben is made from this kick, not from the
 * clean one. And where the kick and its Nachbeben leave for the mix they go
 * through one more clipper together, so the two are one thing: the kick
 * pushes the rumble down for the moment it is there.
 */

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;

/** How far the clipper's curve reaches: an input of 1 after the push is this far up the curve. */
const REACH = 32;
/** About a kick's peak at an ordinary hit: where the clipper's flat top is brought back to, before what is taken off for the fatness. */
const PEAK = 1;

/** From a soft knee to a flat top: the further in, the harder. */
function clipper(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(8193);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.tanh((index / 4096 - 1) * REACH);
  return curve;
}

export interface KickDrive {
  /** Where the kick's notes go in. */
  input: GainNode;
  /** The kick as everything else hears it. */
  output: GainNode;
  clean: GainNode;
  push: GainNode;
  driven: GainNode;
  tame: BiquadFilterNode;
}

export function buildDrive(kit: Kit): KickDrive {
  const input = kit.gain(1);
  const output = kit.gain(1);
  const clean = kit.gain(1);
  input.connect(clean).connect(output);
  const push = kit.gain(1 / REACH);
  const shaper = kit.context.createWaveShaper();
  shaper.curve = clipper();
  // No oversampling: it would delay the driven kick against the clean one, and a kick has little up high to fold back.
  const tame = kit.filter("lowpass", 18_000, 0.5);
  const driven = kit.gain(0);
  input.connect(push).connect(shaper).connect(tame).connect(driven).connect(output);
  return { input, output, clean, push, driven, tame };
}

/** How hard the kick is driven, 0..1: at 0 it passes untouched. */
export function shadeDrive(drive: KickDrive, hard: number, time: number, glide: number): void {
  const set = (param: AudioParam, value: number): void => {
    param.setTargetAtTime(value, time, glide);
  };
  // The first few hundredths fade the clipper in; from there on it is all there is.
  const share = Math.min(1, hard / 0.06);
  const push = expo(1, 26, hard);
  set(drive.clean.gain, 1 - share);
  set(drive.push.gain, push / REACH);
  // A body that stands is much louder at the same peak: more and more of the peak is taken back, so that at full the
  // kick peaks at about half of what it did and is still some 5 dB louder on average (set by measurement).
  set(drive.driven.gain, (share * PEAK * expo(1, 0.45, hard)) / Math.tanh(push * PEAK));
  set(drive.tame.frequency, expo(18_000, 5200, hard));
}

export interface KickGroup {
  /** Where the kick's bus and the Nachbeben come together. */
  input: GainNode;
  apart: GainNode;
  push: GainNode;
  together: GainNode;
}

/** A knee that leaves what is quiet alone and rounds off what the two add up to. */
function glue(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4097);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.tanh((index / 2048 - 1) * 4);
  return curve;
}

export function buildGroup(kit: Kit, to: AudioNode): KickGroup {
  const input = kit.gain(1);
  const apart = kit.gain(1);
  input.connect(apart).connect(to);
  const push = kit.gain(0.25);
  const shaper = kit.context.createWaveShaper();
  shaper.curve = glue();
  const together = kit.gain(0);
  input.connect(push).connect(shaper).connect(together).connect(to);
  return { input, apart, push, together };
}

/**
 * How much the kick and the Nachbeben are pressed into one, 0..1. At 0 they
 * pass side by side as before: a kick without a Nachbeben is left alone.
 */
export function shadeGroup(group: KickGroup, amount: number, time: number, glide: number): void {
  const set = (param: AudioParam, value: number): void => {
    param.setTargetAtTime(value, time, glide);
  };
  const share = Math.min(1, amount / 0.1);
  const push = expo(0.9, 2.6, amount);
  set(group.apart.gain, 1 - share);
  set(group.push.gain, push / 4);
  set(group.together.gain, (share * 0.8) / Math.tanh(push * 0.8));
}

import type { Kit } from "klangwerk";
import { clipCurve, FIRST, MONO_BELOW, pressGains, SECOND } from "../press";

/*
 * "Druck": where everything meets on its way to the master. At rest it lets
 * all of it through as it comes. Turned up, the sum is clipped softly in two
 * stages, and what lies below 150 Hz is brought to the middle, where a club's
 * subwoofers want it. The master's own filters, compressor and limiter come
 * after it, so a filter ride sweeps the pressed sound.
 */

export interface Press {
  /** Where the mix, the hall and the echo come in. */
  input: GainNode;
  clean: GainNode;
  push: GainNode;
  between: GainNode;
  pressed: GainNode;
  /** The sum as it is, or with its lows in the middle. */
  wide: GainNode;
  narrow: GainNode;
}

/**
 * The Q of a filter section that neither lifts nor dips at its corner. A low-pass or high-pass of the browser takes its
 * Q in decibels: this is one over the square root of two, written that way.
 */
const FLAT = -3.0103;

export function buildPress(kit: Kit, to: AudioNode): Press {
  const context = kit.context;
  const input = kit.gain(1);
  const sum = kit.gain(1);
  const clean = kit.gain(1);
  input.connect(clean).connect(sum);
  // No oversampling: it would delay the pressed sound against the clean one while the two fade into each other.
  const push = kit.gain(1 / FIRST.reach);
  const first = context.createWaveShaper();
  first.curve = clipCurve(FIRST);
  const between = kit.gain(1 / SECOND.reach);
  const second = context.createWaveShaper();
  second.curve = clipCurve(SECOND);
  const pressed = kit.gain(0);
  input.connect(push).connect(first).connect(between).connect(second).connect(pressed).connect(sum);

  const wide = kit.gain(1);
  sum.connect(wide).connect(to);
  // Lows and highs are split with two filters each (so that together they are the whole again); the lows go on as one channel.
  const narrow = kit.gain(0);
  const middle = kit.gain(1);
  middle.channelCount = 1;
  middle.channelCountMode = "explicit";
  middle.channelInterpretation = "speakers";
  sum.connect(middle).connect(kit.filter("lowpass", MONO_BELOW, FLAT)).connect(kit.filter("lowpass", MONO_BELOW, FLAT)).connect(narrow);
  sum.connect(kit.filter("highpass", MONO_BELOW, FLAT)).connect(kit.filter("highpass", MONO_BELOW, FLAT)).connect(narrow);
  narrow.connect(to);
  return { input, clean, push, between, pressed, wide, narrow };
}

/** How hard the sum is pressed, 0..1: at 0 it passes untouched. */
export function shadePress(press: Press, amount: number, time: number, glide: number): void {
  const set = (param: AudioParam, value: number): void => {
    param.setTargetAtTime(value, time, glide);
  };
  const gains = pressGains(amount);
  set(press.clean.gain, gains.clean);
  set(press.pressed.gain, gains.pressed);
  set(press.push.gain, gains.first / FIRST.reach);
  set(press.between.gain, gains.second / SECOND.reach);
  set(press.wide.gain, gains.mono ? 0 : 1);
  set(press.narrow.gain, gains.mono ? 1 : 0);
}

import { duck, type Kit } from "klangwerk";
import { rumbleHz, rumbleShare } from "../rumble";

/*
 * Makes the Nachbeben, in the order a techno rumble is built. The kick, as
 * hard as it has been driven, also goes down into a cellar: a long dark room
 * (for the swell) and a row of echoes a sixteenth apart (for the roll). What
 * comes back is driven until it growls, and only then is what is high taken
 * off again: the growl stays below, the hiss is gone. Under it lies a quiet
 * deep tone that moves with it, at the root of the bar's chord, so the
 * ground has a pitch. All of it is let out by the line painted into the
 * kick's ring, and each kick pushes it away for a moment, so the kick is
 * always heard alone.
 */

export interface Rumble {
  /** Where the kick's sound goes in. */
  input: GainNode;
  /** The painted line, step by step. */
  level: GainNode;
  /** Pushed down by every kick. */
  duck: GainNode;
  /** Rolling: a dip and a swell on every sixteenth. */
  pulse: GainNode;
  /** As loud as the kick's ring is set, silent while that ring is not heard. */
  out: GainNode;
  wash: GainNode;
  echoes: DelayNode;
  again: GainNode;
  roll: GainNode;
  drive: GainNode;
  makeup: GainNode;
  /** Takes off what is high, after the growl: twice, so it falls away steeply. */
  dark: BiquadFilterNode[];
  /** The tone under the growl: the chord's root, and its octave for small speakers. */
  tone: OscillatorNode;
  over: OscillatorNode;
  /** What was last asked for, so nothing is scheduled twice; and how much it rolls. */
  state: { step: number; hz: number; roll: number; pulsing: boolean };
}

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;

/** How loud the Nachbeben is against the kick it comes from (set by measurement). */
const LEVEL = 0.31;
/** How far ahead of a kick the ground starts to give way, so the kick's first moment is its own. */
const AHEAD = 0.012;

/** The cellar: two and a half seconds of dark noise that swells in for a moment and dies away, the same every time. */
function cellar(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.round(rate * 2.4);
  const samples = new Float32Array(length);
  let state = 0x2f6e_2b1d;
  let low = 0;
  let lower = 0;
  let energy = 0;
  // The same darkness at every sample rate.
  const smooth = 1 - Math.exp((-2 * Math.PI * 420) / rate);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const white = state / 2_147_483_648 - 1;
    low += (white - low) * smooth;
    lower += (low - lower) * smooth;
    const time = index / rate;
    const sample = lower * (1 - Math.exp(-time / 0.018)) * Math.exp(-time / 0.4);
    samples[index] = sample;
    energy += sample * sample;
  }
  // As much comes out as goes in, whatever the sample rate.
  const gain = 1 / Math.sqrt(energy);
  for (let index = 0; index < length; index += 1) samples[index] = (samples[index] ?? 0) * gain;
  const buffer = new AudioBuffer({ length, sampleRate: rate, numberOfChannels: 1 });
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/** A soft knee that turns into a growl the harder it is driven. */
function growl(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.tanh((index / 1024 - 1) * 2.2);
  return curve;
}

/** How big a wave is, whichever way it swings: the first half of following its loudness. */
function size(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let index = 0; index < curve.length; index += 1) curve[index] = Math.abs(index / 1024 - 1);
  return curve;
}

export function buildRumble(kit: Kit, to: AudioNode): Rumble {
  const context = kit.context;
  const input = kit.gain(1);

  const room = context.createConvolver();
  room.normalize = false;
  room.buffer = cellar(context);
  const wash = kit.gain(1);
  input.connect(room).connect(wash);

  // The kick again and again, a sixteenth apart, each time weaker and darker.
  const echoes = context.createDelay(1);
  echoes.delayTime.value = 0.125;
  const again = kit.gain(0);
  const thud = kit.filter("lowpass", 170, 0.7);
  const roll = kit.gain(0);
  input.connect(echoes);
  echoes.connect(thud);
  thud.connect(again).connect(echoes);
  thud.connect(roll);

  // What comes back from the cellar is driven first, while everything it has is still in it …
  const drive = kit.gain(1);
  wash.connect(drive);
  roll.connect(drive);
  const shaper = context.createWaveShaper();
  shaper.curve = growl();
  shaper.oversample = "2x";
  const makeup = kit.gain(1);
  // … and darkened after, so what the drive has added up high goes and what it has added below stays.
  const dark = [kit.filter("lowpass", 180, 0.7), kit.filter("lowpass", 180, 0.7)];
  const floor = kit.filter("highpass", 32, 0.7);
  const bed = kit.gain(1);
  drive.connect(shaper).connect(makeup).connect(dark[0]!).connect(dark[1]!).connect(floor).connect(bed);

  // Under the growl a deep tone: its loudness, followed slowly, is the growl's.
  const swing = context.createWaveShaper();
  swing.curve = size();
  const slow = [kit.filter("lowpass", 16, 0.5), kit.filter("lowpass", 16, 0.5)];
  floor.connect(swing).connect(slow[0]!).connect(slow[1]!);
  const voice = (octave: number, depth: number): OscillatorNode => {
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.value = 55 * octave;
    const loud = kit.gain(0);
    const follow = kit.gain(depth);
    slow[1]!.connect(follow).connect(loud.gain);
    tone.connect(loud).connect(bed);
    tone.start();
    return tone;
  };
  const tone = voice(1, 1.5);
  const over = voice(2, 0.4);

  const level = kit.gain(0);
  const pulse = kit.gain(1);
  const ducker = kit.gain(1);
  const out = kit.gain(0);
  bed.connect(level).connect(pulse).connect(ducker).connect(out).connect(to);

  return { input, level, duck: ducker, pulse, out, wash, echoes, again, roll, drive, makeup, dark, tone, over, state: { step: 0, hz: 0, roll: 0, pulsing: false } };
}

/** The Nachbeben's character and how loud it is let out, as the project has them now. */
export function shadeRumble(rumble: Rumble, dirt: number, roll: number, loudness: number, time: number, glide: number): void {
  const set = (param: AudioParam, value: number): void => {
    param.setTargetAtTime(value, time, glide);
  };
  set(rumble.out.gain, loudness * LEVEL);
  // Dirt drives it harder into the growl, lets more of what that adds through, and is evened out so it does not just get louder.
  set(rumble.drive.gain, expo(0.25, 6, dirt));
  // (Hardly driven it comes out much quieter, and with all that is high taken off quieter still.)
  set(rumble.makeup.gain, 0.66 + 3.1 * (1 - dirt) ** 6);
  for (const filter of rumble.dark) set(filter.frequency, expo(90, 700, dirt));
  rumble.state.roll = roll;
  // Roll takes from the swell and gives to the echoes.
  set(rumble.wash.gain, lerp(1, 0.4, roll));
  set(rumble.roll.gain, roll * 1.5);
  set(rumble.again.gain, lerp(0.25, 0.66, roll));
}

/** A step of the kick's ring: how much the line lets out, and the pitch the ground has in this bar. */
export function stepRumble(rumble: Rumble, value: number, chordHz: number, time: number, step: number): void {
  rumble.level.gain.setTargetAtTime(rumbleShare(value), time, step * 0.3);
  const hz = rumbleHz(chordHz);
  if (hz !== rumble.state.hz) {
    rumble.state.hz = hz;
    // From chord to chord the tone slides, as a bass would.
    rumble.tone.frequency.setTargetAtTime(hz, time, 0.03);
    rumble.over.frequency.setTargetAtTime(hz * 2, time, 0.03);
  }
  if (step !== rumble.state.step) {
    rumble.state.step = step;
    rumble.echoes.delayTime.setTargetAtTime(Math.min(1, step), time, 0.01);
  }
  // Rolling: on every sixteenth the ground gives way for a moment and swells back, the more the more it rolls.
  const depth = rumble.state.roll * 0.88;
  const pulse = rumble.pulse.gain;
  if (depth > 0.04) {
    pulse.cancelScheduledValues(time);
    pulse.setTargetAtTime(1 - depth, time, 0.005);
    pulse.setTargetAtTime(1, time + step * 0.2, step * 0.26);
    rumble.state.pulsing = true;
  } else if (rumble.state.pulsing) {
    pulse.cancelScheduledValues(time);
    pulse.setTargetAtTime(1, time, 0.01);
    rumble.state.pulsing = false;
  }
}

/** A kick: the ground gives way to it and comes back within the step. */
export function hitRumble(rumble: Rumble, time: number, step: number): void {
  duck(rumble.duck.gain, Math.max(rumble.duck.context.currentTime, time - AHEAD), 0.97, { attack: 0.003, hold: AHEAD + Math.min(0.06, step * 0.4), release: step * 0.55 });
}

/** The Kreisel stops: the ground is still at once, and what is in the cellar is not let out later. */
export function stillRumble(rumble: Rumble, time: number): void {
  rumble.level.gain.cancelScheduledValues(time);
  rumble.level.gain.setTargetAtTime(0, time, 0.03);
}

import { crash, createReverb, type Kit } from "klangwerk";
import { BAR, type Build } from "../model";
import { gapSteps, type BuildPlace } from "../piece";

/*
 * What a build-up sounds like: the riser, the lows going, the cloud of hall,
 * the level sinking, the gap, and the crash the drop lands with. (Its roll,
 * and who stays out of its last bar, are notes: the player strikes those.)
 *
 * A build-up is told bar by bar, at each of its bar lines, where it stands;
 * every part is then set for that one bar. So it follows the tempo, and a
 * piece that starts in the middle of one finds it where it should be.
 */

/** Where the low cut ends up by the end of a build-up, in Hz, and where it rests (where nothing is cut). */
const LOW_CUT = 320;
const LOW_REST = 20;
/** How much of the sum goes into the cloud by the end of a build-up, and how loud the cloud comes back. */
const WASH = 0.5;
const CLOUD_LEVEL = 0.8;
/** What is left of the level by the end of a build-up that gets quieter (close to −3 dB), behind the master. */
const DIP = 0.72;
/**
 * How loud the riser's noise gets: in a single bar as loud as the breath every drop always took, in a longer
 * build-up as loud as the one held under the pause key. And how loud its tone gets.
 */
const NOISE_PEAK = 0.15;
const LONG_NOISE_PEAK = 0.22;
const TONE_PEAK = 0.07;
/**
 * What a bar's slopes end before the next bar line, in seconds. Two times that should be the same are never quite:
 * a slope that ended a hair after the line would come after what the line itself sets, and undo it.
 */
const EDGE = 0.001;

/** What a build-up needs of the Kreisel's sound (see `Graph` in engine.ts). */
export interface BuildOuts {
  kit: Kit;
  mix: GainNode;
  dry: GainNode;
  tail: GainNode;
  hall: AudioNode;
  highpass: BiquadFilterNode;
  press: { input: AudioNode };
  impulse: AudioBuffer;
  cloud: { send: GainNode; output: GainNode } | null;
}

/** Noise that rises, perhaps with a tone that climbs with it. It is told slope by slope how far to rise, and stays where it is until it is cut. */
export interface Riser {
  /** Rises from share `from` to share `to` of its way (0 the start, 1 the top) between `start` and `end`. */
  seg(from: number, to: number, start: number, end: number): void;
  cut(time: number): void;
}

/** Between `low` and `high`, as ears hear it: the same ratio for the same share. */
const along = (low: number, high: number, share: number): number => low * (high / low) ** share;

function slope(param: AudioParam, low: number, high: number, from: number, to: number, start: number, end: number): void {
  param.setValueAtTime(along(low, high, from), start);
  param.exponentialRampToValueAtTime(along(low, high, to), end);
}

/**
 * A riser that begins at `time`: noise through a filter that opens, from `floor` up to `peak`. With `toneHz` a tone
 * climbs with it, two octaves up from there. (Klangwerk's riser reads its two seconds of noise only once; a pause can
 * be held for longer, and a build-up runs for eight bars.)
 */
export function startRiser(kit: Kit, out: AudioNode, time: number, peak: number, floor: number, toneHz: number | null = null): Riser {
  const context = kit.context;
  const source = context.createBufferSource();
  source.buffer = kit.noise;
  source.loop = true;
  const band = kit.filter("bandpass", 300, 2.5);
  const amp = kit.gain(0);
  source.connect(band).connect(amp).connect(out);
  source.start(time);
  source.stop(time + 120);
  // The tone: two saws a little apart, behind a filter that opens as they climb.
  const voice = toneHz === null ? null : { oscillators: [-7, 7].map((cents) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.detune.value = cents;
    return oscillator;
  }), tone: kit.filter("lowpass", 500, 1.2), amp: kit.gain(0), hz: toneHz };
  if (voice) {
    for (const oscillator of voice.oscillators) {
      oscillator.connect(voice.tone);
      oscillator.start(time);
      oscillator.stop(time + 120);
    }
    voice.tone.connect(voice.amp).connect(out);
  }
  return {
    seg(from, to, start, end) {
      if (end <= start) return;
      slope(band.frequency, 300, 7000, from, to, start, end);
      slope(amp.gain, floor, peak, from, to, start, end);
      if (!voice) return;
      for (const oscillator of voice.oscillators) slope(oscillator.frequency, voice.hz, voice.hz * 4, from, to, start, end);
      slope(voice.tone.frequency, 500, 6000, from, to, start, end);
      slope(voice.amp.gain, TONE_PEAK * 0.01, TONE_PEAK, from, to, start, end);
    },
    cut(time) {
      for (const gain of voice ? [amp.gain, voice.amp.gain] : [amp.gain]) {
        gain.cancelScheduledValues(time);
        gain.setTargetAtTime(0, time, 0.012);
      }
      source.stop(time + 0.15);
      for (const oscillator of voice?.oscillators ?? []) oscillator.stop(time + 0.15);
    },
  };
}

/** Noise that rises until `end` and then stays up until it is cut: the breath held during a pause. */
export function rise(kit: Kit, out: AudioNode, start: number, end: number, peak: number): Riser {
  const riser = startRiser(kit, out, start, peak, 0.0001);
  riser.seg(0, 1, start, end);
  return riser;
}

/**
 * A cymbal played backwards: hiss that swells from next to nothing up to `peak` at `end`, and is gone there. For the
 * turn from one phrase into the next.
 */
export function swell(kit: Kit, out: AudioNode, start: number, end: number, peak: number): void {
  const source = kit.context.createBufferSource();
  source.buffer = kit.noise;
  source.loop = true;
  const high = kit.filter("highpass", 5200, 0.7);
  const amp = kit.gain(0);
  amp.gain.setValueAtTime(peak * 0.004, start);
  amp.gain.exponentialRampToValueAtTime(peak, end - EDGE);
  amp.gain.setTargetAtTime(0, end, 0.006);
  source.connect(high).connect(amp).connect(out);
  source.start(start);
  source.stop(end + 0.1);
}

/** The cloud of hall a build-up can raise: a hall of its own, so that it can be gone with the drop while the other rings on. Built when the first build-up asks for it. */
function cloudOf(outs: BuildOuts): { send: GainNode; output: GainNode } {
  if (!outs.cloud) {
    const send = outs.kit.gain(0);
    const reverb = createReverb(outs.kit, outs.impulse, { to: outs.press.input, level: CLOUD_LEVEL });
    outs.mix.connect(send).connect(reverb.input);
    outs.cloud = { send, output: reverb.output };
  }
  return outs.cloud;
}

/** Stops whatever a parameter was told to do from `time` on; where the browser can, it stays where it is then. */
function hold(param: AudioParam, time: number): void {
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
}

/** The build-up that is going on, if one is: what it has done to the sound so far, and how to take it back. */
export class BuildUp {
  /** The bar in which the drop lands that the build-up going on leads to; `null` while none is going on. */
  drop: number | null = null;
  /** Where the low cut sits by the build-up right now, in Hz. */
  lowCut = LOW_REST;
  private riser: Riser | null = null;
  /** What this build-up has moved, and so has to put back. */
  private moved = { lows: false, wash: false, dry: false, tail: false };

  constructor(private readonly outs: BuildOuts) {}

  /**
   * A bar line inside a build-up: `place` says which bar of which build-up begins at `time`, `step` is the length of
   * a sixteenth in seconds, `rootHz` where the riser's tone starts, and `thinHeld` whether an effect key holds the
   * low cut just now (then the build-up leaves it alone).
   */
  bar(place: BuildPlace, time: number, step: number, rootHz: number, thinHeld: boolean): void {
    const { kit: build, at, drop } = place;
    if (this.drop !== drop) {
      this.stop(time, thinHeld);
      this.drop = drop;
    }
    const { kit, mix, dry, tail, highpass } = this.outs;
    // The steps of the whole build-up that sound (all but the gap), and how far this bar gets through them.
    const sounding = build.bars * BAR - gapSteps(build);
    const gap = at === build.bars - 1 ? gapSteps(build) : 0;
    const from = sounding > 0 ? Math.min(1, (at * BAR) / sounding) : 1;
    const to = sounding > 0 ? Math.min(1, ((at + 1) * BAR - gap) / sounding) : 1;
    // Where what this bar does ends: at the gap, or a hair before the next bar line.
    const turn = time + (BAR - gap) * step;
    const end = turn - EDGE;
    const moving = end > time;

    if (build.riser > 0 && moving) {
      // A single bar of it is the breath every drop always took; a longer one is there from its first bar.
      this.riser ??= build.bars === 1 ? startRiser(kit, mix, time, NOISE_PEAK, 0.0001, build.riser === 2 ? rootHz : null) : startRiser(kit, mix, time, LONG_NOISE_PEAK, LONG_NOISE_PEAK * 0.01, build.riser === 2 ? rootHz : null);
      this.riser.seg(from, to, time, end);
    }
    if (gap > 0 && this.riser) {
      this.riser.cut(turn);
      this.riser = null;
    }
    if (build.lows) {
      if (!thinHeld) {
        highpass.frequency.setValueAtTime(along(LOW_REST, LOW_CUT, from), time);
        if (moving) highpass.frequency.exponentialRampToValueAtTime(along(LOW_REST, LOW_CUT, to), end);
        this.moved.lows = true;
      }
      this.lowCut = along(LOW_REST, LOW_CUT, to);
    }
    if (build.wash) {
      const cloud = cloudOf(this.outs);
      cloud.output.gain.cancelScheduledValues(time);
      cloud.output.gain.setValueAtTime(CLOUD_LEVEL, time);
      cloud.send.gain.setValueAtTime(WASH * from, time);
      if (moving) cloud.send.gain.linearRampToValueAtTime(WASH * to, end);
      this.moved.wash = true;
    }
    if (build.dip) {
      tail.gain.setValueAtTime(1 - (1 - DIP) * from, time);
      if (moving) tail.gain.linearRampToValueAtTime(1 - (1 - DIP) * to, end);
      this.moved.tail = true;
    }
    if (gap > 0) {
      // The gap: nothing dry gets through; what hall and echo hold rings out.
      dry.gain.setTargetAtTime(0, turn, 0.004);
      this.moved.dry = true;
    }
  }

  /** The drop lands at `time`: everything the build-up moved is back at once, and it lands with a crash. */
  land(time: number, build: Readonly<Build>, thinHeld: boolean): void {
    this.riser?.cut(time);
    this.riser = null;
    this.rest(time, thinHeld, true);
    if (build.bars > 0) crash(this.outs.kit, this.outs.mix, time, 0.36, 1.6).connect(this.outs.hall);
    this.drop = null;
  }

  /** The build-up is over without its drop (the piece stopped, or went elsewhere): everything it moved glides back. */
  stop(time: number, thinHeld: boolean): void {
    this.riser?.cut(time);
    this.riser = null;
    this.rest(time, thinHeld, false);
    this.drop = null;
  }

  private rest(time: number, thinHeld: boolean, sudden: boolean): void {
    const { dry, tail, highpass, cloud } = this.outs;
    if (this.moved.lows && !thinHeld) {
      if (sudden) {
        highpass.frequency.cancelScheduledValues(time);
        highpass.frequency.setValueAtTime(LOW_REST, time);
      } else {
        hold(highpass.frequency, time);
        highpass.frequency.setTargetAtTime(LOW_REST, time, 0.05);
      }
    }
    this.lowCut = LOW_REST;
    if (this.moved.wash && cloud) {
      if (sudden) {
        // Dry with the drop: nothing more goes in, and what the cloud still holds is not let out.
        cloud.send.gain.cancelScheduledValues(time);
        cloud.send.gain.setValueAtTime(0, time);
        cloud.output.gain.cancelScheduledValues(time);
        cloud.output.gain.setTargetAtTime(0, time, 0.008);
        cloud.output.gain.setValueAtTime(CLOUD_LEVEL, time + 3);
      } else {
        hold(cloud.send.gain, time);
        cloud.send.gain.setTargetAtTime(0, time, 0.05);
      }
    }
    for (const gain of [...(this.moved.dry ? [dry.gain] : []), ...(this.moved.tail ? [tail.gain] : [])]) {
      if (sudden) {
        gain.cancelScheduledValues(time);
        gain.setValueAtTime(1, time);
      } else {
        hold(gain, time);
        gain.setTargetAtTime(1, time, 0.02);
      }
    }
    this.moved = { lows: false, wash: false, dry: false, tail: false };
  }
}

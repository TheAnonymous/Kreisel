import { createChorus, createEcho, createReverb, type Kit } from "klangwerk";
import { CHORUS, crushBits, crushGains, crushRate, FLANGER, HOLD_SHARES, FLANGER_LOOP_MIN, flangerSeconds, FRONT_ECHO, modGains, PHASER, PHASER_STAGES, phaserHz, pulseHarmonics, ROOM_LEVEL, stairCurve, toneCurve, WARM, type PedalGains, type ToneFilters } from "../pedals";

/*
 * A ring's pedals, as sound. Between a ring's weather filters and its bus
 * stand, in this order: the drive with its character, the crusher, the
 * modulation. In front of the drive there can be a small room and an echo of
 * the ring's own, for a ring whose reverb or echo comes before its drive.
 *
 * Only the drive is always there (it is the shaper every ring always had).
 * Everything else is built the first time a ring asks for it, so a Kreisel
 * without pedals costs what it always cost and sounds, sample for sample, as
 * it always did: between its parts stand gains of exactly 1.
 */

const GLIDE = 0.012;

export interface Board {
  kit: Kit;
  /** What comes out of the ring's weather filters. */
  from: AudioNode;
  /** Where that meets what the room and the echo in front of the drive send back. */
  meet: GainNode;
  dry: GainNode;
  push: GainNode;
  shaper: WaveShaperNode;
  wet: GainNode;
  /** What leaves the drive, what leaves the crusher. */
  driven: GainNode;
  crushDry: GainNode;
  crushed: GainNode;
  modDry: GainNode;
  to: AudioNode;
  /** The character the shaper has. */
  tone: number;
  /** The filters around the shaper and the clean lows beside it: every character but the warm one has them. */
  filters: { pre: BiquadFilterNode; block: BiquadFilterNode; post: BiquadFilterNode; lowpass: BiquadFilterNode; lows: GainNode } | null;
  crusher: { clock: OscillatorNode; holds: DelayNode[]; smooth: BiquadFilterNode; stairs: WaveShaperNode; wet: GainNode } | null;
  crush: number;
  phaser: { stages: BiquadFilterNode[]; wet: GainNode } | null;
  flanger: { comb: DelayNode; loop: DelayNode; feedback: GainNode; ring: GainNode; wet: GainNode } | null;
  chorus: { wet: GainNode } | null;
  mod: number;
  depth: number;
  room: { send: GainNode } | null;
  echo: { send: GainNode; delay: DelayNode } | null;
}

/**
 * The pedals of one ring: what comes out of `from` goes through them into `to`. Without `drives` the board has no
 * shaper in its path (the sum's board has only its crusher and its modulation: nothing there is ever driven).
 */
export function buildBoard(kit: Kit, from: AudioNode, to: AudioNode, drives = true): Board {
  const context = kit.context;
  const meet = kit.gain(1);
  const dry = kit.gain(1);
  const push = kit.gain(1);
  const shaper = context.createWaveShaper();
  shaper.curve = toneCurve(WARM);
  shaper.oversample = "2x";
  const wet = kit.gain(0);
  const driven = kit.gain(1);
  const crushDry = kit.gain(1);
  const crushed = kit.gain(1);
  const modDry = kit.gain(1);
  from.connect(meet);
  meet.connect(dry).connect(driven);
  if (drives) meet.connect(push).connect(shaper).connect(wet).connect(driven);
  driven.connect(crushDry).connect(crushed);
  crushed.connect(modDry).connect(to);
  return { kit, from, meet, dry, push, shaper, wet, driven, crushDry, crushed, modDry, to, tone: WARM, filters: null, crusher: null, crush: 0, phaser: null, flanger: null, chorus: null, mod: 0, depth: 0, room: null, echo: null };
}

/** Gives the drive another character: another curve, and for all but the warm one the filters around it. */
export function toneBoard(board: Board, tone: number): void {
  if (tone === board.tone) return;
  const { kit, meet, push, shaper, wet, driven } = board;
  shaper.curve = toneCurve(tone);
  // The warm drive keeps its oversampling (it is the shaper every ring always had). The others do without: an
  // oversampled shaper delays what it shapes, by an amount each browser chooses for itself, and what went through it
  // then meets the clean share of the sound a little late: a comb whose teeth sit elsewhere in every browser (the same
  // acid line came out 3 dB apart in Chromium and Firefox). Without it the sum is the same sum everywhere.
  shaper.oversample = tone === WARM ? "2x" : "none";
  const filtered = tone !== WARM;
  if (filtered && !board.filters) {
    const pre = kit.filter("highpass", 30, 0.7);
    // An uneven character leaves the sound standing off the middle: this brings it back.
    const block = kit.filter("highpass", 25, 0.7);
    const post = kit.filter("lowpass", 16_000, 0.7);
    const lowpass = kit.filter("lowpass", 200, 0.7);
    const lows = kit.gain(0);
    pre.connect(shaper);
    block.connect(post);
    meet.connect(lowpass).connect(lows).connect(driven);
    board.filters = { pre, block, post, lowpass, lows };
  }
  const filters = board.filters;
  if (filters && filtered !== (board.tone !== WARM)) {
    if (filtered) {
      push.disconnect(shaper);
      shaper.disconnect(wet);
      push.connect(filters.pre);
      shaper.connect(filters.block);
      filters.post.connect(wet);
    } else {
      push.disconnect(filters.pre);
      shaper.disconnect(filters.block);
      filters.post.disconnect(wet);
      push.connect(shaper);
      shaper.connect(wet);
    }
  }
  board.tone = tone;
}

/** Sets the gains around the shaper, and where its filters sit. */
export function shadeBoard(board: Board, gains: PedalGains, shape: ToneFilters | null, time: number): void {
  board.dry.gain.setTargetAtTime(gains.dry, time, GLIDE);
  board.push.gain.setTargetAtTime(gains.push, time, GLIDE);
  board.wet.gain.setTargetAtTime(gains.wet, time, GLIDE);
  const filters = board.filters;
  if (!filters) return;
  filters.lows.gain.setTargetAtTime(shape && shape.lows > 0 ? gains.lows : 0, time, GLIDE);
  if (!shape) return;
  if (filters.pre.type !== shape.pre.type) filters.pre.type = shape.pre.type;
  filters.pre.frequency.setTargetAtTime(shape.pre.hz, time, GLIDE);
  filters.pre.Q.setTargetAtTime(shape.pre.q, time, GLIDE);
  filters.pre.gain.setTargetAtTime(shape.pre.gain, time, GLIDE);
  if (filters.post.type !== shape.post.type) filters.post.type = shape.post.type;
  filters.post.frequency.setTargetAtTime(shape.post.hz, time, GLIDE);
  filters.post.Q.setTargetAtTime(shape.post.q, time, GLIDE);
  if (shape.lows > 0) filters.lowpass.frequency.setTargetAtTime(shape.lows, time, GLIDE);
}

/** What reaches the crusher's stairs is turned down by this much and up again behind them: a ring can be louder than full scale, and the stairs end there. */
const STAIR_ROOM = 2;

/**
 * The crusher at an amount of 0..1. The sound is looked at only so many times a second, and what is left has only so
 * many levels. Looking at it is done without a worklet (so it renders offline like everything else): the sound is
 * multiplied by pulses an eighth of the time between two looks long (that is sampling, mirror images and all), and
 * each pulse is then laid out eight times side by side, by three delays of a half, a quarter and an eighth of that
 * time. Eight pulses side by side fill the time exactly: the sound is held from one look to the next.
 */
export function crushBoard(board: Board, amount: number, time: number): void {
  if (amount === board.crush) return;
  const { kit, driven, crushed } = board;
  if (amount > 0 && !board.crusher) {
    const context = kit.context;
    const clock = context.createOscillator();
    const harmonics = pulseHarmonics();
    clock.setPeriodicWave(context.createPeriodicWave(harmonics, new Float32Array(harmonics.length), { disableNormalization: true }));
    // The gain is 1, the pulses' mean, and the clock adds their overtones to it.
    const sampler = kit.gain(1);
    clock.connect(sampler.gain);
    driven.connect(sampler);
    let held: AudioNode = sampler;
    const holds = HOLD_SHARES.map(() => {
      const delay = context.createDelay(0.01);
      const both = kit.gain(0.5);
      held.connect(both);
      held.connect(delay).connect(both);
      held = both;
      return delay;
    });
    const smooth = kit.filter("lowpass", 18_000, 0.7);
    const room = kit.gain(1 / STAIR_ROOM);
    const stairs = context.createWaveShaper();
    const wet = kit.gain(0);
    held.connect(smooth).connect(room).connect(stairs).connect(wet).connect(crushed);
    clock.start();
    board.crusher = { clock, holds, smooth, stairs, wet };
  }
  board.crush = amount;
  const crusher = board.crusher;
  if (!crusher) return;
  const gains = crushGains(amount);
  board.crushDry.gain.setTargetAtTime(gains.dry, time, GLIDE);
  crusher.wet.gain.setTargetAtTime(gains.wet * STAIR_ROOM, time, GLIDE);
  if (amount <= 0) return;
  const rate = crushRate(amount);
  crusher.clock.frequency.setTargetAtTime(rate, time, GLIDE);
  crusher.holds.forEach((delay, index) => delay.delayTime.setTargetAtTime((HOLD_SHARES[index] ?? 0) / rate, time, GLIDE));
  crusher.smooth.frequency.setTargetAtTime(Math.min(18_000, rate * 2), time, GLIDE);
  // The stairs see the sound at half its size: one bit more keeps the steps as big as they are meant.
  crusher.stairs.curve = stairCurve(crushBits(amount) + Math.log2(STAIR_ROOM));
}

/** Three slowly swaying copies, spread from left to right. */
const CHORUS_VOICES = [
  { delay: 0.012, rate: 0.31, depth: 0.0021, pan: -0.7 },
  { delay: 0.017, rate: 0.47, depth: 0.0026, pan: 0 },
  { delay: 0.023, rate: 0.62, depth: 0.0019, pan: 0.7 },
] as const;

/** Where a sweep that is not being led rests: halfway up. */
const REST = 0.5;

/** The modulation: which one, and how deep. What it needs is built when it is first asked for. */
export function modBoard(board: Board, mod: number, depth: number, time: number): void {
  if (mod === board.mod && depth === board.depth) return;
  const { kit, crushed, to } = board;
  const context = kit.context;
  const gains = modGains(mod, depth);
  if (mod === PHASER && gains.wet > 0 && !board.phaser) {
    const stages = PHASER_STAGES.map((factor) => kit.filter("allpass", phaserHz(REST) * factor, 0.6));
    const wet = kit.gain(0);
    let before: AudioNode = crushed;
    for (const stage of stages) before = before.connect(stage);
    before.connect(wet).connect(to);
    board.phaser = { stages, wet };
  }
  if (mod === FLANGER && gains.wet > 0 && !board.flanger) {
    // The comb that sweeps, and beside it a loop that rings (a browser delays a loop by a block, so it cannot follow the comb all the way up).
    const comb = context.createDelay(0.05);
    comb.delayTime.value = flangerSeconds(REST);
    const loop = context.createDelay(0.05);
    loop.delayTime.value = Math.max(FLANGER_LOOP_MIN, flangerSeconds(REST));
    const feedback = kit.gain(0);
    const ring = kit.gain(0);
    const wet = kit.gain(0);
    crushed.connect(comb).connect(wet).connect(to);
    crushed.connect(loop).connect(feedback).connect(loop);
    loop.connect(ring).connect(wet);
    board.flanger = { comb, loop, feedback, ring, wet };
  }
  if (mod === CHORUS && gains.wet > 0 && !board.chorus) {
    const chorus = createChorus(kit, { voices: CHORUS_VOICES, dry: 0, wet: 0, to });
    crushed.connect(chorus.input);
    board.chorus = { wet: chorus.wet };
  }
  board.modDry.gain.setTargetAtTime(gains.dry, time, GLIDE);
  board.phaser?.wet.gain.setTargetAtTime(mod === PHASER ? gains.wet : 0, time, GLIDE);
  board.flanger?.wet.gain.setTargetAtTime(mod === FLANGER ? gains.wet : 0, time, GLIDE);
  board.flanger?.feedback.gain.setTargetAtTime(mod === FLANGER ? gains.feedback : 0, time, GLIDE);
  board.flanger?.ring.gain.setTargetAtTime(mod === FLANGER ? gains.feedback * 0.7 : 0, time, GLIDE);
  board.chorus?.wet.gain.setTargetAtTime(mod === CHORUS ? gains.wet : 0, time, GLIDE);
  board.mod = mod;
  board.depth = depth;
}

/**
 * Leads the sweep from `from` at `time` to `to` at `end` (each 0 at its bottom, 1 at its top). Nothing is cancelled
 * here: the slope of the step before ends exactly where this one begins, and cancelling from `time` on would take it away.
 */
export function sweepBoard(board: Board, from: number, to: number, time: number, end: number): void {
  if (end <= time) return;
  if (board.mod === PHASER && board.phaser) {
    board.phaser.stages.forEach((stage, index) => {
      const factor = PHASER_STAGES[index] ?? 1;
      stage.frequency.setValueAtTime(phaserHz(from) * factor, time);
      stage.frequency.exponentialRampToValueAtTime(phaserHz(to) * factor, end);
    });
  }
  if (board.mod === FLANGER && board.flanger) {
    const { comb, loop } = board.flanger;
    comb.delayTime.setValueAtTime(flangerSeconds(from), time);
    comb.delayTime.exponentialRampToValueAtTime(flangerSeconds(to), end);
    loop.delayTime.setValueAtTime(Math.max(FLANGER_LOOP_MIN, flangerSeconds(from)), time);
    loop.delayTime.exponentialRampToValueAtTime(Math.max(FLANGER_LOOP_MIN, flangerSeconds(to)), end);
  }
}

/** Nobody leads the sweep any more (the Kreisel stops): it glides to where it rests. */
export function restBoard(board: Board, time: number): void {
  for (const stage of board.phaser?.stages ?? []) {
    stage.frequency.cancelScheduledValues(time);
    stage.frequency.setTargetAtTime(phaserHz(REST) * (PHASER_STAGES[board.phaser?.stages.indexOf(stage) ?? 0] ?? 1), time, 0.05);
  }
  if (board.flanger) {
    board.flanger.comb.delayTime.cancelScheduledValues(time);
    board.flanger.comb.delayTime.setTargetAtTime(flangerSeconds(REST), time, 0.05);
    board.flanger.loop.delayTime.cancelScheduledValues(time);
    board.flanger.loop.delayTime.setTargetAtTime(Math.max(FLANGER_LOOP_MIN, flangerSeconds(REST)), time, 0.05);
  }
}

/**
 * The room and the echo in front of the drive: how much of the ring goes into each (0 for a ring whose reverb and
 * echo come after its drive, as the bus sends them then). `impulse` is the room they share, `echoSeconds` the echo's time.
 */
export function frontBoard(board: Board, room: number, echo: number, echoSeconds: number, impulse: () => AudioBuffer, time: number): void {
  const { kit, from, meet } = board;
  if (room > 0 && !board.room) {
    const send = kit.gain(0);
    const reverb = createReverb(kit, impulse(), { to: meet, level: ROOM_LEVEL });
    from.connect(send).connect(reverb.input);
    board.room = { send };
  }
  if (echo > 0 && !board.echo) {
    const send = kit.gain(0);
    const line = createEcho(kit, { time: echoSeconds, feedback: FRONT_ECHO.feedback, tone: FRONT_ECHO.tone, q: 0.7, to: meet, level: FRONT_ECHO.level });
    from.connect(send).connect(line.input);
    board.echo = { send, delay: line.delay };
  }
  // Whatever a step scheduled ahead of this is taken back: this is the last word.
  board.room?.send.gain.cancelScheduledValues(time);
  board.room?.send.gain.setTargetAtTime(room, time, GLIDE);
  board.echo?.send.gain.cancelScheduledValues(time);
  board.echo?.send.gain.setTargetAtTime(echo, time, GLIDE);
  board.echo?.delay.delayTime.setTargetAtTime(echoSeconds, time, 0.05);
}

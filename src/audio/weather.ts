import type { Kit } from "klangwerk";
import type { Pedals } from "../model";
import { echoFirst, noPedals, pedalGains, reverbFirst, sweepAt, sweeps, toneFilters, WARM } from "../pedals";
import { driven } from "../press";
import { buildBoard, crushBoard, frontBoard, modBoard, restBoard, shadeBoard, sweepBoard, toneBoard, type Board } from "./pedals";

/*
 * What the weather does to a ring's sound. Every ring's notes pass through a
 * short chain on their way to the ring's bus: fog closes a filter, sun lifts
 * the highs, sparks drive the sound into a shaper, hail chops it. Clouds and
 * rain send what leaves the bus into the hall and the echo. Step by step the
 * player says how much of each kind lies on the ring right now.
 *
 * The shaper is also the ring's "Drive": a ring can be driven all the time,
 * and the sparks that lie on it come on top. Around it stand the ring's
 * pedals (see src/audio/pedals.ts): the drive's character, the crusher, the
 * modulation, and for a ring whose reverb or echo comes before its drive a
 * room and an echo of its own in front of it. On such a ring the clouds and
 * the rain go that way too.
 */

export interface Chain {
  /** Where the ring's notes go in. */
  input: GainNode;
  fog: BiquadFilterNode;
  sun: BiquadFilterNode;
  /** The drive and the pedals around it. */
  board: Board;
  chop: GainNode;
  cloud: GainNode;
  rain: GainNode;
  /** The ring's own Zerre, 0..1: how hard it is driven under a clear sky. */
  drive: number;
  /** The drive's character, and the sweep of the ring's modulation: what it is, how deep, where its top is and how long it takes. */
  tone: number;
  mod: number;
  depth: number;
  crest: number;
  span: number;
  /** What of the ring's own reverb and echo comes before its drive: whether each does, and how much of each there is. */
  front: { reverb: boolean; echo: boolean; hall: number; echoes: number; seconds: number };
  /** The room that rings in front of a drive, made when the first ring asks for it. */
  room: () => AudioBuffer;
  /** What was asked for last, kind by kind, so nothing is scheduled twice. */
  last: number[];
}

/** What a ring wears right now: its drive and pedals, and its reverb and echo (which the pedals may put in front of the drive). */
export interface Wear {
  drive: number;
  pedals: Pedals | undefined;
  hall: number;
  echo: number;
  /** The echo's time, in seconds. */
  echoSeconds: number;
}

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const GLIDE = 0.012;

/**
 * The chain of one ring: into `to` (the ring's bus), with weather sends from `tap` (what leaves the bus) to hall and
 * echo. `room` gives the room that rings in front of a drive.
 */
export function buildChain(kit: Kit, to: AudioNode, tap: AudioNode, hall: AudioNode, echo: AudioNode, room: () => AudioBuffer): Chain {
  const input = kit.gain(1);
  const fog = kit.filter("lowpass", 19_000, 0.7);
  const sun = kit.filter("highshelf", 3200, 0.7);
  sun.gain.value = 0;
  const chop = kit.gain(1);
  input.connect(fog).connect(sun);
  const board = buildBoard(kit, sun, chop);
  chop.connect(to);
  const cloud = kit.gain(0);
  const rain = kit.gain(0);
  tap.connect(cloud).connect(hall);
  tap.connect(rain).connect(echo);
  return { input, fog, sun, board, chop, cloud, rain, drive: 0, tone: WARM, mod: 0, depth: 0, crest: 0, span: 0, front: { reverb: false, echo: false, hall: 0, echoes: 0, seconds: 0.3 }, room, last: [0, 0, 0, 0, 0, 0] };
}

/** Sets the gains around the shaper (and where its filters sit) for the ring's Zerre and the sparks over it. */
function shape(chain: Chain, sparks: number, time: number): void {
  shadeBoard(chain.board, pedalGains(chain.tone, chain.drive, sparks), toneFilters(chain.tone, driven(chain.drive, sparks)), time);
}

/**
 * Where the ring's room is: clouds and rain go to the hall and the echo everything shares, or, on a ring whose
 * reverb or echo comes before its drive, into the room and the echo in front of it, together with the ring's own.
 */
function space(chain: Chain, time: number): void {
  const { front, last } = chain;
  const cloud = (last[2] ?? 0) * 0.9;
  const rain = (last[3] ?? 0) * 0.85;
  // Whatever a step scheduled ahead of this is taken back: this is the last word.
  chain.cloud.gain.cancelScheduledValues(time);
  chain.cloud.gain.setTargetAtTime(front.reverb ? 0 : cloud, time, GLIDE);
  chain.rain.gain.cancelScheduledValues(time);
  chain.rain.gain.setTargetAtTime(front.echo ? 0 : rain, time, GLIDE);
  frontBoard(chain.board, front.reverb ? Math.min(1, front.hall + cloud) : 0, front.echo ? Math.min(1, front.echoes + rain) : 0, front.seconds, chain.room, time);
}

/** The ring's own Zerre, 0..1. The sparks that lie on the ring right now stay on top of it. */
export function driveChain(chain: Chain, drive: number, time: number): void {
  if (drive === chain.drive) return;
  chain.drive = drive;
  shape(chain, chain.last[4] ?? 0, time);
}

/** Brings the chain in line with what the ring wears: its drive and its character, its crusher, its modulation, its order. */
export function wearChain(chain: Chain, wear: Wear, time: number): void {
  const pedals = wear.pedals ?? noPedals();
  if (pedals.tone !== chain.tone) {
    toneBoard(chain.board, pedals.tone);
    chain.tone = pedals.tone;
    chain.drive = wear.drive;
    shape(chain, chain.last[4] ?? 0, time);
  } else {
    driveChain(chain, wear.drive, time);
  }
  crushBoard(chain.board, pedals.crush, time);
  modBoard(chain.board, pedals.mod, pedals.depth, time);
  chain.mod = pedals.mod;
  chain.depth = pedals.depth;
  chain.crest = pedals.crest;
  chain.span = pedals.span;
  const front = { reverb: reverbFirst(pedals), echo: echoFirst(pedals), hall: wear.hall, echoes: wear.echo, seconds: wear.echoSeconds };
  const before = chain.front;
  // A ring with a clean room never had anything in front of its drive: nothing to set.
  const matters = front.reverb || front.echo || before.reverb || before.echo;
  const changed = front.reverb !== before.reverb || front.echo !== before.echo || front.hall !== before.hall || front.echoes !== before.echoes || front.seconds !== before.seconds;
  chain.front = front;
  if (matters && changed) space(chain, time);
}

/**
 * A step of the ring: how much of each kind of weather (fog, sun, clouds, rain, sparks, hail; each 0..1) lies on it
 * now. With `position` (the step the ring's runner is on, counted on without going round) and the ring's `length`,
 * the sweep of its modulation is led through this step too: it goes with the runner, so its top is where its mark is.
 */
export function stepChain(chain: Chain, over: readonly number[], time: number, step: number, position?: number, length = 16): void {
  const [fog = 0, sun = 0, cloud = 0, rain = 0, sparks = 0, hail = 0] = over;
  const { last } = chain;
  const inFront = chain.front.reverb || chain.front.echo;
  if (fog !== last[0]) chain.fog.frequency.setTargetAtTime(expo(19_000, 450, fog ** 0.8), time, GLIDE);
  if (sun !== last[1]) chain.sun.gain.setTargetAtTime(sun * 7, time, GLIDE);
  if (!inFront && cloud !== last[2]) chain.cloud.gain.setTargetAtTime(cloud * 0.9, time, GLIDE);
  if (!inFront && rain !== last[3]) chain.rain.gain.setTargetAtTime(rain * 0.85, time, GLIDE);
  if (sparks !== last[4]) {
    last[4] = sparks;
    shape(chain, sparks, time);
  }
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
  const moved = cloud !== last[2] || rain !== last[3];
  chain.last = [fog, sun, cloud, rain, sparks, hail];
  if (inFront && moved) space(chain, time);
  if (position !== undefined && sweeps(chain.mod) && chain.depth > 0) {
    sweepBoard(chain.board, sweepAt(position, length, chain.crest, chain.span), sweepAt(position + 1, length, chain.crest, chain.span), time, time + step);
  }
}

/** Clear sky over the ring (the Kreisel stops: a note played by hand sounds as the ring itself does), and its sweep comes to rest. */
export function clearChain(chain: Chain, time: number): void {
  stepChain(chain, [0, 0, 0, 0, 0, 0], time, 0.1);
  restBoard(chain.board, time);
}

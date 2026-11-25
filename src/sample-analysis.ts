/*
 * Looking at a recording. A sound that is dropped onto a ring, or taken with
 * the microphone, is a row of numbers. Before the sampler can play it,
 * somebody has to say where the sound in it begins and ends, how loud it is,
 * whether it is one hit or a loop of many, where the hits of a loop are, how
 * fast the loop goes and which note a tone sings. This does, so that a
 * recording lands on its ring trimmed, levelled, cut up and in tune without
 * anybody turning a knob.
 *
 * Plain arithmetic on the samples: no browser needed. Nothing here looks at a
 * sample more than a few times, so a minute of sound is looked through in a
 * fraction of a second.
 */

const share01 = (value: number): number => Math.min(1, Math.max(0, value));

/** A length of time as a whole number of samples: at least one, whatever the sample rate claims to be. */
const samplesIn = (seconds: number, sampleRate: number): number => Math.max(1, Math.round(seconds * sampleRate) || 0);

// ---- how loud ------------------------------------------------------------------------------

/** Both channels as one (their mean); a mono sound is returned as it is. */
export function mixdown(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (const channel of channels) for (let index = 0; index < mono.length; index += 1) mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
  return mono;
}

/** The highest absolute sample. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const size = Math.abs(samples[index] ?? 0);
    if (size > peak) peak = size;
  }
  return peak;
}

/** How loud it is where it is loudest: the root mean square of its loudest 300 ms (of all of it, if it is shorter). */
export function loudOf(samples: Float32Array, sampleRate: number): number {
  const length = samples.length;
  if (length === 0) return 0;
  const size = Math.min(length, samplesIn(0.3, sampleRate));
  let sum = 0;
  let most = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
    if (index >= size) sum -= (samples[index - size] ?? 0) ** 2;
    if (index >= size - 1 && sum > most) most = sum;
  }
  return Math.sqrt(most / size);
}

/** The factor that brings a recording to the level the rings' own sounds have: its loudest 300 ms to `target` (default 0.25), but never so far that its peak passes `ceiling` (default 0.9), never more than 8 and never for a silent recording (then 1). */
export function levelFor(samples: Float32Array, sampleRate: number, target = 0.25, ceiling = 0.9): number {
  const loud = loudOf(samples, sampleRate);
  const peak = peakOf(samples);
  // Below a millionth there is nothing to bring up but the noise of the numbers themselves.
  if (!(loud > 1e-6) || !(peak > 0)) return 1;
  return Math.min(target / loud, ceiling / peak, 8);
}

// ---- where it is ---------------------------------------------------------------------------

/** How far below its peak a recording still counts as sound, as a factor: 50 dB. */
const QUIET = 10 ** (-50 / 20);

/** Where the sound begins and ends, as sample indexes: the first and the last place where it is louder than a threshold 50 dB below its peak (measured on a short running level, so a single stray sample does not count), with 3 ms left in front and 30 ms behind, within the recording. A silent recording is all of it. */
export function soundSpan(samples: Float32Array, sampleRate: number): { from: number; to: number } {
  const length = samples.length;
  const threshold = peakOf(samples) * QUIET;
  if (!(threshold > 0)) return { from: 0, to: length };
  // The running level is the mean square of the last 3 ms. One sample alone has to be some 20 dB over the
  // threshold to lift it there, so a stray one down in the noise does not count; a click as loud as the sound does.
  const size = Math.min(length, samplesIn(0.003, sampleRate));
  const limit = threshold * threshold * size;
  let sum = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < length; index += 1) {
    sum += (samples[index] ?? 0) ** 2;
    if (index >= size) sum -= (samples[index - size] ?? 0) ** 2;
    if (sum > limit) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) return { from: 0, to: length };
  // Within the first and the last stretch that were loud, the very sample that made them so.
  let begin = first;
  for (let index = Math.max(0, first - size + 1); index < first; index += 1) {
    if (Math.abs(samples[index] ?? 0) > threshold) {
      begin = index;
      break;
    }
  }
  let end = last;
  while (end > Math.max(0, last - size + 1) && Math.abs(samples[end] ?? 0) <= threshold) end -= 1;
  return { from: Math.max(0, begin - samplesIn(0.003, sampleRate)), to: Math.min(length, end + 1 + samplesIn(0.03, sampleRate)) };
}

/** For drawing: the lowest and the highest sample of each of `buckets` equal parts between `from` and `to` (sample indexes, default the whole), as [low0, high0, low1, high1, …]. */
export function peaks(samples: Float32Array, buckets: number, from = 0, to = samples.length): Float32Array<ArrayBuffer> {
  const count = Math.max(0, Math.floor(buckets) || 0);
  const drawn = new Float32Array(count * 2);
  const start = Math.min(samples.length, Math.max(0, Math.floor(from) || 0));
  const end = Math.min(samples.length, Math.max(start, Math.floor(to) || 0));
  if (end <= start) return drawn;
  for (let bucket = 0; bucket < count; bucket += 1) {
    // Drawn wider than it is long, a part still shows the sample it stands on.
    const first = Math.min(end - 1, start + Math.floor((bucket * (end - start)) / count));
    const behind = Math.max(first + 1, start + Math.floor(((bucket + 1) * (end - start)) / count));
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let index = first; index < behind; index += 1) {
      const value = samples[index] ?? 0;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    drawn[bucket * 2] = low;
    drawn[bucket * 2 + 1] = high;
  }
  return drawn;
}

/** A copy played backwards. */
export function reversed(samples: Float32Array): Float32Array<ArrayBuffer> {
  const copy = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) copy[index] = samples[samples.length - 1 - index] ?? 0;
  return copy;
}

// ---- hits ----------------------------------------------------------------------------------

/** Hits are looked for in steps of 5 ms. */
const HOP_SECONDS = 0.005;
/**
 * A rise is measured against the loudest of so many frames: with a frame's
 * own length they span 40 ms, one round of a wave of 25 Hz. More, and the
 * quick hits of a roll hide behind one another.
 */
const PAST = 6;
/** Those frames end so many before the frame itself: a hit takes up to three frames to lie whole in one, and is not to be measured against its own beginning. */
const ATTACK = 2;
/** What lies this far below the loudest moment is silence, in dB: nothing rises out of it or in it. */
const FLOOR_DB = -50;
/** Hits are at least this far apart, in seconds. */
const APART = 0.05;

interface Frames {
  /** Samples from one frame to the next. A frame is two of these long, so that every hit lies whole in one. */
  hop: number;
  /** The mean square of each frame of the sound itself: where a drum has its weight. */
  body: Float64Array;
  /** The mean square of the step from each sample to the next: where an attack and a hi-hat have theirs. */
  edge: Float64Array;
}

/**
 * A recording as frames of energy, in two views. A kick under a hi-hat shows
 * in the first and not in the second; a hi-hat on the tail of a kick shows in
 * the second and not in the first. The two are in the same unit: a hiss is
 * about as strong in the one as in the other.
 */
function framesOf(samples: Float32Array, sampleRate: number): Frames {
  const hop = samplesIn(HOP_SECONDS, sampleRate);
  const blocks = Math.ceil(samples.length / hop);
  const bodyOf = new Float64Array(blocks + 1);
  const edgeOf = new Float64Array(blocks + 1);
  let before = samples[0] ?? 0;
  for (let block = 0; block < blocks; block += 1) {
    const end = Math.min(samples.length, (block + 1) * hop);
    let body = 0;
    let edge = 0;
    for (let index = block * hop; index < end; index += 1) {
      const value = samples[index] ?? 0;
      body += value * value;
      edge += (value - before) * (value - before);
      before = value;
    }
    bodyOf[block] = body;
    edgeOf[block] = edge;
  }
  const count = Math.max(blocks - 1, Math.min(blocks, 1));
  const body = new Float64Array(count);
  const edge = new Float64Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    body[frame] = ((bodyOf[frame] ?? 0) + (bodyOf[frame + 1] ?? 0)) / (2 * hop);
    edge[frame] = ((edgeOf[frame] ?? 0) + (edgeOf[frame + 1] ?? 0)) / (2 * hop);
  }
  return { hop, body, edge };
}

/**
 * How far each frame's level stands above the loudest of the frames shortly
 * before it, in dB. Before the recording there was silence.
 *
 * The loudest, not the mean: a low tone's level goes up and down with its
 * wave (a frame holds less than one round of it), and a low saw or square has
 * one large step a round and nothing between. Against the mean, every round
 * would be a rise. Against the loudest of 40 ms, which have a whole round in
 * them, none is.
 */
function risesOf(levels: Float64Array, silence: number): Float64Array {
  const rises = new Float64Array(levels.length);
  for (let frame = 0; frame < levels.length; frame += 1) {
    let loudest = silence;
    for (let back = Math.max(0, frame - ATTACK - PAST); back < frame - ATTACK; back += 1) loudest = Math.max(loudest, levels[back] ?? silence);
    rises[frame] = (levels[frame] ?? silence) - loudest;
  }
  return rises;
}

/** The size of what a hit is looked for in, sample by sample: of the sound itself, or of its step from the sample before. */
const sizeAt = (samples: Float32Array, index: number, sharp: boolean): number => Math.abs((samples[index] ?? 0) - (sharp && index > 0 ? (samples[index - 1] ?? 0) : 0));

/**
 * The sample a hit begins on, between the last calm frame and the last frame
 * of its rise: the first one that stands out from what sounded just before,
 * by a tenth of the way to the hit's own height. Frames say where a hit is to
 * 5 ms; a slice that begins 5 ms late has lost its attack, and one that
 * begins 5 ms early plays late. And a hiss that a recording begins with, a
 * blink before its first hit, is not that hit.
 */
function beginning(samples: Float32Array, hop: number, calm: number, risen: number, sharp: boolean): number {
  const from = Math.max(0, (calm + 1) * hop);
  const to = Math.min(samples.length, (risen + 2) * hop);
  const size = (index: number): number => sizeAt(samples, index, sharp);
  let around = 0;
  for (let index = Math.max(0, from - 2 * hop); index < from; index += 1) around = Math.max(around, size(index));
  let peak = 0;
  for (let index = from; index < to; index += 1) peak = Math.max(peak, size(index));
  // Nothing stands out sample by sample (a swell, a hit under something louder): the frames' word stands.
  if (peak <= around * 1.5) return Math.min(samples.length, (calm + 2) * hop);
  const threshold = around + 0.1 * (peak - around);
  for (let index = from; index < to; index += 1) if (size(index) > threshold) return index;
  return from;
}

/**
 * Whether the step at `at` stands alone: nothing a quarter its size follows
 * within 5 ms. Where a sound was cut off in mid-wave there is one large step
 * and then nothing, and that is the end of a sound, not a hit. A hiss, a
 * click, an attack are many steps.
 */
function alone(samples: Float32Array, at: number, hop: number): boolean {
  const step = sizeAt(samples, at, true);
  for (let index = at + 1; index <= Math.min(samples.length - 1, at + hop); index += 1) if (sizeAt(samples, index, true) > step / 4) return false;
  return true;
}

/** Where hits begin, in seconds from the start, in order: places where the sound's energy rises suddenly. `sensitivity` 0..1 (default 0.5): higher finds quieter hits. Hits are at least 50 ms apart; a sound that starts at once has a hit at (or within 10 ms of) 0. */
export function onsets(samples: Float32Array, sampleRate: number, sensitivity = 0.5): number[] {
  const { hop, body, edge } = framesOf(samples, sampleRate);
  const count = body.length;
  let most = 0;
  for (const energy of body) most = Math.max(most, energy);
  if (!(most > 0) || !(sampleRate > 0)) return [];
  const fine = share01(sensitivity);
  const floor = most * 10 ** (FLOOR_DB / 10);
  const silence = 10 * Math.log10(floor);
  const bodyLevel = body.map((energy) => 10 * Math.log10(energy + floor));
  const edgeLevel = edge.map((energy) => 10 * Math.log10(energy + floor));
  const bodyRise = risesOf(bodyLevel, silence);
  const edgeRise = risesOf(edgeLevel, silence);
  const rise = bodyRise.map((value, frame) => Math.max(value, edgeRise[frame] ?? 0));

  // Two things make a hit. Its level rises above all that was just before it: by 11 dB for the coarsest ear, by 5
  // for the finest (less than that, and a low rumble is full of hits).
  const needed = 11 - 6 * fine;
  // And it adds something worth the name: within 6 dB of the loudest moment for the coarsest ear, within 46 for the finest.
  const worth = most * 10 ** (-(6 + 40 * fine) / 10);

  const hits: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    if ((rise[frame] ?? 0) < needed) continue;
    const plain = frame;
    // One rise is one hit, however long it rises: on to where it has fallen back.
    let top = frame;
    while (frame + 1 < count && (rise[frame + 1] ?? 0) >= needed / 2) {
      frame += 1;
      if ((rise[frame] ?? 0) > (rise[top] ?? 0)) top = frame;
    }
    // Back to the last frame that was calm, in the view that shows the hit better.
    const sharp = (edgeRise[top] ?? 0) > (bodyRise[top] ?? 0);
    const level = sharp ? edgeLevel : bodyLevel;
    let calm = plain - 1;
    for (let steps = 0; steps < PAST && calm >= 0 && (level[calm] ?? silence) - (level[calm - 1] ?? silence) > 1; steps += 1) calm -= 1;
    let gained = 0;
    for (let later = plain; later <= Math.min(count - 1, frame + 2); later += 1) gained = Math.max(gained, (body[later] ?? 0) - (body[calm] ?? 0), (edge[later] ?? 0) - (edge[calm] ?? 0));
    if (gained < worth) continue;
    const at = beginning(samples, hop, calm, frame, sharp);
    if (sharp && (bodyRise[top] ?? 0) < needed && alone(samples, at, hop)) continue;
    const last = hits[hits.length - 1];
    if (last === undefined || at - last >= APART * sampleRate) hits.push(at);
  }
  return hits.map((at) => at / sampleRate);
}

// ---- how fast ------------------------------------------------------------------------------

const BARS = [1, 2, 4, 8, 16] as const;
/** A loop is taken for so many bars as long as its own tempo is no further than this from the Kreisel's. */
const SLOWEST = 0.75;
const FASTEST = 1.34;

/** For a loop of `seconds` played at `bpm` (four beats a bar): the whole number of bars among 1, 2, 4, 8, 16 whose length is nearest to it, and the tempo at which it would be exactly that many bars. If the nearest is off by more than a quarter (the loop's own tempo would be below 0.75 or above 1.34 times `bpm`), the half and double tempos are tried by taking the neighbouring bar counts; the answer always has a `bpm` the loop would have at that bar count. */
export function barsFor(seconds: number, bpm: number): { bars: number; bpm: number } {
  if (!(seconds > 0) || !(bpm > 0) || !Number.isFinite(seconds) || !Number.isFinite(bpm)) return { bars: 1, bpm };
  const bar = 240 / bpm;
  /** How many times the Kreisel's tempo the loop's own would be, were it so many bars. */
  const ratio = (bars: number): number => (bars * bar) / seconds;
  let bars: number = BARS[0];
  for (const count of BARS) if (Math.abs(count * bar - seconds) < Math.abs(bars * bar - seconds)) bars = count;
  if (ratio(bars) < SLOWEST || ratio(bars) > FASTEST) {
    // Too slow as so many bars: as twice as many it is twice as fast. Too fast: as half as many it is half as fast.
    const other = ratio(bars) < SLOWEST ? bars * 2 : bars / 2;
    const fits = ratio(other) >= SLOWEST && ratio(other) <= FASTEST;
    // Where neither fits, the one that asks for less stretching.
    if (BARS.some((count) => count === other) && (fits || Math.abs(Math.log(ratio(other))) < Math.abs(Math.log(ratio(bars))))) bars = other;
  }
  return { bars, bpm: (bars * 240) / seconds };
}

/** The tempos a loop can be said to have. */
const SLOW_BPM = 70;
const FAST_BPM = 200;

/**
 * How likely a tempo is before anything was heard. A loop's hits agree with
 * half and with double their tempo as well as with the tempo itself, so
 * something has to choose: the nearer to 130 BPM, the likelier (an octave away
 * counts for about six tenths).
 */
const likely = (bpm: number): number => Math.exp(-0.5 * Math.log2(bpm / 130) ** 2);

/** The loop's own tempo from its hits, 70..200 BPM: the spacing that most of its hits agree on (autocorrelation of an onset envelope), or `null` if it has too few hits to say. */
export function tempoOf(samples: Float32Array, sampleRate: number): number | null {
  if (onsets(samples, sampleRate).length < 4) return null;
  const { hop, body, edge } = framesOf(samples, sampleRate);
  const count = body.length;
  const step = hop / sampleRate;
  // The envelope: how much each frame rose over the one before, loud hits counting for more than quiet ones
  // but not for everything (the fourth root of the energy).
  const envelope = new Float64Array(count);
  let mean = 0;
  for (let frame = 0; frame < count; frame += 1) {
    const rose = Math.max(0, (body[frame] ?? 0) ** 0.25 - (body[frame - 1] ?? 0) ** 0.25) + Math.max(0, (edge[frame] ?? 0) ** 0.25 - (edge[frame - 1] ?? 0) ** 0.25);
    envelope[frame] = rose;
    mean += rose / count;
  }
  for (let frame = 0; frame < count; frame += 1) envelope[frame] = (envelope[frame] ?? 0) - mean;
  const known = new Map<number, number>();
  /** How well the envelope agrees with itself a number of frames later. */
  const agrees = (lag: number): number => {
    let value = known.get(lag);
    if (value === undefined) {
      value = 0;
      for (let frame = 0; frame + lag < count; frame += 1) value += (envelope[frame] ?? 0) * (envelope[frame + lag] ?? 0);
      value /= count - lag;
      known.set(lag, value);
    }
    return value;
  };
  /** A peak between the frames: the top of the parabola through it and its two neighbours. */
  const exact = (lag: number): number => {
    const bend = agrees(lag - 1) - 2 * agrees(lag) + agrees(lag + 1);
    return lag + (bend < 0 ? (0.5 * (agrees(lag - 1) - agrees(lag + 1))) / bend : 0);
  };

  // A beat has to fit into the recording twice to be heard as one.
  const shortest = Math.ceil(60 / FAST_BPM / step);
  const longest = Math.min(Math.floor(60 / SLOW_BPM / step), count >> 1);
  let best = 0;
  let score = 0;
  for (let lag = shortest; lag <= longest; lag += 1) {
    const here = agrees(lag) * likely(60 / (lag * step));
    if (here > score) [best, score] = [lag, here];
  }
  if (best === 0) return null;
  // A frame is 5 ms, which at 150 BPM is two beats a minute either way. Two, four, eight beats on, the same
  // 5 ms are a half, a quarter, an eighth of that: the beat is measured on the longest stretch that still agrees.
  let beat = exact(best);
  for (let times = 2; times <= 16; times *= 2) {
    const around = Math.round(beat * times);
    if (around + 2 > (count * 2) / 3) break;
    let top = around - 2;
    for (let lag = around - 1; lag <= around + 2; lag += 1) if (agrees(lag) > agrees(top)) top = lag;
    if (Math.abs(top - around) > 1 || agrees(top) <= 0) break;
    beat = exact(top) / times;
  }
  return Math.min(FAST_BPM, Math.max(SLOW_BPM, 60 / (beat * step)));
}

// ---- what it is ----------------------------------------------------------------------------

/** A loop with less than this many seconds of silence in front was cut to its bars. */
const CUT = 0.02;
/** A hit lies on a grid when it is no further from one of its lines than this share of a step. */
const NEAR = 0.18;
/** So many of a recording's hits have to lie on a grid of sixteenths for it to be a loop. Speech and single sounds do not. */
const REGULAR = 0.75;
/**
 * A recording with silence in front has no bars to go by: its grid is laid through its own hits, and a grid laid
 * through hits always agrees with some of them. So there it takes more hits, and more of them on the grid (the first
 * hit, through which the grid is laid, does not count).
 */
const FREE_HITS = 8;
const FREE_REGULAR = 0.85;

/** How many of `times` (in seconds) lie on a grid of `step` seconds that begins at `anchor`, as a share 0..1: within `near` of a line, as a share of a step. No times, or no step: 0. */
export function onGrid(times: readonly number[], step: number, anchor = 0, near = NEAR): number {
  if (times.length === 0 || !(step > 0)) return 0;
  let on = 0;
  for (const time of times) {
    const place = (time - anchor) / step;
    if (Math.abs(place - Math.round(place)) <= near) on += 1;
  }
  return on / times.length;
}

/** What a recording is when it comes in. */
export interface Shape {
  /** The part of it that is played, as sample indexes. */
  from: number;
  to: number;
  /** For a loop: how many bars that part is, and at which tempo. `null` for a single sound. */
  loop: { bars: number; bpm: number } | null;
}

/**
 * What a recording is when it comes in to a Kreisel that runs at `bpm`: a single sound (a hit, a shout, a sentence),
 * or a loop to be laid around a ring. A loop is at least 1.5 seconds long and has at least four hits (eight, if
 * it does not begin at once), most of which lie on a grid of sixteenths; a spoken sentence has hits too, but they
 * lie where they like.
 *
 * A single sound is played without the silence before and after it. A loop that begins at once was cut to its bars:
 * the quiet after its last hit belongs to its length, and it is taken whole. A loop with silence in front is
 * somebody's own recording: it begins at its first hit and is as many whole bars long as fit into it, at its own
 * tempo (of the tempos its hits agree with, the one nearest to `bpm`).
 */
export function shapeOf(samples: Float32Array, sampleRate: number, bpm: number): Shape {
  const heard = soundSpan(samples, sampleRate);
  const single: Shape = { ...heard, loop: null };
  if (!(sampleRate > 0) || !(bpm > 0) || (heard.to - heard.from) / sampleRate < 1.5) return single;
  if (heard.from < CUT * sampleRate) {
    const seconds = samples.length / sampleRate;
    const fit = barsFor(seconds, bpm);
    const hits = onsets(samples, sampleRate);
    if (hits.length >= 4 && onGrid(hits, seconds / (fit.bars * 16)) >= REGULAR) return { from: 0, to: samples.length, loop: fit };
  }
  const part = samples.subarray(heard.from, heard.to);
  const hits = onsets(part, sampleRate);
  const own = hits.length >= FREE_HITS ? tempoOf(part, sampleRate) : null;
  if (own === null) return single;
  // Hits agree with half and with double their tempo as well: the Kreisel's own tempo says which is meant.
  const tempo = [own / 2, own, own * 2].reduce((best, one) => (Math.abs(Math.log(one / bpm)) < Math.abs(Math.log(best / bpm)) ? one : best));
  if (onGrid(hits.slice(1), 15 / tempo, hits[0] ?? 0) < FREE_REGULAR) return single;
  const bar = 240 / tempo;
  // As many whole bars as fit (the last may lack the quiet after its last hit, which was left out as silence).
  let bars: number = BARS[0];
  for (const count of BARS) if (count * bar <= part.length / sampleRate + bar / 8) bars = count;
  return { from: heard.from, to: Math.min(samples.length, heard.from + Math.round(bars * bar * sampleRate)), loop: { bars, bpm: tempo } };
}

// ---- which note ----------------------------------------------------------------------------

/** The pitches a sound can be said to have, in Hz. */
const LOWEST_HZ = 30;
const HIGHEST_HZ = 2000;
/** A tone right at one of the two ends is still heard: a quarter tone past them. */
const SLACK = 2 ** (1 / 24);
/** Samples a pitch is listened for in at a time: at 48 kHz, two and a half rounds of the lowest. */
const LISTEN = 4096;

/** The sound at half its sample rate: every two samples as their mean. */
function halved(samples: Float32Array): Float32Array {
  const half = new Float32Array(samples.length >> 1);
  for (let index = 0; index < half.length; index += 1) half[index] = ((samples[index * 2] ?? 0) + (samples[index * 2 + 1] ?? 0)) / 2;
  return half;
}

/**
 * The pitch of one stretch of sound, by McLeod's method: how alike the
 * stretch is to itself a number of samples later, for every such number. A
 * tone is most alike after one round of its wave, and after two, and three;
 * the first of those tops that is nearly as high as the highest is the round
 * (not a later one, which would be an octave too low). How high that top is
 * says how clear the tone is: 1 for a wave that repeats exactly.
 */
function pitchAt(sound: Float32Array, at: number, size: number, rate: number): { hz: number; clarity: number } | null {
  const wave = new Float64Array(size);
  let mean = 0;
  for (let index = 0; index < size; index += 1) mean += (sound[at + index] ?? 0) / size;
  let power = 0;
  for (let index = 0; index < size; index += 1) {
    const value = (sound[at + index] ?? 0) - mean;
    wave[index] = value;
    power += value * value;
  }
  if (!(power > 0)) return null;
  const longest = Math.min(size >> 1, Math.ceil((rate * SLACK) / LOWEST_HZ) + 1);
  const alike = new Float64Array(longest + 2);
  alike[0] = 1;
  let both = 2 * power;
  for (let lag = 1; lag <= longest; lag += 1) {
    both -= (wave[lag - 1] ?? 0) ** 2 + (wave[size - lag] ?? 0) ** 2;
    let match = 0;
    for (let index = 0; index + lag < size; index += 1) match += (wave[index] ?? 0) * (wave[index + lag] ?? 0);
    alike[lag] = both > 0 ? (2 * match) / both : 0;
  }
  // Down the first slope (a sound is always like itself), then the highest point of every stretch above zero.
  let lag = 1;
  while (lag <= longest && (alike[lag] ?? 0) > 0) lag += 1;
  const tops: number[] = [];
  let top = -1;
  for (; lag < longest; lag += 1) {
    const here = alike[lag] ?? 0;
    if (here > 0 && here >= (alike[lag - 1] ?? 0) && here >= (alike[lag + 1] ?? 0) && (top < 0 || here > (alike[top] ?? 0))) top = lag;
    if (here <= 0 && top >= 0) {
      tops.push(top);
      top = -1;
    }
  }
  if (top >= 0) tops.push(top);
  const highest = tops.reduce((most, place) => Math.max(most, alike[place] ?? 0), 0);
  const round = tops.find((place) => (alike[place] ?? 0) >= highest * 0.9);
  if (round === undefined) return null;
  const [left, here, right] = [alike[round - 1] ?? 0, alike[round] ?? 0, alike[round + 1] ?? 0];
  const bend = left - 2 * here + right;
  const shift = bend < 0 ? (0.5 * (left - right)) / bend : 0;
  const hz = rate / (round + shift);
  if (hz < LOWEST_HZ / SLACK || hz > HIGHEST_HZ * SLACK) return null;
  return { hz: Math.min(HIGHEST_HZ, Math.max(LOWEST_HZ, hz)), clarity: share01(here - 0.25 * (left - right) * shift) };
}

/** The pitch of a tonal sound: its fundamental in Hz (30..2000) and how sure that is (0..1), from the part of the sound after its attack where it is loud (McLeod's pitch method on stretches of a few thousand samples, the middle of what up to five of them say). `null` for noise, drums without a clear tone, silence. A `clarity` above about 0.8 is a pitch worth tuning to. */
export function pitchOf(samples: Float32Array, sampleRate: number): { hz: number; clarity: number } | null {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) return null;
  // Pitches up to 2 kHz need no more than 48 kHz, and at that rate a stretch of 4096 samples reaches down to 30 Hz.
  let sound = samples;
  let rate = sampleRate;
  while (rate > 50_000) {
    sound = halved(sound);
    rate /= 2;
  }
  if (!(peakOf(sound) > 0)) return null;
  // Past the attack, which is noise in most sounds: 50 ms of it, or a quarter of a sound shorter than that.
  const span = soundSpan(sound, rate);
  const from = span.from + Math.min(samplesIn(0.05, rate), (span.to - span.from) >> 2);
  const size = Math.min(LISTEN, span.to - from);
  if (size < 64) return null;
  // Up to two dozen places along the sound; of those that are loud (within 12 dB of the loudest), five.
  const room = span.to - size - from;
  const places = Math.min(24, Math.floor((room * 2) / size) + 1);
  const starts = Array.from({ length: places }, (_, place) => from + (places > 1 ? Math.round((place * room) / (places - 1)) : 0));
  const loud = starts.map((start) => {
    let sum = 0;
    for (let index = 0; index < size; index += 1) sum += (sound[start + index] ?? 0) ** 2;
    return sum;
  });
  const loudest = loud.reduce((most, sum) => Math.max(most, sum), 0);
  const kept = starts.filter((_, place) => (loud[place] ?? 0) >= loudest / 16);
  const count = Math.min(5, kept.length);
  const heard = Array.from({ length: count }, (_, pick) => pitchAt(sound, kept[count > 1 ? Math.round((pick * (kept.length - 1)) / (count - 1)) : kept.length >> 1] ?? from, size, rate));

  // The pitch is the one in the middle of what the places say. A place that says another note (more than a
  // quarter tone off), or none, counts as unclear: so a sound whose pitch wanders, as a kick's does, is no tone.
  const said = heard.flatMap((pitch) => (pitch ? [pitch.hz] : [])).sort((a, b) => a - b);
  const middle = said[said.length >> 1];
  if (middle === undefined) return null;
  const agreeing = heard.flatMap((pitch) => (pitch && Math.abs(Math.log2(pitch.hz / middle)) <= 1 / 24 ? [pitch] : []));
  const clear = heard.map((pitch) => (pitch && agreeing.includes(pitch) ? pitch.clarity : 0)).sort((a, b) => a - b);
  const clarity = clear[(clear.length - 1) >> 1] ?? 0;
  if (clarity < 0.5) return null;
  const hz = agreeing.map((pitch) => pitch.hz).sort((a, b) => a - b)[agreeing.length >> 1] ?? middle;
  return { hz, clarity };
}

/** The MIDI note number (with fractions) of a frequency, A4 = 440 Hz = 69. */
export function midiOf(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** How many semitones (with fractions) a pitch of `hz` lies above (positive) or below (negative) the nearest note called `pitchClass` (0 = C … 11 = B) in any octave: the amount to tune DOWN by to land on that note. Between −6 and 6. */
export function semitonesFrom(hz: number, pitchClass: number): number {
  if (!(hz > 0) || !Number.isFinite(hz) || !Number.isFinite(pitchClass)) return 0;
  const above = (((midiOf(hz) - pitchClass) % 12) + 12) % 12;
  return above > 6 ? above - 12 : above;
}

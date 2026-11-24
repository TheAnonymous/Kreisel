import { OPEN_HAT } from "./hat";
import { soundCalled } from "./sounds/index";

/*
 * What a Kreisel is made of. Seven rings (tracks), each with a pattern of up
 * to 32 steps per scene; a key, a chord progression and the mix. Everything
 * here is plain data, so it can be saved, shared as a link and undone.
 */

export const TRACK_KINDS = ["kick", "snare", "hat", "perc", "bass", "chord", "lead"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export const TRACK_COUNT = TRACK_KINDS.length;
export const MAX_STEPS = 32;
export const MIN_STEPS = 2;
export const SCENE_COUNT = 8;
export const MAX_CHORDS = 8;
/** Steps of one bar: the chord changes with every bar. */
export const BAR = 16;
export const PITCH_MIN = -7;
export const PITCH_MAX = 14;
export const MAX_NOTE_LENGTH = 16;

export type ScaleId = "moll" | "dur" | "dorisch" | "phrygisch" | "lydisch" | "mixolydisch" | "harmonisch";

export interface Step {
  on: boolean;
  /** 0 quiet, 1 normal, 2 accent. */
  vel: number;
  /** 0 always, 1 = 75 %, 2 = 50 %, 3 = 25 %. */
  chance: number;
  /** How many times the step strikes (1 to 4). */
  ratchet: number;
  /** Scale steps: the melody for tuned rings, the tuning (or openness) of a drum. */
  pitch: number;
  /** Steps the note is held (tuned rings). */
  len: number;
}

export interface Pattern {
  /** How many steps the ring has; the rest of `steps` waits unseen. */
  len: number;
  steps: Step[];
}

/** A ring's own sound is sound number four: the picture painted for it. */
export const OWN_SOUND = 4;
export const MAX_STROKES = 8;
export const MAX_STROKE_POINTS = 32;
/** A picture's time runs from 0 to TIME_MAX, its pitch from 0 (27.5 Hz) to HEIGHT_MAX (nine octaves up). */
export const TIME_MAX = 255;
export const HEIGHT_MAX = 65_535;

/** One stroke of the brush: a tone (or a hiss) that moves through pitch as time passes. */
export interface Stroke {
  /** 0 hums (a sine), 1 saws (a sawtooth), 2 hisses (noise around that pitch). */
  kind: number;
  /** How much paint the brush held: 0 thin and quiet, 2 thick and loud. */
  size: number;
  /** Painted from right to left: the stroke grows louder instead of running dry. */
  swell: boolean;
  /** t0, y0, t1, y1 …, with time never running backwards. */
  points: number[];
}

/** A painted sound: time from left to right, pitch from bottom to top. */
export interface Bild {
  strokes: Stroke[];
  /** Where a held note stands still until it ends (rings that play notes); `null` rings out like a struck sound. */
  hold: number | null;
}

/** The ring's built sound: a body that rings when it is struck (see body.ts). */
export const BODY_SOUND = 5;
export const BODY_KIND_COUNT = 5;
export const EXCITER_COUNT = 5;

/**
 * A Klangkörper: a thing that rings. What it is, how big, how tight and of
 * what material it is, and what sets it going where.
 */
export interface Body {
  /** 0 skin, 1 string, 2 bar, 3 tube, 4 bowl. */
  kind: number;
  /** 0..1: small to big. Big is low (on rings without notes) or full, and rings long. */
  size: number;
  /** 0..1: slack to tight. Tight is bright and short. */
  tight: number;
  /** 0..1: wood, then metal, then glass. How long it rings, and how its overtones die. */
  material: number;
  /** 0 soft mallet, 1 hard mallet, 2 plucked, 3 bowed, 4 blown. */
  exciter: number;
  /** 0..1: where it is set going, from its middle to its edge. */
  where: number;
}

/** The ring's sung sound: a voice that sings a line of text, a syllable a hit (see voice.ts). */
export const VOICE_SOUND = 6;
export const MAX_VOICE_TEXT = 80;

export interface Voice {
  /** What it sings, as typed. */
  text: string;
  /** 0..1: the room in the mouth, from small and bright to big and dark. */
  mouth: number;
  /** 0..1: how much breath is in the voice, from clear to whispered. */
  breath: number;
}

/** The number of the acid machine among a ring's sounds: the first after the fifty of the palette (see src/sounds/index.ts). */
export const ACID_SOUND = 53;

/**
 * The acid machine's own settings (see src/acid.ts). Where its filter rests
 * and how much it rings are the sound pad's two directions, as for any sound.
 */
export interface Acid {
  /** "Bite": how far the envelope opens the filter at a note, 0..1. */
  bite: number;
  /** "Duration": how slowly the filter falls shut again, 0..1. */
  decay: number;
  /** A square wave instead of a saw. */
  square: boolean;
}

export interface Track {
  /** Which sound of the ring's shelf (see sounds/index.ts), or OWN_SOUND for its picture, BODY_SOUND for its body, VOICE_SOUND for its voice. */
  sound: number;
  /** The two macros of the sound pad, 0..1. */
  x: number;
  y: number;
  level: number;
  hall: number;
  echo: number;
  /** "Drive": how hard the ring is driven into its shaper, 0..1. The sparks of the weather come on top. */
  drive: number;
  mute: boolean;
  /** The ring's own sound, once one was painted. */
  bild: Bild | null;
  /** The ring's own body, once one was built. */
  body: Body | null;
  /** The ring's own voice, once it was given a line to sing. */
  voice: Voice | null;
  /** The ring's acid machine, once it was switched on (bass and melody). */
  acid: Acid | null;
}

/** Fog, sun, clouds, rain, sparks, hail: effects painted onto the wheel. */
export const WEATHER_COUNT = 6;
export const WEATHER_MAX = 15;
/** The strongest wind: four steps a bar, either way. */
export const WIND_MAX = 16;

/** The most the ground shakes at one step of the Nachbeben. */
export const RUMBLE_MAX = 15;

export interface Scene {
  patterns: Pattern[];
  /** One chord per bar, as a degree of the scale (0 = tonic). */
  chords: number[];
  /** The Nachbeben: how much the ground shakes at each step of the kick's ring, 0..RUMBLE_MAX (always MAX_STEPS of them). */
  rumble: number[];
  /** The weather over the wheel: for each kind of weather and each ring, how much of it lies on each step, 0..WEATHER_MAX. */
  weather: number[][][];
  /** How fast each kind of weather drifts around the wheel, in quarter steps a bar (negative: against the clock). */
  wind: number[];
  /**
   * The tides: over how many bars each kind of weather swells and ebbs (0 for a weather that is simply there).
   * Absent while no weather has one.
   */
  tide?: number[];
}

export const MIN_BARS = 4;
/** 256 bars are a little under seven minutes at 150 beats a minute. */
export const MAX_BARS = 256;
/** The highest tension a bar can have. */
export const TENSION_MAX = 31;

/**
 * The piece: the ring around all rings, where one turn is the whole piece.
 * Each bar has a tension (how much is going on) and a scene. The Kreisel
 * arranges by it: rings come in as the tension rises, the sound opens up,
 * and before a steep rise it takes a run-up.
 */
export interface Piece {
  /** Play by the piece instead of looping the scene on the table. */
  on: boolean;
  /** One number per bar, 0..TENSION_MAX. Its length is the piece's length in bars. */
  tension: number[];
  /** The scene each bar plays. */
  scenes: number[];
  /** The rings in the order they come in as the tension rises. */
  order: number[];
  /**
   * "Ohne Kick": the bars in which the kick and its Nachbeben stay out, whatever the tension: a break.
   * One entry a bar. A piece without such bars does not have the list at all, and is what a piece always was.
   */
  noKick?: boolean[];
  /**
   * The roster ("Roster"): who plays where, whatever the tension. A list a ring (the kick first), one entry a bar:
   * 1 the ring plays there, 2 it rests there, 0 the tension decides. A ring with nothing laid has an empty list, and
   * a piece with nothing laid does not have the field at all. The kick's rests are not here: they are the bars
   * "ohne Kick" above, which came first and mean a break (see piece.ts).
   */
  roster?: number[][];
  /** The build-up before every drop that has none of its own. Absent while it is the small one (BUILD_SMALL). */
  build?: Build;
  /**
   * The drops that have a build-up of their own: the bar the drop lands in, and what leads up to it. Absent while
   * none has. An entry hangs on its bar: where no drop lands (any more), it says nothing.
   */
  drops?: { bar: number; build: Build }[];
  /** "Abwechslung": small changes by themselves at the end of every eight bars. Absent while off. */
  vary?: boolean;
  /** What the tension moves beyond who plays. Absent while it moves nothing more. */
  sway?: Sway;
  /** What else happens by itself where a phrase of eight bars ends and the next begins. Absent while nothing does. */
  ends?: Ends;
  /**
   * Effect marks: a bar in which one or more of the five live effects play by themselves, once. `fx` has a bit an
   * effect, in the order of MARK_NAMES. Sorted by bar, a bar at most once; absent while there is none.
   */
  marks?: { bar: number; fx: number }[];
}

/** What happens by itself at the ends of the phrases, beside the fills. */
export interface Ends {
  /** The last kick of every phrase is left out. */
  kick: boolean;
  /** A crash on the one every 16 or 32 bars (0 for none). */
  crash: number;
  /** A cymbal played backwards swells into the beginning of every phrase. */
  swell: boolean;
}

/**
 * The live effects that can be laid on a bar of the piece, in the order of their bits, as the page names them. Each
 * has its own stretch of the bar: Dumpf and Dünn the whole of it, Stotter its second half, Echo and Pause its last beat.
 */
export const MARK_NAMES = ["Dull", "Thin", "Stutter", "Echo", "Pause"] as const;
export const MARK = { dumpf: 1, duenn: 2, stotter: 4, echo: 8, pause: 16 } as const;
export const MARK_ALL = 31;

/**
 * What the tension moves beyond who plays and how open the sum is ("What the tension moves"). Each is 0 for off,
 * 1 for gently ("sanft") or 2 for clearly ("deutlich"). With all of it off the line does what it always did.
 */
export interface Sway {
  /** The hi-hat opens: it rings longer the higher the tension. */
  hat: number;
  /** Bass, chords and melody get brighter with the tension, from what their ring is set to; an acid machine's bite goes along. */
  bright: number;
  /** The kick grows: shorter and thinner where little is going on, whole at the top. */
  kick: number;
  /** Density: where little is going on the quiet hits fall away. */
  dense: number;
  /** Towards the top every ring is driven a little harder (its Zerre). */
  drive: number;
  /** The less tension, the more hall on everything but kick and bass. */
  room: number;
}

/** The parts of a `Sway`, in the order the page and a link have them. */
export const SWAY_PARTS = ["hat", "bright", "kick", "dense", "drive", "room"] as const;

/**
 * A build-up: what the piece does by itself in the bars before a drop, and how the drop comes. A drop is a bar much
 * higher than the one before, or the bar in which the kick comes back from a break (see piece.ts). A build-up is a
 * kit: each of its parts can be had without the others.
 */
export interface Build {
  /** How many bars it runs: 1, 2, 4 or 8. 0 is no build-up at all: the drop just comes, without a crash. */
  bars: number;
  /** The riser: 0 none, 1 noise that rises, 2 noise and a tone that climbs with it. */
  riser: number;
  /** A roll on the snare's ring, denser and louder all the way to the drop. */
  roll: boolean;
  /** The lows go: the bass thins out and the kick gets weaker. Both are back with the drop. */
  lows: boolean;
  /** A cloud of hall that grows, and is gone with the drop. */
  wash: boolean;
  /** It gets a little quieter, so that the drop is louder than what led up to it. */
  dip: boolean;
  /** The kick and its Nachbeben stay out for the last bar. */
  kick: boolean;
  /** The hi-hat stays out for the last bar. */
  hat: boolean;
  /** The gap right before the drop, in beats: 0 for none, 1, 2 or 4 (a whole bar). Nothing plays in it; hall and echo ring out. */
  gap: number;
  /** A late drop: on the one only kick and bass come, everything else a beat later. */
  late: boolean;
}

/** How long a build-up can be, in bars (0: none at all), and how long its gap, in beats. */
export const BUILD_BARS = [0, 1, 2, 4, 8] as const;
export const BUILD_GAPS = [0, 1, 2, 4] as const;

const NO_PARTS = { riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false };
/** No build-up: the drop just comes. */
export const BUILD_NONE: Readonly<Build> = Object.freeze({ ...NO_PARTS, bars: 0 });
/** The small one, which every drop has unless told otherwise: a bar of rising noise, and a crash. */
export const BUILD_SMALL: Readonly<Build> = Object.freeze({ ...NO_PARTS, bars: 1, riser: 1 });
/** The middle one: four bars of riser and roll while the lows go. */
export const BUILD_MEDIUM: Readonly<Build> = Object.freeze({ ...NO_PARTS, bars: 4, riser: 1, roll: true, lows: true });
/** The big one: eight bars with everything, and a beat of nothing before the drop. */
export const BUILD_BIG: Readonly<Build> = Object.freeze({ ...NO_PARTS, bars: 8, riser: 2, roll: true, lows: true, wash: true, dip: true, gap: 1 });

/** The sizes a build-up comes in ready-made. */
export const BUILD_SIZES = { keiner: BUILD_NONE, klein: BUILD_SMALL, mittel: BUILD_MEDIUM, gross: BUILD_BIG } as const;
export type BuildSize = keyof typeof BUILD_SIZES;

export const MAX_TURNS = 12;
export const MAX_NAME = 16;

/** One turn of a Kreisel that goes from hand to hand: who took it, and the Kreisel as they passed it on. */
export interface Turn {
  name: string;
  /** The project after the turn, packed as in a link (without its own history). */
  state: unknown;
}

/**
 * "Reihum": the Kreisel travels as a link, everyone adds a turn, and every
 * turn stays in the link to be listened to again.
 */
export interface Relay {
  /** 0 anything goes, 1 one ring a turn, 2 "Telephone": one ring a turn, hearing only the ring before. */
  rule: number;
  /** Stille Post has been revealed: everyone sees and hears everything. */
  open: boolean;
  turns: Turn[];
}

/**
 * The manner a Kreisel is built in: what its dice throw, what a new piece is
 * shaped like, which values its controls go back to, which sounds its
 * palettes show first (src/sounds/techno.ts), and whether its hi-hat is one
 * voice (src/hat.ts). "frei" is the Kreisel as it always was; "techno" is
 * hard and acid techno.
 */
export const STYLE_IDS = ["frei", "techno"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface Project {
  v: 1;
  style: StyleId;
  bpm: number;
  /** 0..1 */
  swing: number;
  /** 0 = C … 11 = H */
  root: number;
  scale: ScaleId;
  /** How much the kick pushes bass, chords and melody down, 0..1. */
  pump: number;
  /** "Pressure": how hard the sum of everything is pressed against the ceiling before the master, 0..1. */
  pressure: number;
  /** How hard the kick is driven before anything else hears it, 0..1: from clean to clipped flat. */
  hard: number;
  /** The Nachbeben's character, both 0..1: from deep and clean to dirty, from one smooth swell to rolling sixteenths. */
  dirt: number;
  roll: number;
  volume: number;
  tracks: Track[];
  scenes: (Scene | null)[];
  /** The scene on the table. */
  scene: number;
  /** Play the row instead of looping the scene on the table. */
  chain: boolean;
  /**
   * "Ausrichten": every eight bars all rings begin together again, so that rings of unequal length rub against one
   * another within a phrase and are resolved where the next begins. Absent while they run free.
   */
  align?: boolean;
  /** The row ("Row"): scenes in the order they play, one entry a round (a scene once through its chords). See order.ts. */
  order: number[];
  piece: Piece;
  /** The turns of a Kreisel that is passed around; `null` for one that is not. */
  relay: Relay | null;
}

export interface TrackInfo {
  name: string;
  /** Whether the ring plays notes of the key (bass, chords, melody). */
  melodic: boolean;
  xLabel: string;
  yLabel: string;
  /** What moving a step outwards does. */
  pitchLabel: string;
  color: string;
  /** The pitch a picture is painted at: played notes move it from here. 0 for drums, whose pictures are meant as painted. */
  refHz: number;
}

export const TRACK_INFO: Record<TrackKind, TrackInfo> = {
  kick: { name: "Kick", melodic: false, xLabel: "Tone", yLabel: "Length", pitchLabel: "Tuning", color: "#e4572e", refHz: 0 },
  snare: { name: "Snare", melodic: false, xLabel: "Tone", yLabel: "Length", pitchLabel: "Tuning", color: "#f29a2e", refHz: 0 },
  hat: { name: "Hi-Hat", melodic: false, xLabel: "Brightness", yLabel: "Length", pitchLabel: "Openness", color: "#e9bd24", refHz: 0 },
  perc: { name: "Drum", melodic: false, xLabel: "Tone", yLabel: "Length", pitchLabel: "Pitch", color: "#5fb85a", refHz: 110 },
  bass: { name: "Bass", melodic: true, xLabel: "Brightness", yLabel: "Decay", pitchLabel: "Pitch", color: "#27a79c", refHz: 55 },
  chord: { name: "Chords", melodic: true, xLabel: "Brightness", yLabel: "Decay", pitchLabel: "Register", color: "#3d7edb", refHz: 220 },
  lead: { name: "Melody", melodic: true, xLabel: "Brightness", yLabel: "Decay", pitchLabel: "Pitch", color: "#a45de0", refHz: 440 },
};

export const trackInfo = (index: number): TrackInfo => TRACK_INFO[TRACK_KINDS[index] ?? "kick"];

export const SCENE_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function emptyStep(): Step {
  return { on: false, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 };
}

export function emptyPattern(len = 16): Pattern {
  return { len, steps: Array.from({ length: MAX_STEPS }, emptyStep) };
}

export function emptyRumble(): number[] {
  return Array.from({ length: MAX_STEPS }, () => 0);
}

export function emptyWeather(): number[][][] {
  return Array.from({ length: WEATHER_COUNT }, () => Array.from({ length: TRACK_COUNT }, () => Array.from({ length: MAX_STEPS }, () => 0)));
}

export function emptyWind(): number[] {
  return Array.from({ length: WEATHER_COUNT }, () => 0);
}

export function emptyScene(): Scene {
  return { patterns: Array.from({ length: TRACK_COUNT }, () => emptyPattern()), chords: [0, 5, 2, 6], rumble: emptyRumble(), weather: emptyWeather(), wind: emptyWind() };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Where `value` lands on a circle of `length` places: 0 up to, but not including, `length`, also for values below 0. */
export const wrap = (value: number, length: number): number => ((value % length) + length) % length;

/** The step at `index` of a pattern (the array always holds MAX_STEPS). */
export function stepAt(pattern: Pattern, index: number): Step {
  const step = pattern.steps[wrap(index, MAX_STEPS)];
  if (!step) throw new Error("pattern without steps");
  return step;
}

type Note = number | [index: number, pitch?: number, len?: number, vel?: number, chance?: number, ratchet?: number];

function pattern(len: number, notes: readonly Note[]): Pattern {
  const result = emptyPattern(len);
  for (const note of notes) {
    const [index, pitch = 0, noteLen = 1, vel = 1, chance = 0, ratchet = 1] = typeof note === "number" ? [note] : note;
    Object.assign(stepAt(result, index), { on: true, pitch, len: noteLen, vel, chance, ratchet });
  }
  return result;
}

/** Chords first, then hi-hat, bass, kick, snare, melody and the tuned drum last: how a piece usually builds. */
export const FIRST_ORDER = [5, 2, 4, 0, 1, 6, 3] as const;

/** The piece a project starts with: 32 bars that build, break and build higher. It waits switched off. */
export function firstPiece(scene = 0): Piece {
  const shape = [6, 7, 8, 9, 12, 14, 16, 18, 24, 24, 25, 25, 26, 26, 27, 27, 9, 9, 11, 14, 31, 31, 31, 31, 31, 31, 30, 30, 20, 15, 10, 6];
  return { on: false, tension: shape, scenes: shape.map(() => scene), order: [...FIRST_ORDER] };
}

/** The Werks-Kreisel: A minor, four chords, one ring of twelve against the sixteens. */
export function factoryProject(): Project {
  const scene: Scene = {
    rumble: emptyRumble(),
    weather: emptyWeather(),
    wind: emptyWind(),
    chords: [0, 5, 2, 6],
    patterns: [
      pattern(16, [[0, 0, 1, 2], 4, [8, 0, 1, 2], 12]),
      pattern(16, [4, [12, 0, 1, 2]]),
      pattern(16, [[0, 0, 1, 0], 2, [4, 0, 1, 0], 6, [8, 0, 1, 0], 10, [12, 0, 1, 0], [14, 3, 1, 1]]),
      pattern(12, [[0, 0, 1, 1], [3, 2, 1, 0], [7, 4, 1, 1], [10, 2, 1, 0, 2]]),
      pattern(16, [[0, 0, 2, 2], [3, 0], [6, 7], [8, 0, 2], [11, 0, 1, 0], [14, 4]]),
      pattern(16, [[0, 0, 3, 2], [6, 0, 2], [11, 1, 3]]),
      pattern(16, [[0, 4, 2], [3, 2], [6, 4], [8, 7, 2, 2], [10, 6], [12, 4, 2], [14, 2, 1, 0]]),
    ],
  };
  return {
    v: 1,
    style: "frei",
    bpm: 112,
    swing: 0.18,
    root: 9,
    scale: "moll",
    pump: 0.3,
    pressure: 0,
    hard: 0,
    dirt: 0.35,
    roll: 0.2,
    volume: 0.8,
    tracks: [
      { sound: 0, x: 0.5, y: 0.5, level: 0.85, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.78, hall: 0.25, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 0, x: 0.5, y: 0.5, level: 0.7, hall: 0.05, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.6, hall: 0.2, echo: 0.25, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 3, x: 0.45, y: 0.4, level: 0.7, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 2, x: 0.45, y: 0.5, level: 0.7, hall: 0.3, echo: 0.15, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 0, x: 0.55, y: 0.45, level: 0.72, hall: 0.3, echo: 0.4, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    order: [0],
    piece: firstPiece(),
    relay: null,
  };
}

/** In techno the kick is there first, then hi-hat and clap around it, the tuned drum, the acid line, and stab and melody last. */
export const TECHNO_ORDER = [0, 2, 1, 3, 4, 5, 6] as const;

/**
 * The plain techno form, which an empty techno Kreisel starts with: sixteen
 * bars that build from the kick, thirty-two at full height, a break of
 * sixteen without the kick (the acid line and the drums around it play on
 * and lift, and the last eight are a big build-up), thirty-two at the top,
 * sixteen that take it apart again. It waits switched off.
 */
export function technoPiece(scene = 0): Piece {
  const climb = (from: number, to: number, bars: number): number[] => Array.from({ length: bars }, (_, bar) => Math.round(from + ((to - from) * bar) / (bars - 1)));
  const hold = (level: number, bars: number): number[] => Array.from({ length: bars }, () => level);
  const shape = [...climb(3, 17, 16), ...hold(27, 16), ...hold(31, 16), ...hold(18, 8), ...climb(18, 22, 8), ...hold(31, 32), ...climb(24, 3, 16)];
  // Its first drop (bar 17) is a small one; the one out of the break (bar 65) is the big one of the piece.
  return { on: false, tension: shape, scenes: shape.map(() => scene), order: [...TECHNO_ORDER], noKick: shape.map((_, bar) => bar >= 48 && bar < 64), drops: [{ bar: 64, build: { ...BUILD_BIG } }] };
}

/**
 * The order the techno Kreisel's own piece brings its rings in by: kick, hi-hat, the tuned drum and the acid line make
 * the intro; the clap is kept for the first drop, stab and melody for later.
 */
export const MASTER_ORDER = [0, 2, 3, 4, 1, 5, 6] as const;

/**
 * The piece the techno Kreisel comes with: a track of 160 bars that works with tension by every means a piece has,
 * each where it has a reason. It is meant to be looked at and taken apart. It waits switched off.
 *
 * The arc, phrase by phrase (eight bars each; bars counted from 1 here, as the page counts them):
 *
 * - 1–32, the intro: the kick alone, small and muffled; then the hi-hat, only its open hits; the tuned drum on its
 *   ring of twelve; the acid line, quiet and without its quiet notes. A ring a phrase. Two bars of roll and riser lead to
 * - 33–64, the first full section, which the clap arrives with. Sixteen bars in which nothing changes; then the tuned
 *   drum goes and the stab comes in its place; then the hi-hat is taken away, eight bars before
 * - 65–72, the short break: the kick goes, and the hi-hat is back in its place. Clap and acid line play on; four bars
 *   of build-up, the last without the hi-hat, and the drop comes late.
 * - 73–104, the second full section, higher than the first, with the stab (and the melody) and still without the
 *   tuned drum; a small step up at its half; then stripped to kick, hi-hat, clap and acid line; then the clap goes
 *   too and the line sinks.
 * - 105–120, the long break, the lowest point: kick and bass go first, only the stab and the open hi-hat are left.
 *   Then the acid line fades in again under the big build-up, eight bars that end in half a bar of nothing.
 * - 121–128, the anti-drop: only kick and acid line, dry. Two bars of roll, the last without the kick, lead to
 * - 129–144, the top: everything, at the highest tension of the piece, which the line reaches nowhere else. Only
 *   here do all rings play together: the tuned drum is back after eighty bars.
 * - 145–160, the outro: the line alone takes the piece apart, in the order the rings came, down to the kick, and the
 *   ring closes into its first bar.
 *
 * Who plays is laid only where the line could not say it (the roster): the line is free for what it moves beside.
 * All six of those are on: the hi-hat opens, the acid line gets brighter, the kick grows, the quiet hits fall away
 * below the full sections, a little more Zerre towards the top, a little more hall towards the bottom. The ends of
 * the phrases have fills, a crash every sixteen bars and a cymbal backwards; seven of them have an effect laid on
 * them, each of the five at least once. No two of the four drops have the same build-up.
 */
export function masterPiece(scene = 0): Piece {
  const hold = (level: number, bars = 8): number[] => Array.from({ length: bars }, () => level);
  const tension = [
    // The intro: a ring a phrase, the line climbing a step every two bars, more slowly once the acid line is there.
    4, 4, 4, 4, 5, 5, 5, 5,
    6, 6, 7, 7, 8, 8, 9, 9,
    10, 10, 11, 11, 12, 12, 13, 13,
    14, 14, 14, 14, 15, 15, 15, 15,
    // The first full section, a step up at its half.
    ...hold(24, 16), ...hold(25, 16),
    // The short break lifts a little towards the drop.
    18, 18, 18, 18, 19, 19, 20, 20,
    // The second full section, higher; then the cool-down.
    ...hold(27, 12), ...hold(28, 12),
    26, 25, 24, 23, 22, 21, 20, 19,
    // The long break: at the bottom, then climbing under the build-up.
    11, 11, 11, 11, 12, 12, 12, 12,
    14, 15, 16, 17, 18, 19, 20, 20,
    // The anti-drop holds back; the top is the top.
    ...hold(22), ...hold(TENSION_MAX, 16),
    // The outro: the line lets the rings go one after another.
    26, 24, 22, 21, 19, 17, 16, 14,
    13, 12, 10, 9, 7, 6, 4, 4,
  ];
  const bars = tension.length;
  // Who plays against what the line says, as stretches of bars (counted from 0, up to but not including `to`).
  const laid = (stretches: readonly (readonly [from: number, to: number, state: 1 | 2])[]): number[] => {
    const list = Array.from({ length: bars }, () => 0);
    for (const [from, to, state] of stretches) for (let bar = from; bar < to; bar += 1) list[bar] = state;
    return list;
  };
  const roster = [
    [],
    // The clap rests through the cool-down and the anti-drop; its last two bars there are the roll's.
    laid([[96, 104, 2], [120, 126, 2]]),
    // The hi-hat is taken away before the short break, and rests through the anti-drop.
    laid([[56, 64, 2], [120, 128, 2]]),
    // The tuned drum makes room for the stab at the half of the first full section, and is back only at the top.
    laid([[48, 128, 2]]),
    [],
    // The stab is kept back for the half of the first full section, rests where the second is stripped, and is what is left in the long break.
    laid([[32, 48, 2], [88, 104, 2], [104, 120, 1], [120, 128, 2]]),
    // The melody goes where the stab goes when the second full section is stripped.
    laid([[88, 104, 2]]),
  ];
  const parts = { riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false };
  return {
    on: false,
    tension,
    scenes: tension.map(() => scene),
    order: [...MASTER_ORDER],
    noKick: tension.map((_, bar) => (bar >= 64 && bar < 72) || (bar >= 104 && bar < 120)),
    roster,
    drops: [
      // Into the first full section: two bars of riser and roll.
      { bar: 32, build: { ...parts, bars: 2, riser: 1, roll: true } },
      // Out of the short break: four bars while the lows go, the last without the hi-hat, and the drop comes late.
      { bar: 72, build: { ...parts, bars: 4, riser: 1, roll: true, lows: true, hat: true, late: true } },
      // Out of the long break: the big one, with half a bar of nothing before the drop.
      { bar: 120, build: { ...BUILD_BIG, gap: 2 } },
      // To the top: two bars of riser and roll again, the last without the kick.
      { bar: 128, build: { ...parts, bars: 2, riser: 1, roll: true, kick: true } },
    ],
    vary: true,
    sway: { hat: 2, bright: 2, kick: 1, dense: 2, drive: 1, room: 1 },
    ends: { kick: false, crash: 16, swell: true },
    marks: [
      // A beat of nothing before the tuned drum comes.
      { bar: 15, fx: MARK.pause },
      // A stutter where the tuned drum hands over to the stab, an echo as the hi-hat leaves.
      { bar: 47, fx: MARK.stotter },
      { bar: 55, fx: MARK.echo },
      // A bar without lows, so that the stripped phrase hits harder; a beat of nothing before the cool-down.
      { bar: 87, fx: MARK.duenn },
      { bar: 95, fx: MARK.pause },
      // The long break closes all the way before the acid line comes back.
      { bar: 111, fx: MARK.dumpf },
      // The top's last beat flies into the echo.
      { bar: 143, fx: MARK.echo },
    ],
  };
}

/**
 * The techno Kreisel, which a first visit starts with: 150 beats a minute and
 * no swing, G Phrygian over one chord, the kick on every beat with the ground
 * shaking between, a drum machine's hi-hat that is open on the off-beats (and
 * cut off by the closed hit after it, see src/hat.ts), many hands clapping on
 * two and four, a low drum on a ring of twelve, and an acid machine whose line
 * slides three times. Two kinds of weather lie on it with tides of their own,
 * and its piece is a track that works with tension (see `masterPiece`).
 */
export function technoProject(): Project {
  // The pull of the loop itself: rain (echo) where the stab strikes, sun (brighter) on the hi-hat's open hits and what follows them.
  const weather = emptyWeather();
  for (const step of [4, 5, 6, 7, 12, 13, 14, 15]) (weather[3]?.[5] ?? [])[step] = 10;
  for (const step of [2, 3, 6, 7, 10, 11, 14, 15]) (weather[1]?.[2] ?? [])[step] = 10;
  const scene: Scene = {
    // Between two kicks the ground swells and is gone before the next: the Nachbeben's off-beat shape for a kick on every beat.
    rumble: Array.from({ length: MAX_STEPS }, (_, step) => (step < 16 ? ([0, 12, 15, 12][step % 4] ?? 0) : 0)),
    weather,
    wind: emptyWind(),
    // Each swells and ebbs in a length of its own, against the phrases of eight bars. They meet at nothing every sixty bars.
    tide: [0, 20, 0, 12, 0, 0],
    chords: [0],
    patterns: [
      pattern(16, [0, 4, 8, 12]),
      pattern(16, [[4, 0, 1, 2], [12, 0, 1, 2]]),
      // Sixteenths that leave the kick alone; the off-beats are open and loud, and the closed hit after each cuts it off.
      pattern(16, [[1, 0, 1, 0], [2, OPEN_HAT, 1, 2], [3, 0, 1, 0], [5, 0, 1, 0], [6, OPEN_HAT, 1, 2], [7, 0, 1, 0], [9, 0, 1, 0], [10, OPEN_HAT, 1, 2], [11, 0, 1, 0], [13, 0, 1, 0], [14, OPEN_HAT, 1, 2], [15, 0, 1, 0, 0, 2]]),
      pattern(12, [[3, -3], [7, 0, 1, 0], [10, -3, 1, 1, 1]]),
      // An octave above the ground the Nachbeben shakes on: the root (7), the small step above it (8) and the octave (14).
      // A note held into the next one (two steps long here) slides into it: the octave down to the root, the root up
      // the small step, and that step back to the root over the bar line.
      pattern(16, [[0, 7], [1, 7, 1, 0], [3, 14, 2, 2], [4, 7], [6, 7, 2], [7, 8, 1, 2], [9, 7], [10, 7, 1, 0], [12, 14, 1, 2], [13, 14], [15, 8, 2]]),
      pattern(16, [[6, 0, 1, 2], [13, 0, 1, 0]]),
      emptyPattern(16),
    ],
  };
  return {
    v: 1,
    style: "techno",
    bpm: 150,
    swing: 0,
    root: 7,
    scale: "phrygisch",
    pump: 0.55,
    pressure: 0.35,
    // The techno Kreisel's kick is a hard one: its body stands about twice as long as the clean kick's.
    hard: 0.55,
    dirt: 0.45,
    roll: 0.2,
    volume: 0.8,
    tracks: [
      // The hard kick, tuned down to the root (49 Hz). What makes a kick hard is its own; the rings after it are driven a little.
      { sound: 1, x: 0.3, y: 0.55, level: 0.9, hall: 0, echo: 0, drive: 0, mute: false, bild: null, body: null, voice: null, acid: null },
      // Clap and hi-hat come from the techno group of their palettes (src/sounds/techno.ts): claps in layers, and the
      // six square waves of a drum machine's cymbal.
      { sound: soundCalled(1, "Crowd"), x: 0.5, y: 0.35, level: 0.7, hall: 0.12, echo: 0, drive: 0.25, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: soundCalled(2, "Machine"), x: 0.5, y: 0.5, level: 0.62, hall: 0.03, echo: 0, drive: 0.15, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 0, x: 0.3, y: 0.45, level: 0.55, hall: 0.1, echo: 0.15, drive: 0.3, mute: false, bild: null, body: null, voice: null, acid: null },
      // The acid machine: its filter less than half open and ringing, a saw that bites.
      { sound: ACID_SOUND, x: 0.42, y: 0.68, level: 0.72, hall: 0, echo: 0.12, drive: 0.4, mute: false, bild: null, body: null, voice: null, acid: { bite: 0.6, decay: 0.35, square: false } },
      { sound: 1, x: 0.55, y: 0.3, level: 0.5, hall: 0.25, echo: 0.3, drive: 0.35, mute: false, bild: null, body: null, voice: null, acid: null },
      { sound: 3, x: 0.55, y: 0.4, level: 0.6, hall: 0.1, echo: 0.3, drive: 0.3, mute: false, bild: null, body: null, voice: null, acid: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    order: [0],
    piece: masterPiece(),
    relay: null,
  };
}

/** What a Kreisel of a style starts as, and what its controls go back to. */
export const startProject = (style: StyleId): Project => (style === "techno" ? technoProject() : factoryProject());

/** A scene with nothing on its rings: over one chord in techno, over four otherwise. */
export function emptySceneFor(style: StyleId): Scene {
  return style === "techno" ? { ...emptyScene(), chords: [0] } : emptyScene();
}

/** The scene on the table (there is always one). */
export function currentScene(project: Project): Scene {
  const scene = project.scenes[project.scene] ?? project.scenes.find((candidate) => candidate !== null);
  if (!scene) throw new Error("project without scenes");
  return scene;
}

export function patternOf(project: Project, track: number): Pattern {
  const found = currentScene(project).patterns[track];
  if (!found) throw new Error("scene without that ring");
  return found;
}

export function trackOf(project: Project, track: number): Track {
  const found = project.tracks[track];
  if (!found) throw new Error("project without that ring");
  return found;
}

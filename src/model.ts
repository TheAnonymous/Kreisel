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

export interface Track {
  /** Which of the ring's four sounds, OWN_SOUND for its picture or BODY_SOUND for its body. */
  sound: number;
  /** The two macros of the sound pad, 0..1. */
  x: number;
  y: number;
  level: number;
  hall: number;
  echo: number;
  mute: boolean;
  /** The ring's own sound, once one was painted. */
  bild: Bild | null;
  /** The ring's own body, once one was built. */
  body: Body | null;
}

export interface Scene {
  patterns: Pattern[];
  /** One chord per bar, as a degree of the scale (0 = tonic). */
  chords: number[];
}

export const MIN_BARS = 4;
export const MAX_BARS = 128;
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
}

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
  /** 0 anything goes, 1 one ring a turn, 2 "Stille Post": one ring a turn, hearing only the ring before. */
  rule: number;
  /** Stille Post has been revealed: everyone sees and hears everything. */
  open: boolean;
  turns: Turn[];
}

export interface Project {
  v: 1;
  bpm: number;
  /** 0..1 */
  swing: number;
  /** 0 = C … 11 = H */
  root: number;
  scale: ScaleId;
  /** How much the kick pushes bass, chords and melody down, 0..1. */
  pump: number;
  volume: number;
  tracks: Track[];
  scenes: (Scene | null)[];
  /** The scene on the table. */
  scene: number;
  /** Play the filled scenes one after another. */
  chain: boolean;
  /** How often each scene plays its chords in the chain. */
  repeats: number;
  piece: Piece;
  /** The turns of a Kreisel that is passed around; `null` for one that is not. */
  relay: Relay | null;
}

export interface TrackInfo {
  name: string;
  /** Whether the ring plays notes of the key (bass, chords, melody). */
  melodic: boolean;
  sounds: readonly [string, string, string, string];
  xLabel: string;
  yLabel: string;
  /** What moving a step outwards does. */
  pitchLabel: string;
  color: string;
  /** The pitch a picture is painted at: played notes move it from here. 0 for drums, whose pictures are meant as painted. */
  refHz: number;
}

export const TRACK_INFO: Record<TrackKind, TrackInfo> = {
  kick: { name: "Kick", melodic: false, sounds: ["Rund", "Hart", "Tief", "Staub"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#e4572e", refHz: 0 },
  snare: { name: "Snare", melodic: false, sounds: ["Snare", "Klatsch", "Rand", "Schnipp"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Stimmung", color: "#f29a2e", refHz: 0 },
  hat: { name: "Hi-Hat", melodic: false, sounds: ["Seide", "Blech", "Shaker", "Zisch"], xLabel: "Helligkeit", yLabel: "Länge", pitchLabel: "Offenheit", color: "#e9bd24", refHz: 0 },
  perc: { name: "Trommel", melodic: false, sounds: ["Tom", "Conga", "Kuhglocke", "Holz"], xLabel: "Ton", yLabel: "Länge", pitchLabel: "Tonhöhe", color: "#5fb85a", refHz: 110 },
  bass: { name: "Bass", melodic: true, sounds: ["Sub", "Säge", "Acid", "Gummi"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#27a79c", refHz: 55 },
  chord: { name: "Akkorde", melodic: true, sounds: ["Fläche", "Stab", "E-Piano", "Orgel"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Lage", color: "#3d7edb", refHz: 220 },
  lead: { name: "Melodie", melodic: true, sounds: ["Zupf", "Glocke", "Pfeife", "Säge"], xLabel: "Helligkeit", yLabel: "Ausklang", pitchLabel: "Tonhöhe", color: "#a45de0", refHz: 440 },
};

export const trackInfo = (index: number): TrackInfo => TRACK_INFO[TRACK_KINDS[index] ?? "kick"];

export const SCENE_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function emptyStep(): Step {
  return { on: false, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 };
}

export function emptyPattern(len = 16): Pattern {
  return { len, steps: Array.from({ length: MAX_STEPS }, emptyStep) };
}

export function emptyScene(): Scene {
  return { patterns: Array.from({ length: TRACK_COUNT }, () => emptyPattern()), chords: [0, 5, 2, 6] };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The step at `index` of a pattern (the array always holds MAX_STEPS). */
export function stepAt(pattern: Pattern, index: number): Step {
  const step = pattern.steps[((index % MAX_STEPS) + MAX_STEPS) % MAX_STEPS];
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

/** The groove a first visit starts with: A minor, four chords, one ring of twelve against the sixteens. */
export function factoryProject(): Project {
  const scene: Scene = {
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
    bpm: 112,
    swing: 0.18,
    root: 9,
    scale: "moll",
    pump: 0.3,
    volume: 0.8,
    tracks: [
      { sound: 0, x: 0.5, y: 0.5, level: 0.85, hall: 0, echo: 0, mute: false, bild: null, body: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.78, hall: 0.25, echo: 0, mute: false, bild: null, body: null },
      { sound: 0, x: 0.5, y: 0.5, level: 0.7, hall: 0.05, echo: 0, mute: false, bild: null, body: null },
      { sound: 1, x: 0.5, y: 0.5, level: 0.6, hall: 0.2, echo: 0.25, mute: false, bild: null, body: null },
      { sound: 3, x: 0.45, y: 0.4, level: 0.7, hall: 0, echo: 0, mute: false, bild: null, body: null },
      { sound: 2, x: 0.45, y: 0.5, level: 0.7, hall: 0.3, echo: 0.15, mute: false, bild: null, body: null },
      { sound: 0, x: 0.55, y: 0.45, level: 0.72, hall: 0.3, echo: 0.4, mute: false, bild: null, body: null },
    ],
    scenes: [scene, null, null, null, null, null, null, null],
    scene: 0,
    chain: false,
    repeats: 1,
    piece: firstPiece(),
    relay: null,
  };
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

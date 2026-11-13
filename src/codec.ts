import { clamp, emptyStep, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MIN_STEPS, PITCH_MAX, PITCH_MIN, SCENE_COUNT, TRACK_COUNT, type Pattern, type Project, type Scene, type ScaleId, type Step, type Track } from "./model";
import { SCALE_IDS } from "./music";

/*
 * A Kreisel as text: small enough for a link. Steps are packed into one
 * number each, the whole thing is JSON, squeezed with the browser's own
 * deflate and written in URL-safe base64. Whatever comes back in is checked
 * and clamped, because links come from anywhere.
 */

/** on | vel << 1 | chance << 3 | (ratchet − 1) << 5 | (len − 1) << 7 | (pitch − PITCH_MIN) << 11 */
export function packStep(step: Step): number {
  if (!step.on) return 0;
  return 1 | (step.vel << 1) | (step.chance << 3) | ((step.ratchet - 1) << 5) | ((step.len - 1) << 7) | ((step.pitch - PITCH_MIN) << 11);
}

export function unpackStep(value: number): Step {
  if (!Number.isInteger(value) || value <= 0 || (value & 1) === 0) return emptyStep();
  return {
    on: true,
    vel: clamp((value >> 1) & 3, 0, 2),
    chance: (value >> 3) & 3,
    ratchet: ((value >> 5) & 3) + 1,
    len: clamp(((value >> 7) & 15) + 1, 1, MAX_NOTE_LENGTH),
    pitch: clamp(((value >> 11) & 31) + PITCH_MIN, PITCH_MIN, PITCH_MAX),
  };
}

interface Packed {
  v: 1;
  b: number;
  s: number;
  r: number;
  m: string;
  p: number;
  o: number;
  t: number[][];
  c: ({ h: number[]; p: number[][] } | 0)[];
  i: number;
  k: number;
  n: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

export function pack(project: Project): Packed {
  return {
    v: 1,
    b: project.bpm,
    s: round(project.swing),
    r: project.root,
    m: project.scale,
    p: round(project.pump),
    o: round(project.volume),
    t: project.tracks.map((track) => [track.sound, round(track.x), round(track.y), round(track.level), round(track.hall), round(track.echo), track.mute ? 1 : 0]),
    c: project.scenes.map((scene) => {
      if (!scene) return 0;
      return {
        h: scene.chords,
        p: scene.patterns.map((pattern) => {
          const steps = pattern.steps.map(packStep);
          while (steps.length > 0 && steps[steps.length - 1] === 0) steps.pop();
          return [pattern.len, ...steps];
        }),
      };
    }),
    i: project.scene,
    k: project.chain ? 1 : 0,
    n: project.repeats,
  };
}

const number = (value: unknown, low: number, high: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, low, high) : fallback;

const integer = (value: unknown, low: number, high: number, fallback: number): number => Math.round(number(value, low, high, fallback));

function unpackPattern(value: unknown): Pattern {
  const list = Array.isArray(value) ? value : [];
  const steps = Array.from({ length: MAX_STEPS }, (_, index) => unpackStep(Number(list[index + 1] ?? 0)));
  return { len: integer(list[0], MIN_STEPS, MAX_STEPS, 16), steps };
}

function unpackScene(value: unknown): Scene | null {
  if (typeof value !== "object" || value === null) return null;
  const { h, p } = value as { h?: unknown; p?: unknown };
  const chords = (Array.isArray(h) ? h : []).slice(0, MAX_CHORDS).map((chord) => integer(chord, 0, 6, 0));
  const patterns = Array.isArray(p) ? p : [];
  return {
    chords: chords.length > 0 ? chords : [0],
    patterns: Array.from({ length: TRACK_COUNT }, (_, index) => unpackPattern(patterns[index])),
  };
}

function unpackTrack(value: unknown): Track {
  const list = Array.isArray(value) ? value : [];
  return {
    sound: integer(list[0], 0, 3, 0),
    x: number(list[1], 0, 1, 0.5),
    y: number(list[2], 0, 1, 0.5),
    level: number(list[3], 0, 1, 0.7),
    hall: number(list[4], 0, 1, 0),
    echo: number(list[5], 0, 1, 0),
    mute: list[6] === 1,
  };
}

/** A project from untrusted data; throws when it is not a Kreisel at all. */
export function unpack(value: unknown): Project {
  if (typeof value !== "object" || value === null) throw new Error("kein Kreisel");
  const data = value as Partial<Record<keyof Packed, unknown>>;
  if (data.v !== 1) throw new Error("unbekannte Version");
  const scenes = Array.from({ length: SCENE_COUNT }, (_, index) => unpackScene(Array.isArray(data.c) ? data.c[index] : null));
  if (scenes.every((scene) => scene === null)) throw new Error("keine Szene");
  const wanted = integer(data.i, 0, SCENE_COUNT - 1, 0);
  const tracks = Array.isArray(data.t) ? data.t : [];
  return {
    v: 1,
    bpm: integer(data.b, 60, 200, 112),
    swing: number(data.s, 0, 1, 0),
    root: integer(data.r, 0, 11, 9),
    scale: SCALE_IDS.includes(data.m as ScaleId) ? (data.m as ScaleId) : "moll",
    pump: number(data.p, 0, 1, 0.3),
    volume: number(data.o, 0, 1, 0.8),
    tracks: Array.from({ length: TRACK_COUNT }, (_, index) => unpackTrack(tracks[index])),
    scenes,
    scene: scenes[wanted] ? wanted : scenes.findIndex((scene) => scene !== null),
    chain: data.k === 1,
    repeats: [1, 2, 4].includes(data.n as number) ? (data.n as number) : 1,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const result = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await result.arrayBuffer());
}

/** Links longer than this are not worth trying: no Kreisel is that big. */
const MAX_LINK_LENGTH = 40_000;

/** The project as the part of a link after `#k=`. */
export async function encodeLink(project: Project): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(pack(project)));
  if (typeof CompressionStream === "undefined") return `0.${toBase64Url(json)}`;
  return `1.${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
}

export async function decodeLink(text: string): Promise<Project> {
  if (text.length > MAX_LINK_LENGTH) throw new Error("Link zu lang");
  const [kind, body = ""] = text.split(".", 2);
  const bytes = fromBase64Url(body);
  const json = kind === "1" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  if (kind !== "0" && kind !== "1") throw new Error("unbekanntes Format");
  if (json.length > 400_000) throw new Error("Link zu groß");
  return unpack(JSON.parse(new TextDecoder().decode(json)));
}

/** For the browser's storage: plain JSON of the packed form. */
export function serialize(project: Project): string {
  return JSON.stringify(pack(project));
}

export function deserialize(text: string): Project {
  return unpack(JSON.parse(text));
}

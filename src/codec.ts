import { cleanAcid, takesAcid } from "./acid";
import { cleanBody } from "./body";
import { cleanVoice } from "./voice";
import { cleanRumble } from "./rumble";
import { cleanWind, packWeather, unpackWeather } from "./weather";
import { ACID_SOUND, BODY_SOUND, BUILD_BARS, BUILD_GAPS, BUILD_NONE, BUILD_SMALL, SWAY_PARTS, clamp, emptyRumble, emptyStep, HEIGHT_MAX, MAX_VOICE_TEXT, VOICE_SOUND, MAX_CHORDS, MAX_NOTE_LENGTH, MAX_STEPS, MAX_STROKE_POINTS, MAX_NAME, MAX_STROKES, MAX_TURNS, MIN_STEPS, OWN_SOUND, PITCH_MAX, PITCH_MIN, SCENE_COUNT, STYLE_IDS, TIME_MAX, TRACK_COUNT, firstPiece, type Acid, type Bild, type Body, type Build, type Pattern, type Voice, type Piece, type Project, type Relay, type Scene, type ScaleId, type Step, type StyleId, type Stroke, type Track } from "./model";
import { SCALE_IDS } from "./music";
import { MAX_ROUNDS, orderOfOld, packOrder, unpackOrder } from "./order";
import { buildOfAll, isDrop, MAX_OWN_BUILDS, soundBuild, soundPiece } from "./piece";
import { LAST_SOUND } from "./sounds/index";
import { cleanName } from "./relay";

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

/**
 * A painted sound as bytes, in base64: whether and where it holds, then per
 * stroke a head (kind | size << 2 | swell << 4), its number of points and
 * three bytes a point (time, height high, height low).
 */
export function packBild(bild: Bild): string {
  const bytes: number[] = [bild.hold === null ? 0 : 1, bild.hold ?? 0, bild.strokes.length];
  for (const stroke of bild.strokes) {
    const count = stroke.points.length >> 1;
    bytes.push(stroke.kind | (stroke.size << 2) | (stroke.swell ? 16 : 0), count);
    for (let index = 0; index < count; index += 1) {
      const y = stroke.points[index * 2 + 1] ?? 0;
      bytes.push(stroke.points[index * 2] ?? 0, y >> 8, y & 255);
    }
  }
  return toBase64Url(Uint8Array.from(bytes));
}

/** A picture from untrusted text; `null` when it is none. Whatever it claims is clamped to what a picture may hold. */
export function unpackBild(value: unknown): Bild | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4000) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(value);
  } catch {
    return null;
  }
  if (bytes.length < 3) return null;
  const strokes: Stroke[] = [];
  let at = 3;
  for (let index = 0; index < (bytes[2] ?? 0) && at + 2 <= bytes.length; index += 1) {
    const head = bytes[at] ?? 0;
    const count = bytes[at + 1] ?? 0;
    at += 2;
    const points: number[] = [];
    let time = 0;
    for (let point = 0; point < count && at + 3 <= bytes.length; point += 1) {
      time = Math.max(time, clamp(bytes[at] ?? 0, 0, TIME_MAX));
      if (point < MAX_STROKE_POINTS) points.push(time, clamp(((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0), 0, HEIGHT_MAX));
      at += 3;
    }
    if (points.length > 0 && strokes.length < MAX_STROKES) strokes.push({ kind: Math.min(2, head & 3), size: Math.min(2, (head >> 2) & 3), swell: (head & 16) !== 0, points });
  }
  return { strokes, hold: bytes[0] === 1 ? clamp(bytes[1] ?? 0, 0, TIME_MAX) : null };
}

/**
 * What a piece does by itself, as bits of one number. The first three are from before a build-up was a kit: a link
 * of then says with them what its one build-up had beyond the bar of rising noise. A link of now does not set them.
 */
const MOVES = { roll: 1, kick: 2, hat: 4, vary: 8 } as const;

/** The parts of a build-up that are on or off, in the order of their bits. */
const BUILD_PARTS = ["roll", "lows", "wash", "dip", "kick", "hat", "late"] as const;

/** A build-up as one number: its length (three bits, as a place in BUILD_BARS), its riser (two), its gap (two, as a place in BUILD_GAPS), and a bit a part. */
function packBuild(build: Readonly<Build>): number {
  let packed = Math.max(0, BUILD_BARS.indexOf(build.bars as (typeof BUILD_BARS)[number])) | ((build.riser & 3) << 3) | (Math.max(0, BUILD_GAPS.indexOf(build.gap as (typeof BUILD_GAPS)[number])) << 5);
  BUILD_PARTS.forEach((part, bit) => { if (build[part]) packed |= 1 << (7 + bit); });
  return packed;
}

function unpackBuild(value: unknown): Build | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= 1 << (7 + BUILD_PARTS.length)) return null;
  const build: Build = { ...BUILD_NONE, bars: BUILD_BARS[value & 7] ?? -1, riser: (value >> 3) & 3, gap: BUILD_GAPS[(value >> 5) & 3] ?? 0 };
  BUILD_PARTS.forEach((part, bit) => { build[part] = (value & (1 << (7 + bit))) !== 0; });
  return soundBuild(build);
}

/**
 * The build-ups of a piece as numbers: that of all drops first, then for every drop with one of its own the bar it
 * lands in and its build-up. Nothing for a piece whose drops all have the small one.
 */
function packBuilds(piece: Piece): number[] | null {
  // An entry on a bar where no drop lands says nothing (see `Piece.drops`): it is not passed on.
  const own = (piece.drops ?? []).filter((entry) => isDrop(piece, entry.bar)).slice(0, MAX_OWN_BUILDS);
  if (!piece.build && own.length === 0) return null;
  return [packBuild(buildOfAll(piece)), ...own.flatMap((entry) => [entry.bar, packBuild(entry.build)])];
}

/** What a link says of the build-ups, as far as it can be read; `null` for a link that says nothing of them. */
function unpackBuilds(value: unknown): { build: Build | null; drops: { bar: number; build: Build }[] } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1 + 2 * MAX_OWN_BUILDS) return null;
  const drops: { bar: number; build: Build }[] = [];
  for (let index = 1; index + 1 < value.length; index += 2) {
    const bar: unknown = value[index];
    const build = unpackBuild(value[index + 1]);
    if (build && typeof bar === "number" && Number.isInteger(bar)) drops.push({ bar, build });
  }
  return { build: unpackBuild(value[0]), drops };
}

/** The longest list of a roster a link may carry: two bits a bar for 256 bars, in base64. */
const ROSTER_CHARS = 90;

/** A roster as a list a ring, two bits a bar in base64, empty for a ring with nothing laid; rings after the last such one are left out. */
function packRoster(piece: Piece): string[] | null {
  if (!piece.roster) return null;
  const lists = piece.roster.map((list) => {
    if (list.length === 0) return "";
    const bits = new Uint8Array(Math.ceil(piece.tension.length / 4));
    list.forEach((state, bar) => { bits[bar >> 2] = (bits[bar >> 2] ?? 0) | ((state & 3) << ((bar & 3) * 2)); });
    return toBase64Url(bits);
  });
  while (lists.length > 0 && lists[lists.length - 1] === "") lists.pop();
  return lists.length > 0 ? lists : null;
}

/** What a link says of the roster, as far as it can be read: a list a ring of `bars` entries, or nothing. */
function unpackRoster(value: unknown, bars: number): number[][] {
  if (!Array.isArray(value) || value.length > TRACK_COUNT) return [];
  return value.map((text) => {
    if (typeof text !== "string" || text.length === 0 || text.length > ROSTER_CHARS) return [];
    try {
      const bits = fromBase64Url(text);
      return Array.from({ length: bars }, (_, bar) => ((bits[bar >> 2] ?? 0) >> ((bar & 3) * 2)) & 3);
    } catch {
      // A list that cannot be read is no list.
      return [];
    }
  });
}

/** What a piece has that came after its build-ups, each under a letter of its own and there only if it says something. */
interface PackedMore {
  /** What the tension moves (`Piece.sway`): two bits a part, in the order of SWAY_PARTS. */
  s?: number;
}

type PackedPiece = [number, string, string, string?, number?, string[]?, number[]?, PackedMore?];

function packMore(piece: Piece): PackedMore | null {
  const more: PackedMore = {};
  if (piece.sway) more.s = SWAY_PARTS.reduce((packed, part, index) => packed | ((piece.sway?.[part] ?? 0) & 3) << (index * 2), 0);
  return Object.keys(more).length > 0 ? more : null;
}

/** What a link says of the later parts of a piece, as far as it can be read. */
function unpackMore(value: unknown): { sway?: Record<string, number> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const more = value as Record<string, unknown>;
  const extras: { sway?: Record<string, number> } = {};
  const sway = more.s;
  if (typeof sway === "number" && Number.isInteger(sway) && sway > 0 && sway < 1 << (SWAY_PARTS.length * 2)) {
    extras.sway = Object.fromEntries(SWAY_PARTS.map((part, index) => [part, (sway >> (index * 2)) & 3]));
  }
  return extras;
}

/**
 * A piece as [on, one byte a bar (tension | scene << 5) in base64, the order of the rings as digits].
 * Only a piece that has them adds more: its bars "ohne Kick" as one bit a bar in base64 (empty for none), what it
 * does by itself as a number (see MOVES, 0 for nothing), its roster (see packRoster, an empty list for none), and
 * its build-ups (see packBuilds), and whatever came later as one object (see packMore). A piece without any of that
 * is packed as it always was, and each of the five is there only if it or one after it says something.
 */
export function packPiece(piece: Piece): PackedPiece {
  const bytes = piece.tension.map((tension, bar) => (tension & 31) | (((piece.scenes[bar] ?? 0) & 7) << 5));
  const packed: PackedPiece = [piece.on ? 1 : 0, toBase64Url(Uint8Array.from(bytes)), piece.order.join("")];
  const moves = piece.vary ? MOVES.vary : 0;
  let marks = "";
  if (piece.noKick?.some(Boolean)) {
    const bits = new Uint8Array(Math.ceil(piece.tension.length / 8));
    piece.noKick.forEach((out, bar) => { if (out) bits[bar >> 3] = (bits[bar >> 3] ?? 0) | (1 << (bar & 7)); });
    marks = toBase64Url(bits);
  }
  const roster = packRoster(piece);
  const builds = packBuilds(piece);
  const more = packMore(piece);
  if (marks !== "" || moves > 0 || roster || builds || more) packed.push(marks);
  if (moves > 0 || roster || builds || more) packed.push(moves);
  if (roster || builds || more) packed.push(roster ?? []);
  if (builds || more) packed.push(builds ?? []);
  if (more) packed.push(more);
  return packed;
}

export function unpackPiece(value: unknown, fallbackScene: number): Piece {
  const [on, bars, order, marks, moves, lists, kits, more] = Array.isArray(value) ? value : [];
  if (typeof bars !== "string" || bars.length === 0 || bars.length > 400) return firstPiece(fallbackScene);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(bars);
  } catch {
    return firstPiece(fallbackScene);
  }
  let noKick: boolean[] = [];
  if (typeof marks === "string" && marks.length > 0 && marks.length <= 60) {
    try {
      const bits = fromBase64Url(marks);
      noKick = Array.from(bytes, (_, bar) => ((bits[bar >> 3] ?? 0) & (1 << (bar & 7))) !== 0);
    } catch {
      // Marks that cannot be read are no marks.
    }
  }
  const does = typeof moves === "number" && Number.isInteger(moves) ? moves : 0;
  // A link from before the kit says what its one build-up had with three bits: the roll ran through two bars, the rest is the small one.
  const roll = (does & MOVES.roll) !== 0;
  const old = (does & (MOVES.roll | MOVES.kick | MOVES.hat)) !== 0 ? { ...BUILD_SMALL, bars: roll ? 2 : 1, roll, kick: (does & MOVES.kick) !== 0, hat: (does & MOVES.hat) !== 0 } : null;
  const builds = unpackBuilds(kits) ?? { build: old, drops: [] };
  const extras = { noKick, roster: unpackRoster(lists, bytes.length), build: builds.build, drops: builds.drops, vary: (does & MOVES.vary) !== 0, ...unpackMore(more) };
  return soundPiece(on === 1, Array.from(bytes, (byte) => byte & 31), Array.from(bytes, (byte) => byte >> 5), typeof order === "string" ? Array.from(order, Number) : [], fallbackScene, extras);
}

interface PackedScene {
  h: number[];
  p: number[][];
  q?: string;
  /** Weather and winds. */
  x?: string;
  d?: number[];
}

/** Where a ring's Zerre stands in its packed list: after its settings (0 to 6) and its picture, body and voice (7 to 9). */
const DRIVE_AT = 10;
/** And where its acid machine stands, after that. */
const ACID_AT = 11;

interface Packed {
  v: 1;
  /** The style, where it is not "frei": links from before there were styles have none. */
  g?: string;
  /** Druck, in hundredths, where there is any. */
  u?: number;
  b: number;
  s: number;
  r: number;
  m: string;
  p: number;
  o: number;
  t: (number | string)[][];
  c: (PackedScene | 0)[];
  /** The Nachbeben's character and the kick's: dirt, roll and (where the kick is driven at all) hardness, in hundredths. */
  w?: [number, number] | [number, number, number];
  i: number;
  k: number;
  /** The row, a digit a round, where it is not simply every filled scene once in turn. */
  f?: string;
  /** Only in links from before the row: how often every filled scene played in turn. */
  n?: number;
  z?: PackedPiece;
  /** Reihum: the rule, whether it is revealed, and the turns as [name, the project then]. */
  y?: { r: number; o: number; t: [string, unknown][] };
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The project without the turns it has been through: what one turn keeps of it. */
export function packState(project: Project): Packed {
  const packed: Packed = {
    v: 1,
    ...(project.style === "frei" ? {} : { g: project.style }),
    ...(project.pressure > 0 ? { u: Math.round(project.pressure * 100) } : {}),
    b: project.bpm,
    s: round(project.swing),
    r: project.root,
    m: project.scale,
    p: round(project.pump),
    o: round(project.volume),
    t: project.tracks.map((track) => {
      const packed: (number | string)[] = [track.sound, round(track.x), round(track.y), round(track.level), round(track.hall), round(track.echo), track.mute ? 1 : 0];
      if (track.bild || track.body || track.voice) packed.push(track.bild ? packBild(track.bild) : 0);
      // A body is six small numbers: what it is, its size, tightness and material in hundredths, what sets it going, and where.
      if (track.body) packed.push([track.body.kind, track.body.size, track.body.tight, track.body.material, track.body.exciter, track.body.where].map((value, index) => (index === 0 || index === 4 ? value : Math.round(value * 100))).join("."));
      else if (track.voice) packed.push(0);
      // A voice is the room in its mouth and its breath in hundredths, then the line it sings.
      if (track.voice) packed.push(`${Math.round(track.voice.mouth * 100)}.${Math.round(track.voice.breath * 100)}.${track.voice.text}`);
      // Zerre, in hundredths, has the place after the ring's three own sounds; a ring that is not driven ends before it.
      if (track.drive > 0) {
        while (packed.length < DRIVE_AT) packed.push(0);
        packed.push(Math.round(track.drive * 100));
      }
      // An acid machine is its bite and its decay in hundredths, and 1 for a square wave.
      if (track.acid) {
        while (packed.length < ACID_AT) packed.push(0);
        packed.push(`${Math.round(track.acid.bite * 100)}.${Math.round(track.acid.decay * 100)}.${track.acid.square ? 1 : 0}`);
      }
      return packed;
    }),
    c: project.scenes.map((scene) => {
      if (!scene) return 0;
      const packed: PackedScene = {
        h: scene.chords,
        p: scene.patterns.map((pattern) => {
          const steps = pattern.steps.map(packStep);
          while (steps.length > 0 && steps[steps.length - 1] === 0) steps.pop();
          return [pattern.len, ...steps];
        }),
      };
      // The Nachbeben: one hex digit a step, without the still steps at the end; left out where nothing shakes.
      const line = scene.rumble.map((value) => value.toString(16)).join("").replace(/0+$/, "");
      if (line) packed.q = line;
      // The weather, and its winds where there is any.
      const sky = packWeather(scene.weather);
      if (sky) packed.x = sky;
      if (sky && scene.wind.some((wind) => wind !== 0)) packed.d = scene.wind;
      return packed;
    }),
    w: project.hard > 0
      ? [Math.round(project.dirt * 100), Math.round(project.roll * 100), Math.round(project.hard * 100)]
      : [Math.round(project.dirt * 100), Math.round(project.roll * 100)],
    i: project.scene,
    k: project.chain ? 1 : 0,
    z: packPiece(project.piece),
  };
  // The row, a digit a round. While it is every filled scene once in turn it goes without saying.
  if (packOrder(project.order) !== packOrder(orderOfOld(project.scenes, 1))) packed.f = packOrder(project.order);
  return packed;
}

export function pack(project: Project): Packed {
  const packed = packState(project);
  const relay = project.relay;
  if (relay) packed.y = { r: relay.rule, o: relay.open ? 1 : 0, t: relay.turns.map((turn) => [turn.name, turn.state]) };
  return packed;
}

/** The turns from untrusted data. Every turn's state is unpacked and packed again, so only sound states are kept; turns that are none are left out. */
function unpackRelay(value: unknown): Relay | null {
  if (typeof value !== "object" || value === null) return null;
  const { r, o, t } = value as { r?: unknown; o?: unknown; t?: unknown };
  const turns: Relay["turns"] = [];
  for (const item of (Array.isArray(t) ? t : []).slice(-MAX_TURNS)) {
    const [name, state] = Array.isArray(item) ? item : [];
    try {
      turns.push({ name: cleanName(name, MAX_NAME), state: packState(unpack(state, true)) });
    } catch {
      // Not a Kreisel: this turn is lost, the others stay.
    }
  }
  return { rule: integer(r, 0, 2, 0), open: o === 1, turns };
}

const number = (value: unknown, low: number, high: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, low, high) : fallback;

const integer = (value: unknown, low: number, high: number, fallback: number): number => Math.round(number(value, low, high, fallback));

function unpackPattern(value: unknown): Pattern {
  const list = Array.isArray(value) ? value : [];
  const steps = Array.from({ length: MAX_STEPS }, (_, index) => unpackStep(Number(list[index + 1] ?? 0)));
  return { len: integer(list[0], MIN_STEPS, MAX_STEPS, 16), steps };
}

/** The Nachbeben's line from its hex digits; anything else shakes nowhere. */
export function unpackRumble(value: unknown): number[] {
  if (typeof value !== "string" || !/^[0-9a-f]{1,32}$/.test(value)) return emptyRumble();
  return cleanRumble([...value].map((digit) => Number.parseInt(digit, 16)));
}

function unpackScene(value: unknown): Scene | null {
  if (typeof value !== "object" || value === null) return null;
  const { h, p, q, x, d } = value as { h?: unknown; p?: unknown; q?: unknown; x?: unknown; d?: unknown };
  const chords = (Array.isArray(h) ? h : []).slice(0, MAX_CHORDS).map((chord) => integer(chord, 0, 6, 0));
  const patterns = Array.isArray(p) ? p : [];
  return {
    chords: chords.length > 0 ? chords : [0],
    patterns: Array.from({ length: TRACK_COUNT }, (_, index) => unpackPattern(patterns[index])),
    rumble: unpackRumble(q),
    weather: unpackWeather(x),
    wind: cleanWind(d),
  };
}

/** A voice from its two numbers and its line; anything else is no voice. */
export function unpackVoice(value: unknown): Voice | null {
  if (typeof value !== "string" || value.length > MAX_VOICE_TEXT + 12) return null;
  const match = /^(\d{1,3})\.(\d{1,3})\.(.*)$/su.exec(value);
  if (!match) return null;
  return cleanVoice({ mouth: Number(match[1]) / 100, breath: Number(match[2]) / 100, text: match[3] });
}

/** A body from its six numbers; anything else is no body. */
export function unpackBody(value: unknown): Body | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const parts = value.split(".").map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) return null;
  const [kind = 0, size = 50, tight = 50, material = 50, exciter = 0, where = 30] = parts;
  return cleanBody({ kind, size: size / 100, tight: tight / 100, material: material / 100, exciter, where: where / 100 });
}

/** An acid machine from untrusted data: "bite.decay.wave", the first two in hundredths. */
function unpackAcid(value: unknown): Acid | null {
  if (typeof value !== "string" || value.length > 12) return null;
  const parts = value.split(".").map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [bite = 60, decay = 35, wave = 0] = parts;
  return cleanAcid({ bite: bite / 100, decay: decay / 100, square: wave === 1 });
}

function unpackTrack(value: unknown, index: number): Track {
  const list = Array.isArray(value) ? value : [];
  const bild = unpackBild(list[7]);
  const body = unpackBody(list[8]);
  const voice = unpackVoice(list[9]);
  // Only the bass and the melody can have an acid machine.
  const acid = takesAcid(index) ? unpackAcid(list[ACID_AT]) : null;
  // A number that is no sound (a damaged link, or one from a later Kreisel that has more sounds) is read as the ring's first.
  const stored = integer(list[0], -1, ACID_SOUND + 1, 0);
  const sound = stored < 0 || (stored > LAST_SOUND && stored !== ACID_SOUND) ? 0 : stored;
  return {
    // A ring cannot play a picture, a body, a voice or a machine it does not have.
    sound: (sound === OWN_SOUND && !bild) || (sound === BODY_SOUND && !body) || (sound === VOICE_SOUND && !voice) || (sound === ACID_SOUND && !acid) ? 0 : sound,
    x: number(list[1], 0, 1, 0.5),
    y: number(list[2], 0, 1, 0.5),
    level: number(list[3], 0, 1, 0.7),
    hall: number(list[4], 0, 1, 0),
    echo: number(list[5], 0, 1, 0),
    drive: number(Number(list[DRIVE_AT] ?? 0) / 100, 0, 1, 0),
    mute: list[6] === 1,
    bild,
    body,
    voice,
    acid,
  };
}

/**
 * A project from untrusted data; throws when it is not a Kreisel at all.
 * `inTurn` unpacks the state of a turn: that never has turns of its own, whatever it claims.
 */
export function unpack(value: unknown, inTurn = false): Project {
  if (typeof value !== "object" || value === null) throw new Error("kein Kreisel");
  const data = value as Partial<Record<keyof Packed, unknown>>;
  if (data.v !== 1) throw new Error("unbekannte Version");
  const scenes = Array.from({ length: SCENE_COUNT }, (_, index) => unpackScene(Array.isArray(data.c) ? data.c[index] : null));
  if (scenes.every((scene) => scene === null)) throw new Error("keine Szene");
  const wanted = integer(data.i, 0, SCENE_COUNT - 1, 0);
  const tracks = Array.isArray(data.t) ? data.t : [];
  const first = scenes.findIndex((scene) => scene !== null);
  const piece = unpackPiece(data.z, first);
  // The row as it was laid. A link from before the row says how often every filled scene plays in turn (`n`);
  // one that says neither plays each once.
  const laid = unpackOrder(data.f).filter((scene) => scenes[scene]).slice(0, MAX_ROUNDS);
  const order = laid.length > 0 ? laid : orderOfOld(scenes, [1, 2, 4].includes(data.n as number) ? (data.n as number) : 1);
  // A bar cannot play a scene that is not there.
  piece.scenes = piece.scenes.map((scene) => (scenes[scene] ? scene : first));
  return {
    v: 1,
    style: STYLE_IDS.includes(data.g as StyleId) ? (data.g as StyleId) : "frei",
    bpm: integer(data.b, 60, 200, 112),
    swing: number(data.s, 0, 1, 0),
    root: integer(data.r, 0, 11, 9),
    scale: SCALE_IDS.includes(data.m as ScaleId) ? (data.m as ScaleId) : "moll",
    pump: number(data.p, 0, 1, 0.3),
    pressure: number(Number(data.u ?? 0) / 100, 0, 1, 0),
    // A link from before the kick could be driven has a clean kick.
    hard: Array.isArray(data.w) ? number(Number(data.w[2] ?? 0) / 100, 0, 1, 0) : 0,
    dirt: Array.isArray(data.w) ? number(Number(data.w[0]) / 100, 0, 1, 0.35) : 0.35,
    roll: Array.isArray(data.w) ? number(Number(data.w[1]) / 100, 0, 1, 0.2) : 0.2,
    volume: number(data.o, 0, 1, 0.8),
    tracks: Array.from({ length: TRACK_COUNT }, (_, index) => unpackTrack(tracks[index], index)),
    scenes,
    scene: scenes[wanted] ? wanted : scenes.findIndex((scene) => scene !== null),
    chain: data.k === 1,
    order,
    piece,
    relay: inTurn ? null : unpackRelay(data.y),
  };
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

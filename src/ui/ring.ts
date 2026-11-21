import { nextHit, slidesInto } from "../acid";
import { ACID_SOUND, currentScene, PITCH_MAX, PITCH_MIN, RUMBLE_MAX, SCENE_NAMES, WEATHER_MAX, stepAt, TENSION_MAX, TRACK_COUNT, TRACK_INFO, TRACK_KINDS, trackInfo, type Pattern, type Scene, type Step, wrap } from "../model";
import { chordAt, chordName } from "../music";
import { drawMouth } from "./booth";
import { WEATHER_COLORS, windDrift } from "../weather";
import { Lights } from "./lights";
import { approach, compare, DEAL, dealt, face, hop, MANY, POP, rest, SHRINK, SLIDE, SWELL, swell, unface } from "./motion";
import { entry } from "../piece";
import { turnColor } from "../relay";
import type { App } from "../app/app";
import { type Spot, TAU, BRUSH, lerp } from "./ring-shape";
import { RingGestures } from "./ring-gestures";

/*
 * The Kreisel itself: seven rings on a canvas, a ring of chords and the hub
 * in the middle. Step 1 is at twelve o'clock, time runs clockwise. The ring
 * in focus is wider, and its steps sit further out the higher they sound.
 * This file draws it, frame by frame, and knows where everything on it is;
 * what a pointer does on it is in ring-gestures.ts.
 */

interface Palette {
  bg: string;
  ink: string;
  paper: string;
}

/** Where everything on the wheel lies, in the canvas's own pixels. */
type Geometry = ReturnType<RingView["geometry"]>;

/** What every part of one frame's picture goes by. */
interface Frame {
  /** Seconds, by the page's clock. */
  now: number;
  geometry: Geometry;
  scene: Scene;
  /** Steps since the scene began, with fractions; `null` when nothing plays. */
  playhead: number | null;
  /** Less motion was asked for. */
  calm: boolean;
  /** The light show is on. */
  show: boolean;
  /** Seconds since the Kreisel last started or stopped. */
  sinceToggle: number;
  /** The rings that have struck since the last frame and have not thrown their light yet. */
  fresh: boolean[];
}

/** The piece's ring as it lies in a frame. */
interface PieceShape {
  center: number;
  /** The band of the ring, and where the strip of scenes at its inner edge ends and the bars begin. */
  inner: number;
  outer: number;
  base: number;
  /** How many bars the piece has, and the angle one of them takes. */
  count: number;
  cell: number;
  /** 0..1: how far the piece's ring is in focus. */
  focus: number;
  middle: number;
  /** How high a bar of full tension stands. */
  span: number;
}

/** One ring as it lies in a frame. */
interface Lane {
  track: number;
  band: { inner: number; outer: number };
  pattern: Pattern;
  info: ReturnType<typeof trackInfo>;
  /** The angle one step takes. */
  cell: number;
  thickness: number;
  middle: number;
  /** 0..1: how far the ring is in focus (it widens as it comes into it). */
  focus: number;
  /** 0..1: how much the ring flares because it has just struck. */
  flash: number;
  /** 0..1: how far it is painted in its colour (heard) rather than in ink (muted). */
  heard: number;
  /** How much room a hit takes across the ring, and how far in and how far out its middle may lie. */
  tile: number;
  low: number;
  high: number;
}
const TOP = -Math.PI / 2;
const FOCUS = 3.1;
/** The piece's ring among the weights, and how wide it is while another ring is in focus. */
const PIECE = TRACK_COUNT;
const PIECE_REST = 0.72;
/** The share of the piece's band that holds the strip of scenes while it is in focus. */
const LANE = 0.22;
const CHANCE_ALPHA = [1, 0.72, 0.48, 0.28] as const;
/** How long the runner takes to grow out of the middle at a start, and to fade where it stood at a stop (seconds). */
const RUNNER_IN = 0.16;
const RUNNER_OUT = 0.22;
/** How long the hub takes to give way and hop back when the Kreisel starts or stops. */
const HUB_PRESS = 0.3;

export class RingView {
  private readonly context: CanvasRenderingContext2D;
  private size = 0;
  private readonly weights: number[] = [...Array.from({ length: TRACK_COUNT }, () => 1), PIECE_REST];
  dirty = true;
  private palette: Palette = { bg: "#f4ecdd", ink: "#2a2233", paper: "#fffaf0" };
  private font = "system-ui, sans-serif";
  private readonly calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  // ---- motion (see motion.ts): what each ring looked like at the last look, and what is still moving ----
  /** Something on the table has changed since the rings were last looked at. */
  private changed = true;
  private readonly faces: (number[] | undefined)[] = [];
  private readonly patterns: (Pattern | undefined)[] = [];
  /** When each step's hit pops in (dealt hits lie a moment ahead), and when it was last nudged. */
  private readonly born: number[][] = Array.from({ length: TRACK_COUNT }, () => []);
  private readonly nudged: number[][] = Array.from({ length: TRACK_COUNT }, () => []);
  /** Hits that were taken away and are still shrinking. */
  private ghosts: { track: number; index: number; length: number; value: number; at: number }[] = [];
  /** A ring that was turned slides into its new place: by how many steps, since when. */
  private readonly turns: ({ by: number; at: number } | undefined)[] = [];
  /** How much of each ring is heard (a muted ring fades to grey), how far the hub is lifted under the pointer, how lit each chord is. */
  private readonly heard: number[] = [];
  private lift = 0;
  private readonly lit: number[] = [];
  /** When the Kreisel last started or stopped, and where its runner last was. */
  private wasPlaying = false;
  private toggledAt = -10;
  private lastHead = 0;
  /** Frames are drawn until then even if nothing else asks for them. */
  private liveUntil = 0;
  // ---- the light show (see lights.ts): how long ago each ring had struck at the last frame ----
  private readonly lights: Lights;
  private readonly lastSince: number[] = [];
  /** What the pointer does on the wheel, and where it is. */
  private readonly gestures: RingGestures;

  /** `tip` is the small label that follows the pointer, `aura` the canvas under the wheel on which the light show glows. */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: App, tip: HTMLElement, aura: HTMLCanvasElement | null = null) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    this.context = context;
    this.lights = new Lights(aura);
    this.gestures = new RingGestures(this, app, canvas, tip);
    this.weights[app.selected] = FOCUS;
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.readPalette());
    this.readPalette();
    this.resize();
    const frame = (): void => {
      this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** The table has changed: look at the rings again and draw. */
  invalidate(): void {
    this.dirty = true;
    this.changed = true;
  }

  /** Only what the pointer shows has changed: draw again. */
  redraw(): void {
    this.dirty = true;
  }

  /** How much is in motion right now (for the browser tests): hits popping in, hits shrinking away, rings sliding. */
  motion(): { popping: number; shrinking: number; sliding: number } {
    const now = performance.now() / 1000;
    const popping = this.born.reduce((sum, ring) => sum + ring.filter((at) => now - at < POP).length, 0);
    const sliding = this.turns.filter((turn, track) => turn !== undefined && this.sliding(track, now) !== 0).length;
    return { popping, shrinking: this.ghosts.filter((ghost) => now - ghost.at < SHRINK).length, sliding };
  }

  /** What the light show has in the air right now (for the browser tests). */
  light(): { sparks: number; waves: number; glowing: boolean } {
    return this.lights.count();
  }

  /** The colours of the page have changed (the stage went dark): read them again. */
  repaint(): void {
    this.readPalette();
  }

  private live(now: number, seconds: number): void {
    this.liveUntil = Math.max(this.liveUntil, now + seconds);
  }

  /** The steps a turned ring still has to slide until it is where it belongs. */
  private sliding(track: number, now: number): number {
    const turn = this.turns[track];
    if (!turn) return 0;
    const t = (now - turn.at) / SLIDE;
    return t >= 1 ? 0 : turn.by * (1 - rest(t));
  }

  /** Looks at every ring again and sets in motion what has changed: a new hit pops in, a taken one shrinks away, a turned ring slides, a new pattern is dealt around the circle. */
  private look(now: number): void {
    const scene = currentScene(this.app.project);
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const pattern = scene.patterns[track];
      if (!pattern) continue;
      const after = Array.from({ length: pattern.len }, (_, index) => face(stepAt(pattern, index)));
      const before = this.faces[track];
      const replaced = this.patterns[track] !== pattern;
      this.faces[track] = after;
      this.patterns[track] = pattern;
      if (this.calm.matches) continue;
      const change = compare(before ?? [], after);
      const born = this.born[track] ?? [];
      const nudged = this.nudged[track] ?? [];
      if (change.turned !== 0) {
        this.turns[track] = { by: change.turned + this.sliding(track, now), at: now };
        born.length = 0;
        nudged.length = 0;
        this.live(now, SLIDE + 0.05);
        continue;
      }
      const count = change.born.length + change.gone.length + change.nudged.length;
      if (count === 0) continue;
      // A whole new pattern (dice, another scene, a Kreisel from a link) is dealt hit by hit, also where a hit stays.
      const wave = replaced && count >= MANY;
      const coming = wave ? after.flatMap((value, index) => (value === 0 ? [] : [index])) : change.born;
      const going = wave && before ? before.flatMap((value, index) => (value === 0 ? [] : [index])) : change.gone;
      const many = wave || coming.length + going.length >= MANY;
      for (const index of coming) born[index] = now + (many ? dealt(index, after.length) : 0);
      for (const index of going) this.ghosts.push({ track, index, length: before?.length ?? after.length, value: before?.[index] ?? 0, at: now + (many ? dealt(index, before?.length ?? after.length) : 0) });
      if (!wave) for (const index of change.nudged) nudged[index] = now;
      this.live(now, (many ? DEAL : 0) + Math.max(POP, SHRINK, SWELL) + 0.05);
    }
  }

  /** Where a chord slot is on the page, for its menu. */
  slotPosition(slot: number): { x: number; y: number } {
    const geometry = this.geometry();
    const count = currentScene(this.app.project).chords.length;
    const angle = TOP + ((slot + 0.5) / count) * TAU;
    const radius = (geometry.chordIn + geometry.chordOut) / 2;
    const box = this.canvas.getBoundingClientRect();
    const scale = box.width / Math.max(1, this.size);
    return { x: box.left + (geometry.center + Math.cos(angle) * radius) * scale, y: box.top + (geometry.center + Math.sin(angle) * radius) * scale };
  }

  /** Where the middle of a step is on the page (for the browser tests, and for anything that points at a step). */
  stepPosition(track: number, step: number): { x: number; y: number } {
    const geometry = this.geometry();
    const band = geometry.rings[track] ?? { inner: 0, outer: 0 };
    const length = currentScene(this.app.project).patterns[track]?.len ?? 16;
    const angle = TOP + ((step + 0.5) / length) * TAU;
    const radius = (band.inner + band.outer) / 2;
    const box = this.canvas.getBoundingClientRect();
    const scale = box.width / Math.max(1, this.size);
    return { x: box.left + (geometry.center + Math.cos(angle) * radius) * scale, y: box.top + (geometry.center + Math.sin(angle) * radius) * scale };
  }

  private readPalette(): void {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    this.palette = { bg: read("--bg", "#f4ecdd"), ink: read("--ink", "#2a2233"), paper: read("--paper", "#fffaf0") };
    this.font = getComputedStyle(this.canvas).fontFamily || this.font;
    this.dirty = true;
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    const size = Math.max(120, Math.round(Math.min(box.width, box.height)));
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    if (size === this.size && this.canvas.width === Math.round(size * ratio)) return;
    this.size = size;
    this.canvas.width = Math.round(size * ratio);
    this.canvas.height = Math.round(size * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.dirty = true;
  }

  geometry(): { center: number; radius: number; hub: number; chordIn: number; chordOut: number; gap: number; rings: { inner: number; outer: number }[]; piece: { inner: number; outer: number; base: number } } {
    const center = this.size / 2;
    const radius = center - Math.max(9, this.size * 0.028);
    const hub = radius * 0.165;
    const chordIn = hub + Math.max(4, radius * 0.022);
    const chordOut = radius * 0.31;
    const gap = Math.max(2, radius * 0.011);
    const start = chordOut + gap * 2.5;
    const room = radius - start - gap * TRACK_COUNT;
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    let at = start;
    const rings = this.weights.map((weight) => {
      const inner = at;
      const outer = at + (room * weight) / total;
      at = outer + gap;
      return { inner, outer };
    });
    // The outermost band is the piece. In focus, its inner edge holds the strip of scenes; the tension rises from `base`.
    const band = rings.pop() ?? { inner: radius, outer: radius };
    const focus = Math.max(0, Math.min(1, ((this.weights[PIECE] ?? PIECE_REST) - PIECE_REST) / (FOCUS - PIECE_REST)));
    const piece = { ...band, base: band.inner + (band.outer - band.inner) * LANE * focus };
    return { center, radius, hub, chordIn, chordOut, gap, rings, piece };
  }

  /** Where a bar of the piece is on the page at a tension (0..1): for the browser tests. */
  barPosition(bar: number, height: number): { x: number; y: number } {
    const geometry = this.geometry();
    const count = this.app.project.piece.tension.length;
    const angle = TOP + ((bar + 0.5) / count) * TAU;
    const radius = geometry.piece.base + (geometry.piece.outer - geometry.piece.base) * height;
    const box = this.canvas.getBoundingClientRect();
    const scale = box.width / Math.max(1, this.size);
    return { x: box.left + (geometry.center + Math.cos(angle) * radius) * scale, y: box.top + (geometry.center + Math.sin(angle) * radius) * scale };
  }

  // ---- drawing ----------------------------------------------------------------

  private frame(): void {
    const now = performance.now() / 1000;
    const app = this.app;
    const calm = this.calm.matches;
    let moving = false;
    for (let track = 0; track <= TRACK_COUNT; track += 1) {
      const target = track === PIECE ? (this.app.piece.focused ? FOCUS : PIECE_REST) : track === this.app.selected && !this.app.piece.focused && !this.app.weather.focused ? FOCUS : 1;
      const now = this.weights[track] ?? 1;
      if (Math.abs(target - now) > 0.004) {
        this.weights[track] = this.calm.matches ? target : lerp(now, target, 0.24);
        moving = true;
      } else {
        this.weights[track] = target;
      }
    }
    if (this.changed) {
      this.changed = false;
      this.look(now);
    }
    if (this.ghosts.length > 0) this.ghosts = this.ghosts.filter((ghost) => now - ghost.at < SHRINK);
    // A muted ring fades to grey and back instead of switching.
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const target = app.audible(track) ? 1 : 0;
      const share = this.heard[track] ?? target;
      const next = calm ? target : approach(share, target, 0.3);
      if (next !== share) moving = true;
      this.heard[track] = next;
    }
    // The hub rises a little under the pointer.
    const over = this.gestures.hover?.kind === "hub" ? 1 : 0;
    const lift = calm ? over : approach(this.lift, over, 0.35);
    if (lift !== this.lift) moving = true;
    this.lift = lift;
    if (app.playing !== this.wasPlaying) {
      this.wasPlaying = app.playing;
      if (!calm) {
        this.toggledAt = now;
        this.live(now, 0.45);
      }
    }
    const flashing = Array.from({ length: TRACK_COUNT }, (_, track) => app.sinceStruck(track)).some((since) => since < 0.4);
    if (!this.dirty && !moving && !app.playing && !flashing && now > this.liveUntil && !this.lights.alive) return;
    this.dirty = false;
    this.draw(now);
  }

  private sector(inner: number, outer: number, from: number, to: number): void {
    const center = this.size / 2;
    const context = this.context;
    context.beginPath();
    context.arc(center, center, outer, from, to);
    context.arc(center, center, inner, to, from, true);
    context.closePath();
  }

  /** One frame of the wheel, from the table up: shadow, rings, chords, hub, the piece's ring, and the light on all of it. */
  private draw(now: number): void {
    const context = this.context;
    const app = this.app;
    const geometry = this.geometry();
    const playhead = app.playhead();
    const calm = this.calm.matches;
    if (playhead !== null) this.lastHead = playhead;
    const show = app.lights && !calm;
    const frame: Frame = { now, geometry, scene: currentScene(app.project), playhead, calm, show, sinceToggle: now - this.toggledAt, fresh: this.struckSince(show) };
    if (show) this.lights.shine(now, app.stage ? 1.5 : 1);
    else this.lights.clear();
    context.clearRect(0, 0, this.size, this.size);
    context.lineCap = "round";
    context.lineJoin = "round";

    this.drawShadow(geometry);
    for (let track = 0; track < TRACK_COUNT; track += 1) this.drawRing(frame, track);
    this.drawChords(frame);
    this.drawHub(frame);
    this.drawPiece(geometry, playhead !== null);
    this.drawRim(frame);
    this.drawBrush();
    this.drawMark(frame);
  }

  /** The light show: which rings have struck since the last frame. */
  private struckSince(show: boolean): boolean[] {
    const app = this.app;
    const fresh: boolean[] = [];
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const since = app.sinceStruck(track);
      const before = this.lastSince[track] ?? since;
      this.lastSince[track] = since;
      fresh[track] = show && since < before - 0.02 && since < 0.12 && app.audible(track) && !app.relay.veiled(track);
    }
    return fresh;
  }

  /** The wheel stands on the table like every tin thing here: with a hard shadow below it. */
  private drawShadow(geometry: Geometry): void {
    const context = this.context;
    const { center } = geometry;
    const rim = geometry.radius + 1;
    context.fillStyle = this.palette.ink;
    context.beginPath();
    context.arc(center, center + Math.max(3, this.size * 0.008), rim, 0, TAU);
    context.fill();
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(center, center, rim, 0, TAU);
    context.fill();
    context.globalCompositeOperation = "source-over";
  }

  /** One ring: its band, the weather on it, its hits, the runner, and what points at it. */
  private drawRing(frame: Frame, track: number): void {
    const { geometry, scene, playhead, now } = frame;
    const { center } = geometry;
    const context = this.context;
    const app = this.app;
    const band = geometry.rings[track];
    const pattern = scene.patterns[track];
    if (!band || !pattern) return;
    const thickness = band.outer - band.inner;
    const focus = Math.max(0, Math.min(1, ((this.weights[track] ?? 1) - 1) / (FOCUS - 1)));
    const audible = app.audible(track);
    const since = app.sinceStruck(track);
    const tile = lerp(thickness * 0.74, Math.max(8, thickness * 0.23), focus);
    const lane: Lane = {
      track,
      band,
      pattern,
      info: trackInfo(track),
      cell: TAU / pattern.len,
      thickness,
      middle: (band.inner + band.outer) / 2,
      focus,
      flash: app.playing || since < 0.4 ? Math.max(0, 1 - since / 0.24) : 0,
      heard: this.heard[track] ?? (audible ? 1 : 0),
      tile,
      low: band.inner + tile / 2 + 2,
      high: band.outer - tile / 2 - 2,
    };

    if (app.relay.veiled(track)) {
      this.drawVeil(center, lane);
      return;
    }
    this.drawBand(frame, lane);

    // A ring that was just turned slides into its new place, with all that lies on it.
    const slide = this.sliding(track, now);
    if (slide !== 0) {
      context.save();
      context.translate(center, center);
      context.rotate(-slide * lane.cell);
      context.translate(-center, -center);
      this.live(now, 0.05);
    }
    if (!app.weather.focused) this.drawWeather(scene, track, pattern.len, center, band, playhead);
    if (track === 0) this.drawRumble(scene.rumble, pattern, center, band, focus, audible, playhead);
    this.drawHits(frame, lane);
    // While the weather is what is being painted, it lies over the hits.
    if (app.weather.focused) this.drawWeather(scene, track, pattern.len, center, band, playhead);
    if (slide !== 0) context.restore();

    this.drawFocusLine(center, lane);
    this.drawRunner(frame, lane);
    this.drawPointers(center, lane);
  }

  /** A ring is painted in its colour as far as it is heard and in ink as far as it is muted; in between it fades. */
  private tint(lane: Lane, paint: () => void, loud: number, quiet: number): void {
    const context = this.context;
    if (lane.heard > 0) {
      context.globalAlpha = loud * lane.heard;
      context.fillStyle = lane.info.color;
      context.strokeStyle = lane.info.color;
      paint();
    }
    if (lane.heard < 1) {
      context.globalAlpha = quiet * (1 - lane.heard);
      context.fillStyle = this.palette.ink;
      context.strokeStyle = this.palette.ink;
      paint();
    }
    context.globalAlpha = 1;
  }

  /** Stille Post: someone built here, and it stays under a cloth until the round is revealed. */
  private drawVeil(center: number, lane: Lane): void {
    const context = this.context;
    const { band, thickness, middle } = lane;
    context.lineCap = "butt";
    context.strokeStyle = this.palette.ink;
    context.lineWidth = thickness;
    context.globalAlpha = 0.11;
    context.beginPath();
    context.arc(center, center, middle, 0, TAU);
    context.stroke();
    context.lineWidth = Math.max(1.5, thickness * 0.14);
    context.globalAlpha = 0.3;
    context.setLineDash([2, 7]);
    context.beginPath();
    context.arc(center, center, middle, 0, TAU);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = lane.focus;
    context.lineWidth = 1.5;
    for (const radius of [band.inner, band.outer]) {
      context.beginPath();
      context.arc(center, center, radius, 0, TAU);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.lineCap = "round";
  }

  /** The band of a ring, a little stronger for every second beat so the eye finds its way, and the lines between its steps. */
  private drawBand(frame: Frame, lane: Lane): void {
    const context = this.context;
    const { center } = frame.geometry;
    const { band, cell, thickness, middle, focus, flash } = lane;
    const length = lane.pattern.len;
    const stroke = (): void => context.stroke();
    context.lineCap = "butt";
    context.lineWidth = thickness;
    context.beginPath();
    context.arc(center, center, middle, 0, TAU);
    this.tint(lane, stroke, 0.15 + focus * 0.09 + flash * 0.05, 0.07 + focus * 0.09 + flash * 0.05);
    for (let beat = 1; beat * 4 < length + 3; beat += 2) {
      const from = TOP + beat * 4 * cell;
      const to = TOP + Math.min(length, beat * 4 + 4) * cell;
      if (to <= from) continue;
      context.beginPath();
      context.arc(center, center, middle, from, to);
      this.tint(lane, stroke, 0.1, 0.04);
    }
    context.lineCap = "round";

    // Step lines: every step on the ring in focus, only the beats on the others.
    context.strokeStyle = this.palette.bg;
    for (let step = 0; step < length; step += 1) {
      const beat = step % 4 === 0;
      if (!beat && focus < 0.3 && length > 8) continue;
      const angle = TOP + step * cell;
      context.lineWidth = beat ? 2 : 1;
      context.globalAlpha = beat ? 1 : focus;
      context.beginPath();
      context.moveTo(center + Math.cos(angle) * band.inner, center + Math.sin(angle) * band.inner);
      context.lineTo(center + Math.cos(angle) * band.outer, center + Math.sin(angle) * band.outer);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  /**
   * Makes the brush for one ring's hits. It paints one hit at a step of a ring of `steps` steps, at a share of its
   * size and of its strength, flared by `struck`, and tells how far from the hub the hit lies.
   */
  private hitBrush(frame: Frame, lane: Lane): (step: Step, index: number, steps: number, size: number, strength: number, struck: number) => number {
    const context = this.context;
    const { ink } = this.palette;
    const { band, info, heard, tile } = lane;
    const fill = (): void => context.fill();
    return (step, index, steps, size, strength, struck) => {
      const wide = TAU / steps;
      const radius = this.hitRadius(lane, step);
      const half = ((tile * (step.vel === 0 ? 0.55 : 1)) / 2) * size + struck * 2;
      const inner = Math.max(band.inner + 1, radius - half);
      const outer = Math.min(band.outer - 1, radius + half);
      const count = Math.max(1, step.ratchet);
      const held = info.melodic && count === 1 ? Math.min(step.len, steps) : 1;
      const span = (held * wide) / count;
      const pad = Math.min(span * 0.22, 1.6 / radius);
      const reach = (span / 2 - pad) * Math.min(size, 1.1);
      for (let repeat = 0; repeat < count; repeat += 1) {
        const at = TOP + index * wide + (repeat + 0.5) * span;
        this.sector(inner, outer, at - reach, at + reach);
        this.tint(lane, fill, (CHANCE_ALPHA[step.chance] ?? 1) * strength, (CHANCE_ALPHA[step.chance] ?? 1) * 0.4 * strength);
        if (step.chance > 0) {
          context.setLineDash([3, 3]);
          context.lineWidth = 1.5;
          context.strokeStyle = heard > 0.5 ? info.color : ink;
          context.globalAlpha = strength;
          context.stroke();
          context.globalAlpha = 1;
          context.setLineDash([]);
        }
        if (step.vel === 2) {
          context.lineWidth = 1.75;
          context.strokeStyle = ink;
          context.globalAlpha = strength;
          context.stroke();
          context.globalAlpha = 1;
        }
        if (struck > 0) {
          // A struck hit flares up, and with the light show on it glows in its colour.
          if (frame.show) {
            context.shadowColor = info.color;
            context.shadowBlur = 20 * struck;
          }
          context.globalAlpha = struck * 0.55;
          context.fillStyle = "#ffffff";
          context.fill();
          context.globalAlpha = 1;
          context.shadowBlur = 0;
        }
      }
      return radius;
    };
  }

  /** The hits of a ring. One that was just set hops in, one that was just nudged swells once, one that was taken shrinks away. */
  private drawHits(frame: Frame, lane: Lane): void {
    const { now, playhead, fresh } = frame;
    const { center } = frame.geometry;
    const { track, pattern, info, cell, middle, flash } = lane;
    const length = pattern.len;
    const current = playhead === null ? -1 : Math.floor(playhead) % length;
    const paintHit = this.hitBrush(frame, lane);
    for (const ghost of this.ghosts) {
      if (ghost.track !== track) continue;
      const gone = (now - ghost.at) / SHRINK;
      if (gone >= 1) continue;
      const left = gone <= 0 ? 1 : 1 - rest(gone);
      paintHit(unface(ghost.value), ghost.index, ghost.length, left, left, 0);
    }
    const born = this.born[track];
    const nudged = this.nudged[track];
    for (let index = 0; index < length; index += 1) {
      const step = stepAt(pattern, index);
      if (!step.on) continue;
      const age = now - (born?.[index] ?? -10);
      // Dealt around the ring, and its turn has not come yet.
      if (age < 0) continue;
      const poke = now - (nudged?.[index] ?? -10);
      const size = (age < POP ? hop(age / POP) : 1) * (poke < SWELL ? 1 + 0.2 * swell(poke / SWELL) : 1);
      const radius = paintHit(step, index, length, size, 1, index === current ? flash : 0);
      if (index === current && fresh[track]) {
        // It throws light on the table, an accent throws sparks, and the kick sends a wave through the rings.
        const angle = TOP + (index + 0.5 / Math.max(1, step.ratchet)) * cell;
        const power = step.vel === 2 ? 1 : step.vel === 1 ? 0.62 : 0.34;
        this.lights.strike(now, center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, this.size, info.color, power, step.vel === 2 ? 12 : step.vel === 1 ? 3 : 0);
        if (track === 0) this.lights.wave(now, power);
        fresh[track] = false;
      }
    }
    this.drawSlides(frame, lane);
    if (fresh[track]) {
      // Struck by hand, with no hit lying there: the light comes from where the runner is.
      const angle = TOP + (((playhead ?? 0) % length) / length) * TAU;
      this.lights.strike(now, center + Math.cos(angle) * middle, center + Math.sin(angle) * middle, this.size, info.color, 0.62, 3);
      if (track === 0) this.lights.wave(now, 0.62);
    }
  }

  /** How far out a hit lies in its ring: by its pitch, and the more so the more the ring is in focus. */
  private hitRadius(lane: Lane, step: Step): number {
    const share = (step.pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
    const resting = Math.max(lane.low, Math.min(lane.high, lane.middle + (share - 1 / 3) * lane.thickness * 0.4));
    return lerp(resting, lerp(lane.low, lane.high, share), lane.focus);
  }

  /**
   * Where the acid machine slides from one note into the next, a stroke leads
   * from the one to the other across the place where the next begins: the
   * way the pitch goes.
   */
  private drawSlides(frame: Frame, lane: Lane): void {
    const { track, pattern } = lane;
    const project = this.app.project;
    const sound = project.tracks[track]?.sound;
    if (sound !== ACID_SOUND) return;
    const context = this.context;
    const { center } = frame.geometry;
    const wide = TAU / pattern.len;
    const stepSeconds = 15 / project.bpm;
    for (let index = 0; index < pattern.len; index += 1) {
      if (!slidesInto(pattern, index, sound, stepSeconds)) continue;
      const next = nextHit(pattern, index);
      if (!next) continue;
      const from = this.hitRadius(lane, stepAt(pattern, index));
      const to = this.hitRadius(lane, stepAt(pattern, next.index));
      const at = TOP + next.index * wide;
      const lean = Math.min(wide * 0.38, 7 / Math.max(from, to));
      context.beginPath();
      context.moveTo(center + Math.cos(at - lean) * from, center + Math.sin(at - lean) * from);
      context.lineTo(center + Math.cos(at + lean) * to, center + Math.sin(at + lean) * to);
      context.lineWidth = 2.6;
      context.lineCap = "round";
      context.strokeStyle = this.palette.ink;
      context.globalAlpha = 0.35 + 0.65 * lane.focus;
      context.stroke();
      context.globalAlpha = 1;
      context.lineCap = "butt";
    }
  }

  /** The ring in focus gets a line around it. */
  private drawFocusLine(center: number, lane: Lane): void {
    if (lane.focus <= 0.05) return;
    const context = this.context;
    context.globalAlpha = lane.focus;
    context.strokeStyle = this.palette.ink;
    context.lineWidth = 1.5;
    for (const radius of [lane.band.inner, lane.band.outer]) {
      context.beginPath();
      context.arc(center, center, radius, 0, TAU);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  /** The runner of a ring. At a start it grows out of the middle, at a stop it fades where it stood. */
  private drawRunner(frame: Frame, lane: Lane): void {
    const { playhead, sinceToggle } = frame;
    const { center } = frame.geometry;
    const { band, cell, thickness } = lane;
    const length = lane.pattern.len;
    const context = this.context;
    const { ink } = this.palette;
    const head = playhead ?? (sinceToggle < RUNNER_OUT && !this.app.playing ? this.lastHead : null);
    if (head === null) return;
    const angle = TOP + ((head % length) / length) * TAU;
    const reach = playhead !== null && sinceToggle < RUNNER_IN ? rest(sinceToggle / RUNNER_IN) : 1;
    const end = band.inner + 1 + (thickness - 2) * reach;
    context.strokeStyle = ink;
    context.lineWidth = 2.5;
    if (frame.show && playhead !== null) {
      // With the light show on the runner draws a wake behind it: a wedge that thins out.
      const slice = cell * 0.07;
      context.fillStyle = ink;
      for (let wake = 0; wake < 10; wake += 1) {
        this.sector(band.inner + 1, end, angle - (wake + 1) * slice, angle - wake * slice + 0.002);
        context.globalAlpha = 0.17 * (1 - wake / 10) ** 1.5;
        context.fill();
      }
    }
    context.globalAlpha = playhead === null ? 1 - sinceToggle / RUNNER_OUT : 1;
    context.beginPath();
    context.moveTo(center + Math.cos(angle) * (band.inner + 1), center + Math.sin(angle) * (band.inner + 1));
    context.lineTo(center + Math.cos(angle) * end, center + Math.sin(angle) * end);
    context.stroke();
    context.globalAlpha = 1;
  }

  /** What the mouse or the keyboard points at on a ring. */
  private drawPointers(center: number, lane: Lane): void {
    const context = this.context;
    const app = this.app;
    const { track, band, cell } = lane;
    const hover = this.gestures.hover;
    const pointed = hover?.kind === "ring" && hover.track === track ? hover.step : null;
    const cursor = track === app.selected && !app.piece.focused ? app.keyCursor : null;
    for (const [step, dashed] of [[pointed, false], [cursor, true]] as const) {
      if (step === null || step >= lane.pattern.len) continue;
      this.sector(band.inner + 1, band.outer - 1, TOP + step * cell, TOP + (step + 1) * cell);
      context.strokeStyle = this.palette.ink;
      context.lineWidth = dashed ? 2 : 1.25;
      context.globalAlpha = dashed ? 0.9 : 0.5;
      if (dashed) context.setLineDash([4, 3]);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }
  }

  /** The chords around the hub, one bar each. */
  private drawChords(frame: Frame): void {
    const { scene, playhead, calm, now } = frame;
    const { center, chordIn, chordOut } = frame.geometry;
    const context = this.context;
    const app = this.app;
    const { bg, ink } = this.palette;
    const chords = scene.chords;
    const playingBar = playhead === null ? -1 : chords.indexOf(chordAt(scene, playhead)) === -1 ? -1 : Math.floor(playhead / 16) % chords.length;
    const slotRadius = (chordIn + chordOut) / 2;
    const fontSize = Math.max(9, Math.min(15, (chordOut - chordIn) * 0.42));
    context.font = `700 ${fontSize}px ${this.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    chords.forEach((chord, slot) => {
      const pad = chords.length > 1 ? 2 / slotRadius : 0;
      const from = TOP + (slot / chords.length) * TAU + pad;
      const to = TOP + ((slot + 1) / chords.length) * TAU - pad;
      const active = slot === playingBar;
      const pointed = this.gestures.hover?.kind === "chord" && this.gestures.hover.index === slot;
      // The bar that plays lights up at once and dims slowly when the next one takes over.
      const before = this.lit[slot] ?? 0;
      const glow = calm ? (active ? 1 : 0) : approach(before, active ? 1 : 0, active ? 0.5 : 0.2);
      this.lit[slot] = glow;
      if (glow !== before) this.live(now, 0.1);
      this.sector(chordIn, chordOut, from, to);
      context.fillStyle = ink;
      context.globalAlpha = lerp(pointed || app.chords.openSlot === slot ? 0.2 : 0.09, 1, glow);
      context.fill();
      context.globalAlpha = 1;
      if (app.chords.openSlot === slot) {
        context.strokeStyle = ink;
        context.lineWidth = 1.5;
        context.stroke();
      }
      const angle = (from + to) / 2;
      context.fillStyle = glow > 0.5 ? bg : ink;
      context.fillText(chordName(app.project.root, app.project.scale, chord), center + Math.cos(angle) * slotRadius, center + Math.sin(angle) * slotRadius + 0.5);
    });
  }

  /**
   * The hub: start and stop, breathing with the music. It rises a little under the pointer, and at a start or a
   * stop it gives way like a pressed button and hops back.
   */
  private drawHub(frame: Frame): void {
    const { calm, sinceToggle } = frame;
    const { center, hub } = frame.geometry;
    const context = this.context;
    const app = this.app;
    const { bg, ink } = this.palette;
    const pulse = calm ? 0 : Math.min(0.07, app.level() * 0.09);
    const press = sinceToggle < HUB_PRESS ? 1 - 0.09 * (1 - hop(sinceToggle / HUB_PRESS)) : 1;
    const size = hub * (1 + pulse) * (1 + 0.035 * this.lift) * press;
    context.beginPath();
    context.arc(center, center, size, 0, TAU);
    context.fillStyle = ink;
    context.fill();
    // It is a knob: light falls on it from the upper left.
    const dome = context.createRadialGradient(center - size * 0.36, center - size * 0.42, size * 0.05, center, center, size);
    dome.addColorStop(0, "rgba(255, 255, 255, 0.3)");
    dome.addColorStop(0.55, "rgba(255, 255, 255, 0)");
    dome.addColorStop(1, "rgba(0, 0, 0, 0.24)");
    context.fillStyle = dome;
    context.fill();
    if (this.lift > 0.01) {
      context.lineWidth = 3 * this.lift;
      context.strokeStyle = TRACK_INFO[TRACK_KINDS[app.selected] ?? "kick"].color;
      context.stroke();
    }
    this.drawTurns(center, size);
    context.fillStyle = bg;
    // The sign for start or stop is stamped in anew when it changes.
    const icon = hub * 0.42 * (sinceToggle < HUB_PRESS ? hop(sinceToggle / HUB_PRESS) : 1);
    // While a voice sings, the hub is its mouth.
    const mouth = app.voice.mouth();
    if (mouth && mouth.amount > 0.02) drawMouth(context, center, center, hub * 0.62, mouth, bg, ink);
    context.beginPath();
    if (mouth && mouth.amount > 0.02) {
      // (The mouth has taken the icon's place.)
    } else if (app.playing) {
      context.roundRect(center - icon * 0.82, center - icon * 0.82, icon * 1.64, icon * 1.64, icon * 0.2);
    } else {
      context.moveTo(center - icon * 0.62, center - icon);
      context.lineTo(center + icon * 1.05, center);
      context.lineTo(center - icon * 0.62, center + icon);
      context.closePath();
    }
    context.fill();
  }

  /** Reihum: every turn left a ring in the hub, like a tree's, the newest outermost, each in its person's colour. */
  private drawTurns(center: number, size: number): void {
    const context = this.context;
    const relay = this.app.relay;
    const turns = relay.round?.turns.length ?? 0;
    if (!relay.round || turns === 0) return;
    const width = Math.min(size * 0.085, (size * 0.44) / turns);
    context.lineCap = "butt";
    for (let turn = 0; turn < turns; turn += 1) {
      const radius = size - width * 0.5 - 1.5 - (turns - 1 - turn) * width;
      const looked = relay.lookBack === turn;
      context.strokeStyle = turnColor(relay.round, turn);
      context.lineWidth = Math.max(1, width - 1);
      context.globalAlpha = relay.lookBack === null || looked ? 1 : 0.35;
      context.beginPath();
      context.arc(center, center, radius, 0, TAU);
      context.stroke();
      if (looked) {
        context.globalAlpha = 1;
        context.strokeStyle = this.palette.bg;
        context.lineWidth = 1.25;
        for (const edge of [radius - width / 2, radius + width / 2]) {
          context.beginPath();
          context.arc(center, center, edge, 0, TAU);
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;
    context.lineCap = "round";
  }

  /** The wheel is one thing: a line around it, light from the upper left on all that lies on it, and the light show above. */
  private drawRim(frame: Frame): void {
    const context = this.context;
    const { center, hub, radius } = frame.geometry;
    const { ink } = this.palette;
    const rim = radius + 1;
    context.strokeStyle = ink;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(center, center, rim, 0, TAU);
    context.stroke();
    const sheen = context.createLinearGradient(center - rim * 0.7, center - rim * 0.7, center + rim * 0.7, center + rim * 0.7);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    sheen.addColorStop(0.45, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.6, "rgba(0, 0, 0, 0)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.13)");
    context.globalCompositeOperation = "source-atop";
    context.fillStyle = sheen;
    context.beginPath();
    context.arc(center, center, rim, 0, TAU);
    context.fill();
    context.globalCompositeOperation = "source-over";
    if (frame.show) this.lights.draw(context, frame.now, center, hub, radius, ink);
  }

  /** The weather brush: as wide as it paints, in the colour of its weather. */
  private drawBrush(): void {
    const weather = this.app.weather;
    const at = this.gestures.brushAt;
    if (!weather.focused || !at) return;
    const context = this.context;
    const { ink } = this.palette;
    context.beginPath();
    context.arc(at.x, at.y, BRUSH[weather.cloudSize] ?? 18, 0, TAU);
    context.fillStyle = WEATHER_COLORS[weather.cloud] ?? ink;
    context.globalAlpha = 0.22;
    context.fill();
    context.globalAlpha = 0.8;
    context.strokeStyle = ink;
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  /** A small mark where every ring begins. It hops on the one of every bar. */
  private drawMark(frame: Frame): void {
    const context = this.context;
    const { playhead, calm } = frame;
    const { center, piece } = frame.geometry;
    const outer = piece.outer + (playhead !== null && !calm ? Math.max(0, 1 - (playhead % 16) / 1.6) ** 2 * 2.5 : 0);
    context.fillStyle = this.palette.ink;
    context.beginPath();
    context.moveTo(center, center - outer - 1.5);
    context.lineTo(center - 4.5, center - outer - 8.5);
    context.lineTo(center + 4.5, center - outer - 8.5);
    context.closePath();
    context.fill();
  }

  /** The piece's ring: a bar chart bent into a circle, with the lines at which the rings come in. */
  private drawPiece(geometry: Geometry, playing: boolean): void {
    const context = this.context;
    const piece = this.app.project.piece;
    const { center } = geometry;
    const { inner, outer, base } = geometry.piece;
    const count = piece.tension.length;
    const shape: PieceShape = {
      center,
      inner,
      outer,
      base,
      count,
      cell: TAU / count,
      focus: Math.max(0, Math.min(1, ((this.weights[PIECE] ?? PIECE_REST) - PIECE_REST) / (FOCUS - PIECE_REST))),
      middle: (inner + outer) / 2,
      span: outer - base,
    };

    context.lineCap = "butt";
    context.lineWidth = outer - inner;
    context.strokeStyle = this.palette.ink;
    context.globalAlpha = 0.05 + shape.focus * 0.04;
    context.beginPath();
    context.arc(center, center, shape.middle, 0, TAU);
    context.stroke();

    this.drawTension(shape);
    if (shape.focus > 0.25) this.drawPieceScenes(shape);
    this.drawPieceLines(shape);
    this.drawPieceMark(shape, playing);
    this.drawPiecePointers(shape);
  }

  /**
   * The tension, bar by bar, as a stack of the rings that play there: each ring's colour from the height at which
   * it comes in up to the next one's. A piece that is switched off is only hinted at.
   */
  private drawTension(shape: PieceShape): void {
    const context = this.context;
    const piece = this.app.project.piece;
    const { base, count, cell, middle, span } = shape;
    const { ink } = this.palette;
    const pad = count > 72 ? 0 : Math.min(cell * 0.12, 0.7 / middle);
    const places = piece.order.length;
    context.globalAlpha = piece.on ? 1 : 0.3;
    piece.tension.forEach((tension, bar) => {
      if (tension <= 0) return;
      const height = tension / TENSION_MAX;
      const from = TOP + bar * cell + pad;
      const to = TOP + (bar + 1) * cell - pad;
      // Below the first ring's line nothing plays yet: a pale foot.
      this.sector(base, base + span * Math.min(height, entry(0)), from, to);
      context.fillStyle = ink;
      context.globalAlpha = (piece.on ? 1 : 0.3) * 0.35;
      context.fill();
      context.globalAlpha = piece.on ? 1 : 0.3;
      for (let place = 0; place < places; place += 1) {
        const low = entry(place);
        if (height <= low) break;
        const high = place === places - 1 ? 1 : entry(place + 1);
        this.sector(base + span * low, base + span * Math.min(height, high), from, to);
        context.fillStyle = trackInfo(piece.order[place] ?? 0).color;
        context.fill();
      }
    });
    context.globalAlpha = 1;
  }

  /** In focus: faint lines where the next rings would come in, and the scenes along the inner edge. */
  private drawPieceScenes(shape: PieceShape): void {
    const context = this.context;
    const piece = this.app.project.piece;
    const { center, inner, base, count, cell, focus, middle, span } = shape;
    const { ink } = this.palette;
    const places = piece.order.length;
    context.lineWidth = 1;
    context.strokeStyle = ink;
    context.globalAlpha = focus * 0.13;
    for (let place = 0; place < places; place += 1) {
      context.beginPath();
      context.arc(center, center, base + span * entry(place), 0, TAU);
      context.stroke();
    }
    context.globalAlpha = 1;
    const lane = base - inner;
    if (lane > 5) {
      context.font = `700 ${Math.max(8, Math.min(11, lane * 0.8))}px ${this.font}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      let start = 0;
      for (let bar = 1; bar <= count; bar += 1) {
        if (bar < count && piece.scenes[bar] === piece.scenes[start]) continue;
        const from = TOP + start * cell;
        const to = TOP + bar * cell;
        this.sector(inner + 1, base - 1.5, from + 1 / middle, to - 1 / middle);
        context.fillStyle = ink;
        context.globalAlpha = focus * ((piece.scenes[start] ?? 0) % 2 === 0 ? 0.14 : 0.3);
        context.fill();
        if ((to - from) * middle > 16) {
          const angle = (from + to) / 2;
          const radius = (inner + base) / 2;
          context.globalAlpha = focus;
          context.fillText(SCENE_NAMES[piece.scenes[start] ?? 0] ?? "", center + Math.cos(angle) * radius, center + Math.sin(angle) * radius + 0.5);
        }
        start = bar;
      }
      context.globalAlpha = 1;
    }
  }

  /** Every fourth bar a line, every sixteenth a stronger one; and in focus a line around the ring. */
  private drawPieceLines(shape: PieceShape): void {
    const context = this.context;
    const { center, inner, outer, count, cell, focus } = shape;
    const { bg, ink } = this.palette;
    context.strokeStyle = bg;
    for (let bar = 0; bar < count; bar += 4) {
      const angle = TOP + bar * cell;
      context.lineWidth = bar % 16 === 0 ? 2 : 1;
      context.beginPath();
      context.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
      context.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
      context.stroke();
    }
    context.lineCap = "round";

    if (focus > 0.05) {
      context.globalAlpha = focus;
      context.strokeStyle = ink;
      context.lineWidth = 1.5;
      for (const radius of [inner, outer]) {
        context.beginPath();
        context.arc(center, center, radius, 0, TAU);
        context.stroke();
      }
      context.globalAlpha = 1;
    }
  }

  /** Where the piece is, or where it will start. */
  private drawPieceMark(shape: PieceShape, playing: boolean): void {
    const context = this.context;
    const app = this.app;
    const piece = app.project.piece;
    const { center, inner, outer, count } = shape;
    const { ink } = this.palette;
    const at = app.piece.playhead();
    const mark = at ?? (piece.on ? app.piece.start : null);
    if (mark !== null) {
      const angle = TOP + ((mark % count) / count) * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      context.strokeStyle = ink;
      context.fillStyle = ink;
      context.lineWidth = 2.5;
      context.globalAlpha = at === null ? 0.45 : 1;
      context.beginPath();
      context.moveTo(center + cos * (inner + 1), center + sin * (inner + 1));
      context.lineTo(center + cos * (outer - 1), center + sin * (outer - 1));
      context.stroke();
      if (playing || at === null) {
        context.beginPath();
        context.arc(center + cos * outer, center + sin * outer, 3.5, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;
    }
  }

  /** What the mouse or the keyboard points at on the piece's ring. */
  private drawPiecePointers(shape: PieceShape): void {
    const context = this.context;
    const app = this.app;
    const { inner, outer, count, cell } = shape;
    const { ink } = this.palette;
    const pointed = this.gestures.hover?.kind === "piece" ? this.gestures.hover.bar : null;
    const cursor = app.piece.focused ? app.piece.key : null;
    for (const [bar, dashed] of [[pointed, false], [cursor, true]] as const) {
      if (bar === null || bar >= count) continue;
      this.sector(inner + 1, outer - 1, TOP + bar * cell, TOP + (bar + 1) * cell);
      context.strokeStyle = ink;
      context.lineWidth = dashed ? 2 : 1.25;
      context.globalAlpha = dashed ? 0.9 : 0.5;
      if (dashed) context.setLineDash([4, 3]);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }
  }

  // ---- pointing ---------------------------------------------------------------

  point(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const scale = this.size / Math.max(1, box.width);
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  }

  /** The angle of a point as a share of the circle, 0 at twelve o'clock, clockwise. */
  turn(x: number, y: number): number {
    const { center } = this.geometry();
    const angle = Math.atan2(y - center, x - center) - TOP;
    return wrap(angle, TAU) / TAU;
  }

  stepOf(track: number, x: number, y: number): number {
    const length = currentScene(this.app.project).patterns[track]?.len ?? 16;
    return Math.min(length - 1, Math.floor(this.turn(x, y) * length));
  }

  locate(x: number, y: number): Spot | null {
    const geometry = this.geometry();
    const distance = Math.hypot(x - geometry.center, y - geometry.center);
    if (distance <= geometry.hub + 2) return { kind: "hub" };
    if (distance <= geometry.chordOut + geometry.gap) {
      const count = currentScene(this.app.project).chords.length;
      return { kind: "chord", index: Math.min(count - 1, Math.floor(this.turn(x, y) * count)) };
    }
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const band = geometry.rings[track];
      if (band && distance >= band.inner - geometry.gap / 2 && distance <= band.outer + geometry.gap / 2) {
        return { kind: "ring", track, step: this.stepOf(track, x, y) };
      }
    }
    const band = geometry.piece;
    if (distance >= band.inner - geometry.gap / 2 && distance <= geometry.center) {
      const count = this.app.project.piece.tension.length;
      const height = Math.max(0, Math.min(1, (distance - band.base) / Math.max(1, band.outer - band.base)));
      return { kind: "piece", bar: Math.min(count - 1, Math.floor(this.turn(x, y) * count)), height, lane: distance < band.base - 0.5 };
    }
    return null;
  }

  /**
   * The weather over one ring: every cell that has some is drawn in the way of its kind (fog and sun as a veil, clouds
   * as puffs, rain as strokes, sparks as stars, hail as grains), the more the stronger. With a wind the cells are
   * drawn where it has carried them by now.
   */
  private drawWeather(scene: Scene, track: number, length: number, center: number, band: { inner: number; outer: number }, playhead: number | null): void {
    const context = this.context;
    const cell = TAU / length;
    const thickness = band.outer - band.inner;
    const middle = (band.inner + band.outer) / 2;
    // In focus the weather is what one looks at; otherwise it stays behind the hits.
    const strong = this.app.weather.focused ? 1 : 0.6;
    const point = (radius: number, angle: number): [number, number] => [center + Math.cos(angle) * radius, center + Math.sin(angle) * radius];
    for (let kind = 0; kind < scene.weather.length; kind += 1) {
      const line = scene.weather[kind]?.[track];
      if (!line) continue;
      const drift = windDrift(playhead ?? 0, scene.wind[kind] ?? 0);
      const color = WEATHER_COLORS[kind] ?? this.palette.ink;
      for (let index = 0; index < length; index += 1) {
        const value = line[index] ?? 0;
        if (value === 0) continue;
        const share = value / WEATHER_MAX;
        const from = TOP + (index + drift) * cell;
        const mid = from + cell / 2;
        context.fillStyle = color;
        context.strokeStyle = color;
        if (kind < 2) {
          // Fog and sun lie over the whole cell: fog as a veil with streaks in it, sun as a glow with a bright rim.
          this.sector(band.inner + 1, band.outer - 1, from, from + cell);
          context.globalAlpha = (0.22 + 0.5 * share) * strong;
          context.fill();
          context.lineWidth = Math.max(1.2, thickness * 0.07);
          context.globalAlpha = (0.5 + 0.5 * share) * strong;
          for (const radius of kind === 0 ? [band.inner + thickness * 0.3, band.inner + thickness * 0.7] : [band.outer - 2]) {
            context.beginPath();
            context.arc(center, center, radius, from + cell * 0.08, from + cell * 0.92);
            context.stroke();
          }
        } else if (kind === 2) {
          // Clouds: two pale puffs with a line around them.
          const size = Math.max(2.5, Math.min(thickness * 0.3, middle * cell * 0.32)) * (0.7 + 0.3 * share);
          context.lineWidth = 1.2;
          for (const [radius, angle] of [[middle + thickness * 0.12, mid - cell * 0.16], [middle - thickness * 0.12, mid + cell * 0.16]] as const) {
            const [x, y] = point(radius, angle);
            context.beginPath();
            context.arc(x, y, size, 0, TAU);
            context.fillStyle = this.palette.paper;
            context.globalAlpha = (0.55 + 0.45 * share) * strong;
            context.fill();
            context.strokeStyle = this.palette.ink;
            context.globalAlpha = (0.35 + 0.5 * share) * strong;
            context.stroke();
          }
        } else if (kind === 3) {
          // Rain: slanted strokes from the outside in.
          context.lineWidth = Math.max(1.6, thickness * 0.09);
          context.globalAlpha = (0.5 + 0.5 * share) * strong;
          for (const offset of [-0.28, 0, 0.28]) {
            const [x1, y1] = point(band.outer - thickness * 0.18, mid + cell * offset - cell * 0.1);
            const [x2, y2] = point(band.inner + thickness * 0.18, mid + cell * offset + cell * 0.1);
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.stroke();
          }
        } else if (kind === 4) {
          // Sparks: a small star.
          const size = Math.max(4, Math.min(thickness * 0.44, middle * cell * 0.42)) * (0.7 + 0.3 * share);
          const [x, y] = point(middle, mid);
          context.globalAlpha = (0.6 + 0.4 * share) * strong;
          context.beginPath();
          for (let spike = 0; spike < 8; spike += 1) {
            const reach = spike % 2 === 0 ? size : size * 0.38;
            const turn = mid + (spike / 8) * TAU;
            if (spike === 0) context.moveTo(x + Math.cos(turn) * reach, y + Math.sin(turn) * reach);
            else context.lineTo(x + Math.cos(turn) * reach, y + Math.sin(turn) * reach);
          }
          context.closePath();
          context.fill();
          context.lineWidth = 1;
          context.strokeStyle = this.palette.ink;
          context.stroke();
        } else {
          // Hail: grains.
          const size = Math.max(1.9, thickness * 0.1) * (0.7 + 0.5 * share);
          context.globalAlpha = (0.45 + 0.55 * share) * strong;
          for (const [radius, offset] of [[middle + thickness * 0.22, -0.25], [middle - thickness * 0.2, 0], [middle + thickness * 0.05, 0.27]] as const) {
            const [x, y] = point(radius, mid + cell * offset);
            context.beginPath();
            context.arc(x, y, size, 0, TAU);
            context.fill();
          }
        }
      }
    }
    context.globalAlpha = 1;
  }

  /** Where on the page a share of the Nachbeben is painted at a step of the kick's ring: for the browser tests. */
  rumblePosition(step: number, share: number): { x: number; y: number } {
    const { center, rings } = this.geometry();
    const band = rings[0] ?? { inner: 0, outer: 1 };
    const length = currentScene(this.app.project).patterns[0]?.len ?? 16;
    const angle = TOP + ((step + 0.5) / length) * TAU;
    const radius = band.inner + (0.12 + 0.76 * share) * (band.outer - band.inner);
    const box = this.canvas.getBoundingClientRect();
    const scale = box.width / Math.max(1, this.size);
    return { x: box.left + (center + Math.cos(angle) * radius) * scale, y: box.top + (center + Math.sin(angle) * radius) * scale };
  }

  /** The Nachbeben: a dark mass at the inner edge of the kick's ring, as high as the ground shakes, pushed down by every kick. */
  private drawRumble(line: readonly number[], pattern: Pattern, center: number, band: { inner: number; outer: number }, focus: number, audible: boolean, playhead: number | null): void {
    const length = pattern.len;
    if (!line.slice(0, length).some((value) => value > 0)) return;
    const context = this.context;
    const reach = (band.outer - band.inner) * lerp(0.62, 0.86, focus);
    const cell = TAU / length;
    const at = playhead === null ? -1 : playhead % length;
    const now = performance.now() / 1000;
    const parts = 4;
    context.beginPath();
    for (let index = 0; index <= length * parts; index += 1) {
      const place = index / parts;
      const step = Math.floor(place) % length;
      const within = place - Math.floor(place);
      // The line runs from the middle of one step to the middle of the next.
      const here = line[step] ?? 0;
      const beside = (within < 0.5 ? line[(step - 1 + length) % length] : line[(step + 1) % length]) ?? 0;
      const lean = Math.abs(within - 0.5);
      let share = (here * (1 - lean) + beside * lean) / RUMBLE_MAX;
      // A kick pushes it away and lets it come back within its step.
      if (stepAt(pattern, step).on) share *= 0.08 + 0.92 * within ** 1.5;
      let height = share * reach;
      if (at >= 0 && share > 0) {
        // Where the Kreisel is right now, the ground is seen to shake.
        let away = Math.abs(place - at);
        away = Math.min(away, length - away);
        if (away < 1.6 && !this.calm.matches) height += Math.sin(now * 46 + index * 1.7) * 1.8 * (1 - away / 1.6) * Math.min(1, share * 2);
      }
      const angle = TOP + place * cell;
      const radius = band.inner + Math.max(0, height);
      if (index === 0) context.moveTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
      else context.lineTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
    }
    context.strokeStyle = this.palette.ink;
    context.fillStyle = this.palette.ink;
    context.lineWidth = 1.5;
    context.globalAlpha = audible ? 0.75 : 0.3;
    context.stroke();
    context.arc(center, center, band.inner, TOP + TAU, TOP, true);
    context.closePath();
    context.globalAlpha = audible ? 0.38 : 0.15;
    context.fill();
    context.globalAlpha = 1;
  }
}

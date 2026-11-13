import { currentScene, MAX_NOTE_LENGTH, PITCH_MAX, PITCH_MIN, stepAt, TRACK_COUNT, TRACK_INFO, TRACK_KINDS, trackInfo, type Project, type Step } from "../model";
import { chordAt, chordName, pitchName } from "../music";

/*
 * The Kreisel itself: seven rings on a canvas, a ring of chords and the hub
 * in the middle. Step 1 is at twelve o'clock, time runs clockwise. The ring
 * in focus is wider, and its steps sit further out the higher they sound.
 * Painting, erasing, bending pitch and turning a ring all happen here.
 */

export type Tool = "setzen" | "betonen" | "zufall" | "wirbel" | "laenge";

/** What the ring view needs from the app. */
export interface RingHost {
  readonly project: Project;
  readonly selected: number;
  readonly tool: Tool;
  /** The step the keyboard cursor is on, or `null` while the mouse is in charge. */
  readonly keyCursor: number | null;
  /** The chord slot whose menu is open. */
  readonly openSlot: number | null;
  readonly playing: boolean;
  /** Steps since the scene began, with fractions; `null` when nothing plays. */
  playhead(): number | null;
  /** Seconds since ring `track` last struck. */
  sinceStruck(track: number): number;
  level(): number;
  audible(track: number): boolean;
  wake(): void;
  togglePlay(): void;
  select(track: number, step?: number): void;
  openChord(slot: number): void;
  addNote(track: number, step: number, values: Partial<Step>, gesture: string): void;
  removeNote(track: number, step: number, gesture: string): void;
  setPitch(track: number, step: number, pitch: number, gesture: string): void;
  setLength(track: number, step: number, length: number, gesture: string): void;
  /** Moves a step's accent, chance or roll one on and returns the new value. */
  bump(track: number, step: number, tool: Tool, gesture: string): number;
  setValue(track: number, step: number, tool: Tool, value: number, gesture: string): void;
  rotate(track: number, by: number): void;
  endGesture(): void;
}

type Spot = { kind: "hub" } | { kind: "chord"; index: number } | { kind: "ring"; track: number; step: number };

interface Drag {
  pointer: number;
  track: number;
  /** The step the gesture began on, and the last one it reached. */
  origin: number;
  last: number;
  /** Steps travelled clockwise since the start (for note lengths). */
  travel: number;
  /** Distance from the hub and share of the circle at the start, for bending pitch. */
  distance: number;
  turn: number;
  tool: Tool;
  mode: "pending" | "paint" | "erase" | "pitch" | "value";
  existed: boolean;
  pitch: number;
  value: number;
  gesture: string;
}

interface Palette {
  bg: string;
  ink: string;
  paper: string;
}

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const FOCUS = 3.1;
const CHANCE_ALPHA = [1, 0.72, 0.48, 0.28] as const;
const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

export class RingView {
  private readonly context: CanvasRenderingContext2D;
  private size = 0;
  private readonly weights: number[] = Array.from({ length: TRACK_COUNT }, () => 1);
  private dirty = true;
  private drag: Drag | null = null;
  private gestures = 0;
  private wheelRest = 0;
  private hover: Spot | null = null;
  private palette: Palette = { bg: "#f4ecdd", ink: "#2a2233", paper: "#fffaf0" };
  private font = "system-ui, sans-serif";
  private readonly calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly canvas: HTMLCanvasElement, private readonly host: RingHost, private readonly tip: HTMLElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    this.context = context;
    this.weights[host.selected] = FOCUS;
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    canvas.addEventListener("pointerleave", () => this.leave());
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
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

  invalidate(): void {
    this.dirty = true;
  }

  /** Where a chord slot is on the page, for its menu. */
  slotPosition(slot: number): { x: number; y: number } {
    const geometry = this.geometry();
    const count = currentScene(this.host.project).chords.length;
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
    const length = currentScene(this.host.project).patterns[track]?.len ?? 16;
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

  private geometry(): { center: number; radius: number; hub: number; chordIn: number; chordOut: number; gap: number; rings: { inner: number; outer: number }[] } {
    const center = this.size / 2;
    const radius = center - Math.max(9, this.size * 0.028);
    const hub = radius * 0.165;
    const chordIn = hub + Math.max(4, radius * 0.022);
    const chordOut = radius * 0.31;
    const gap = Math.max(2, radius * 0.011);
    const start = chordOut + gap * 2.5;
    const room = radius - start - gap * (TRACK_COUNT - 1);
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    let at = start;
    const rings = this.weights.map((weight) => {
      const inner = at;
      const outer = at + (room * weight) / total;
      at = outer + gap;
      return { inner, outer };
    });
    return { center, radius, hub, chordIn, chordOut, gap, rings };
  }

  // ---- drawing ----------------------------------------------------------------

  private frame(): void {
    let moving = false;
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const target = track === this.host.selected ? FOCUS : 1;
      const now = this.weights[track] ?? 1;
      if (Math.abs(target - now) > 0.004) {
        this.weights[track] = this.calm.matches ? target : lerp(now, target, 0.24);
        moving = true;
      } else {
        this.weights[track] = target;
      }
    }
    const flashing = Array.from({ length: TRACK_COUNT }, (_, track) => this.host.sinceStruck(track)).some((since) => since < 0.4);
    if (!this.dirty && !moving && !this.host.playing && !flashing) return;
    this.dirty = false;
    this.draw();
  }

  private sector(inner: number, outer: number, from: number, to: number): void {
    const center = this.size / 2;
    const context = this.context;
    context.beginPath();
    context.arc(center, center, outer, from, to);
    context.arc(center, center, inner, to, from, true);
    context.closePath();
  }

  private draw(): void {
    const context = this.context;
    const host = this.host;
    const geometry = this.geometry();
    const { center, hub, chordIn, chordOut } = geometry;
    const { bg, ink } = this.palette;
    const scene = currentScene(host.project);
    const playhead = host.playhead();
    context.clearRect(0, 0, this.size, this.size);
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const band = geometry.rings[track];
      const pattern = scene.patterns[track];
      if (!band || !pattern) continue;
      const info = trackInfo(track);
      const length = pattern.len;
      const cell = TAU / length;
      const thickness = band.outer - band.inner;
      const middle = (band.inner + band.outer) / 2;
      const focus = Math.max(0, Math.min(1, ((this.weights[track] ?? 1) - 1) / (FOCUS - 1)));
      const audible = host.audible(track);
      const since = host.sinceStruck(track);
      const flash = host.playing || since < 0.4 ? Math.max(0, 1 - since / 0.24) : 0;

      // The band, a little stronger for every second beat so the eye finds its way.
      context.lineCap = "butt";
      context.lineWidth = thickness;
      context.strokeStyle = audible ? info.color : ink;
      context.globalAlpha = (audible ? 0.15 : 0.07) + focus * 0.09 + flash * 0.05;
      context.beginPath();
      context.arc(center, center, middle, 0, TAU);
      context.stroke();
      context.globalAlpha = audible ? 0.1 : 0.04;
      for (let beat = 1; beat * 4 < length + 3; beat += 2) {
        const from = TOP + beat * 4 * cell;
        const to = TOP + Math.min(length, beat * 4 + 4) * cell;
        if (to <= from) continue;
        context.beginPath();
        context.arc(center, center, middle, from, to);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.lineCap = "round";

      // Step lines: every step on the ring in focus, only the beats on the others.
      context.strokeStyle = bg;
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

      // The hits.
      const tile = lerp(thickness * 0.74, Math.max(8, thickness * 0.23), focus);
      const low = band.inner + tile / 2 + 2;
      const high = band.outer - tile / 2 - 2;
      const current = playhead === null ? -1 : Math.floor(playhead) % length;
      for (let index = 0; index < length; index += 1) {
        const step = stepAt(pattern, index);
        if (!step.on) continue;
        const share = (step.pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN);
        const resting = Math.max(low, Math.min(high, middle + (share - 1 / 3) * thickness * 0.4));
        const radius = lerp(resting, lerp(low, high, share), focus);
        const struck = index === current ? flash : 0;
        const half = (tile * (step.vel === 0 ? 0.55 : 1)) / 2 + struck * 2;
        const inner = Math.max(band.inner + 1, radius - half);
        const outer = Math.min(band.outer - 1, radius + half);
        const count = Math.max(1, step.ratchet);
        const held = info.melodic && count === 1 ? Math.min(step.len, length) : 1;
        const span = (held * cell) / count;
        const pad = Math.min(span * 0.22, 1.6 / radius);
        for (let repeat = 0; repeat < count; repeat += 1) {
          const from = TOP + index * cell + repeat * span + pad;
          const to = TOP + index * cell + (repeat + 1) * span - pad;
          this.sector(inner, outer, from, to);
          context.globalAlpha = (CHANCE_ALPHA[step.chance] ?? 1) * (audible ? 1 : 0.4);
          context.fillStyle = audible ? info.color : ink;
          context.fill();
          context.globalAlpha = 1;
          if (step.chance > 0) {
            context.setLineDash([3, 3]);
            context.lineWidth = 1.5;
            context.strokeStyle = audible ? info.color : ink;
            context.stroke();
            context.setLineDash([]);
          }
          if (step.vel === 2) {
            context.lineWidth = 1.75;
            context.strokeStyle = ink;
            context.stroke();
          }
          if (struck > 0) {
            context.globalAlpha = struck * 0.55;
            context.fillStyle = "#ffffff";
            context.fill();
            context.globalAlpha = 1;
          }
        }
      }

      // The ring in focus gets a line around it.
      if (focus > 0.05) {
        context.globalAlpha = focus;
        context.strokeStyle = ink;
        context.lineWidth = 1.5;
        for (const radius of [band.inner, band.outer]) {
          context.beginPath();
          context.arc(center, center, radius, 0, TAU);
          context.stroke();
        }
        context.globalAlpha = 1;
      }

      // The runner.
      if (playhead !== null) {
        const angle = TOP + ((playhead % length) / length) * TAU;
        context.strokeStyle = ink;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(center + Math.cos(angle) * (band.inner + 1), center + Math.sin(angle) * (band.inner + 1));
        context.lineTo(center + Math.cos(angle) * (band.outer - 1), center + Math.sin(angle) * (band.outer - 1));
        context.stroke();
      }

      // What the mouse or the keyboard points at.
      const pointed = this.hover?.kind === "ring" && this.hover.track === track ? this.hover.step : null;
      const cursor = track === host.selected ? host.keyCursor : null;
      for (const [step, dashed] of [[pointed, false], [cursor, true]] as const) {
        if (step === null || step >= length) continue;
        this.sector(band.inner + 1, band.outer - 1, TOP + step * cell, TOP + (step + 1) * cell);
        context.strokeStyle = ink;
        context.lineWidth = dashed ? 2 : 1.25;
        context.globalAlpha = dashed ? 0.9 : 0.5;
        if (dashed) context.setLineDash([4, 3]);
        context.stroke();
        context.setLineDash([]);
        context.globalAlpha = 1;
      }
    }

    // The chords, one bar each.
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
      const pointed = this.hover?.kind === "chord" && this.hover.index === slot;
      this.sector(chordIn, chordOut, from, to);
      context.fillStyle = ink;
      context.globalAlpha = active ? 1 : pointed || host.openSlot === slot ? 0.2 : 0.09;
      context.fill();
      context.globalAlpha = 1;
      if (host.openSlot === slot) {
        context.strokeStyle = ink;
        context.lineWidth = 1.5;
        context.stroke();
      }
      const angle = (from + to) / 2;
      context.fillStyle = active ? bg : ink;
      context.fillText(chordName(host.project.root, host.project.scale, chord), center + Math.cos(angle) * slotRadius, center + Math.sin(angle) * slotRadius + 0.5);
    });

    // The hub: start and stop, breathing with the music.
    const pulse = this.calm.matches ? 0 : Math.min(0.07, host.level() * 0.09);
    const size = hub * (1 + pulse);
    context.beginPath();
    context.arc(center, center, size, 0, TAU);
    context.fillStyle = ink;
    context.fill();
    if (this.hover?.kind === "hub") {
      context.lineWidth = 3;
      context.strokeStyle = TRACK_INFO[TRACK_KINDS[host.selected] ?? "kick"].color;
      context.stroke();
    }
    context.fillStyle = bg;
    const icon = hub * 0.42;
    context.beginPath();
    if (host.playing) {
      context.roundRect(center - icon * 0.82, center - icon * 0.82, icon * 1.64, icon * 1.64, icon * 0.2);
    } else {
      context.moveTo(center - icon * 0.62, center - icon);
      context.lineTo(center + icon * 1.05, center);
      context.lineTo(center - icon * 0.62, center + icon);
      context.closePath();
    }
    context.fill();

    // A small mark where every ring begins.
    const outer = geometry.rings[TRACK_COUNT - 1]?.outer ?? geometry.radius;
    context.fillStyle = ink;
    context.beginPath();
    context.moveTo(center, center - outer - 1.5);
    context.lineTo(center - 4.5, center - outer - 8.5);
    context.lineTo(center + 4.5, center - outer - 8.5);
    context.closePath();
    context.fill();
  }

  // ---- pointing ---------------------------------------------------------------

  private point(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const scale = this.size / Math.max(1, box.width);
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  }

  /** The angle of a point as a share of the circle, 0 at twelve o'clock, clockwise. */
  private turn(x: number, y: number): number {
    const { center } = this.geometry();
    const angle = Math.atan2(y - center, x - center) - TOP;
    return (((angle % TAU) + TAU) % TAU) / TAU;
  }

  private stepOf(track: number, x: number, y: number): number {
    const length = currentScene(this.host.project).patterns[track]?.len ?? 16;
    return Math.min(length - 1, Math.floor(this.turn(x, y) * length));
  }

  private locate(x: number, y: number): Spot | null {
    const geometry = this.geometry();
    const distance = Math.hypot(x - geometry.center, y - geometry.center);
    if (distance <= geometry.hub + 2) return { kind: "hub" };
    if (distance <= geometry.chordOut + geometry.gap) {
      const count = currentScene(this.host.project).chords.length;
      return { kind: "chord", index: Math.min(count - 1, Math.floor(this.turn(x, y) * count)) };
    }
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      const band = geometry.rings[track];
      if (band && distance >= band.inner - geometry.gap / 2 && distance <= band.outer + geometry.gap / 2) {
        return { kind: "ring", track, step: this.stepOf(track, x, y) };
      }
    }
    return null;
  }

  private down(event: PointerEvent): void {
    const { x, y } = this.point(event);
    const spot = this.locate(x, y);
    this.host.wake();
    if (!spot) return;
    if (spot.kind === "hub") {
      this.hideTip();
      this.host.togglePlay();
      return;
    }
    if (spot.kind === "chord") {
      this.hideTip();
      this.host.openChord(spot.index);
      return;
    }
    const { track, step } = spot;
    const picked = this.host.selected === track;
    this.host.select(track, step);
    // A finger first picks the ring (the thin ones are too narrow to aim at), a mouse paints at once.
    if (event.pointerType !== "mouse" && !picked) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the stroke still works while it stays on the canvas.
    }
    const erase = event.button === 2;
    const melodic = trackInfo(track).melodic;
    const tool: Tool = erase || (this.host.tool === "laenge" && !melodic) ? "setzen" : this.host.tool;
    const pattern = currentScene(this.host.project).patterns[track];
    if (!pattern) return;
    const note = stepAt(pattern, step);
    const { center } = this.geometry();
    this.gestures += 1;
    const drag: Drag = {
      pointer: event.pointerId,
      track,
      origin: step,
      last: step,
      travel: 0,
      distance: Math.hypot(x - center, y - center),
      turn: this.turn(x, y),
      tool,
      mode: erase ? "erase" : tool === "setzen" || tool === "laenge" ? "pending" : "value",
      existed: note.on,
      pitch: note.pitch,
      value: 0,
      gesture: `zug${this.gestures}`,
    };
    if (erase) {
      if (note.on) this.host.removeNote(track, step, drag.gesture);
    } else if (tool === "setzen" || tool === "laenge") {
      if (!note.on) this.host.addNote(track, step, {}, drag.gesture);
      drag.pitch = stepAt(pattern, step).pitch;
    } else {
      drag.value = this.host.bump(track, step, tool, drag.gesture);
    }
    this.drag = drag;
    this.hideTip();
    this.dirty = true;
  }

  private move(event: PointerEvent): void {
    const { x, y } = this.point(event);
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) {
      if (event.pointerType === "mouse") this.pointAt(this.locate(x, y), event);
      return;
    }
    const pattern = currentScene(this.host.project).patterns[drag.track];
    if (!pattern) return;
    const length = pattern.len;
    const step = this.stepOf(drag.track, x, y);
    // The shortest way round from the last step to this one, walked step by step.
    let delta = step - drag.last;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    const { center } = this.geometry();
    const distance = Math.hypot(x - center, y - center);
    const outwards = distance - drag.distance;
    // How far the pointer went along the ring: a stroke across steps drifts inwards a little and must not bend the pitch.
    let turned = Math.abs(this.turn(x, y) - drag.turn);
    if (turned > 0.5) turned = 1 - turned;
    const along = turned * TAU * distance;

    if (drag.tool === "laenge") {
      drag.travel += delta;
      drag.last = step;
      this.host.setLength(drag.track, drag.origin, Math.max(1, Math.min(MAX_NOTE_LENGTH, length, drag.travel + 1)), drag.gesture);
      return;
    }
    if (drag.mode === "pending") {
      if (step !== drag.origin) {
        drag.mode = drag.existed ? "erase" : "paint";
        if (drag.mode === "erase") this.host.removeNote(drag.track, drag.origin, drag.gesture);
      } else if (Math.abs(outwards) > 6 && Math.abs(outwards) > along * 1.3) {
        drag.mode = "pitch";
      }
    }
    if (drag.mode === "pitch") {
      this.host.setPitch(drag.track, drag.origin, drag.pitch + Math.round(outwards / 7), drag.gesture);
      return;
    }
    const direction = Math.sign(delta);
    for (let walked = 0; walked !== delta; walked += direction) {
      const at = (((drag.last + walked + direction) % length) + length) % length;
      const there = stepAt(pattern, at);
      if (drag.mode === "paint" && !there.on) this.host.addNote(drag.track, at, { pitch: drag.pitch }, drag.gesture);
      else if (drag.mode === "erase" && there.on) this.host.removeNote(drag.track, at, drag.gesture);
      else if (drag.mode === "value" && there.on) this.host.setValue(drag.track, at, drag.tool, drag.value, drag.gesture);
    }
    drag.last = step;
  }

  private up(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    // A plain click on a hit takes it away again.
    if (drag.tool === "setzen" && drag.mode === "pending" && drag.existed && event.type === "pointerup") {
      this.host.removeNote(drag.track, drag.origin, drag.gesture);
    }
    this.drag = null;
    this.host.endGesture();
    this.dirty = true;
  }

  private leave(): void {
    if (this.hover) this.dirty = true;
    this.hover = null;
    this.canvas.style.cursor = "";
    this.hideTip();
  }

  private wheel(event: WheelEvent): void {
    const { x, y } = this.point(event);
    const spot = this.locate(x, y);
    if (spot?.kind !== "ring") return;
    event.preventDefault();
    this.wheelRest += event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY;
    const notches = Math.trunc(this.wheelRest / 45);
    if (notches === 0) return;
    this.wheelRest -= notches * 45;
    this.host.rotate(spot.track, notches);
  }

  private pointAt(spot: Spot | null, event: PointerEvent): void {
    const before = JSON.stringify(this.hover);
    this.hover = spot;
    if (JSON.stringify(spot) !== before) this.dirty = true;
    this.canvas.style.cursor = spot ? "pointer" : "";
    if (!spot) {
      this.hideTip();
      return;
    }
    const project = this.host.project;
    const scene = currentScene(project);
    let text: string;
    if (spot.kind === "hub") {
      text = this.host.playing ? "Anhalten (Leertaste)" : "Starten (Leertaste)";
    } else if (spot.kind === "chord") {
      text = `Takt ${spot.index + 1}: ${chordName(project.root, project.scale, scene.chords[spot.index] ?? 0)} · klicken zum Ändern`;
    } else {
      const pattern = scene.patterns[spot.track];
      const note = pattern ? stepAt(pattern, spot.step) : null;
      const info = trackInfo(spot.track);
      text = `${info.name} · Schritt ${spot.step + 1}`;
      if (note?.on) text += ` · ${pitchName(project, spot.track, note.pitch, chordAt(scene, this.host.playhead() ?? 0))}`;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    const parent = this.tip.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    this.tip.style.left = `${event.clientX - parent.left + 14}px`;
    this.tip.style.top = `${event.clientY - parent.top + 16}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }
}

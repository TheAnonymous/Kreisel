import { bildSeconds } from "../audio/bild";
import { guides, makeStroke, snapHeight, strokeAt, strokeLevel, type RawPoint } from "../bild";
import { HEIGHT_MAX, TIME_MAX, trackInfo, trackOf, type Bild, type Project, type Stroke } from "../model";

/*
 * The paint box: a sheet on which the ring's own sound is painted. Time runs
 * from left to right, pitch from bottom to top. A stroke is drawn as it
 * sounds: thick and strong where the brush was set down, thinner as the
 * paint runs out; a saw is a zigzag, a hiss a spray of dots.
 */

/** What the paint box needs from the app. */
export interface EaselHost {
  readonly project: Project;
  readonly selected: number;
  readonly easel: boolean;
  /** 0 hum, 1 saw, 2 hiss, 3 eraser. */
  readonly brush: number;
  readonly brushSize: number;
  sinceStruck(track: number): number;
  wake(): void;
  paint(drawn: readonly RawPoint[]): void;
  eraseStroke(index: number, gesture: string): void;
  setHold(value: number | null, gesture?: string): void;
  setBrushSize(size: number): void;
  endGesture(): void;
}

export interface BildStyle {
  color: string;
  ink: string;
  /** 1 on the sheet, smaller for thumbnails. */
  scale: number;
}

const WIDTHS = [3.5, 7, 11.5] as const;
const ERASER = 3;

/** A number between 0 and 1 that is always the same for the same two inputs: where the spray's dots fall. */
const scatter = (a: number, b: number): number => {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};

function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, seed: number, x: number, y: number, width: number, height: number, style: BildStyle): void {
  const count = stroke.points.length >> 1;
  if (count === 0) return;
  const brush = (WIDTHS[stroke.size] ?? 7) * style.scale;
  const at = (index: number): { px: number; py: number; t: number } => {
    const t = (stroke.points[index * 2] ?? 0) / TIME_MAX;
    return { px: x + t * width, py: y + height - ((stroke.points[index * 2 + 1] ?? 0) / HEIGHT_MAX) * height, t };
  };
  const first = at(0);
  const last = at(count - 1);
  const span = Math.max(last.t - first.t, 1e-6);
  // Points every few pixels along the stroke, each with the level the paint has there.
  const walk: { px: number; py: number; level: number }[] = [];
  const stride = Math.max(1.5, 3 * style.scale);
  if (count === 1 || (Math.abs(last.px - first.px) < 2 && Math.abs(last.py - first.py) < 2)) {
    // A dab: a short mark, as wide as it is long.
    for (let step = 0; step <= 3; step += 1) walk.push({ px: first.px + step * brush * 0.25, py: first.py, level: 1 - step / 4 });
  } else {
    for (let index = 0; index < count - 1; index += 1) {
      const from = at(index);
      const to = at(index + 1);
      const pieces = Math.max(1, Math.ceil(Math.hypot(to.px - from.px, to.py - from.py) / stride));
      for (let piece = index === 0 ? 0 : 1; piece <= pieces; piece += 1) {
        const share = piece / pieces;
        const t = from.t + (to.t - from.t) * share;
        walk.push({ px: from.px + (to.px - from.px) * share, py: from.py + (to.py - from.py) * share, level: strokeLevel(stroke, (t - first.t) / span) });
      }
    }
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  if (stroke.kind === 2) {
    walk.forEach((point, index) => {
      const dots = stroke.size + 2;
      for (let dot = 0; dot < dots; dot += 1) {
        const reach = brush * (0.35 + 0.75 * point.level);
        const dx = (scatter(index + seed * 31, dot) - 0.5) * stride * 1.6;
        const dy = (scatter(dot + seed * 17, index) - 0.5) * 2 * reach;
        context.globalAlpha = 0.3 + 0.7 * point.level;
        context.beginPath();
        context.arc(point.px + dx, point.py + dy, Math.max(0.6, (0.9 + scatter(index, dot + seed) * 0.9) * style.scale), 0, Math.PI * 2);
        context.fill();
      }
    });
  } else if (stroke.kind === 1) {
    // A saw: a zigzag across the stroke's path, as wide as the paint is strong.
    context.lineWidth = Math.max(1.1, brush * 0.24);
    context.beginPath();
    walk.forEach((point, index) => {
      const before = walk[Math.max(0, index - 1)] ?? point;
      const after = walk[Math.min(walk.length - 1, index + 1)] ?? point;
      const length = Math.hypot(after.px - before.px, after.py - before.py) || 1;
      const side = (index % 2 === 0 ? 1 : -1) * brush * 0.55 * (0.3 + 0.7 * point.level);
      const px = point.px - ((after.py - before.py) / length) * side;
      const py = point.py + ((after.px - before.px) / length) * side;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.globalAlpha = 0.9;
    context.stroke();
  } else {
    for (let index = 1; index < walk.length; index += 1) {
      const from = walk[index - 1]!;
      const to = walk[index]!;
      const level = (from.level + to.level) / 2;
      context.globalAlpha = 0.4 + 0.6 * level;
      context.lineWidth = Math.max(1, brush * (0.22 + 0.78 * level));
      context.beginPath();
      context.moveTo(from.px, from.py);
      context.lineTo(to.px, to.py);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

/** Paints a picture into a box of the canvas. */
export function paintBild(context: CanvasRenderingContext2D, bild: Bild, x: number, y: number, width: number, height: number, style: BildStyle): void {
  bild.strokes.forEach((stroke, index) => paintStroke(context, stroke, index + 1, x, y, width, height, style));
}

/** A small picture of a sound, for its button and the shelf. */
export function renderThumb(canvas: HTMLCanvasElement, bild: Bild | null, color: string): void {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(24, Math.round(box.width || canvas.clientWidth || 64));
  const height = Math.max(12, Math.round(box.height || canvas.clientHeight || 32));
  const ratio = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (bild) paintBild(context, bild, 3, 3, width - 6, height - 6, { color, ink: color, scale: Math.max(0.36, height / 95) });
}

export class EaselView {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dirty = true;
  private drawn: RawPoint[] | null = null;
  private mode: "paint" | "erase" | "hold" | null = null;
  private pointer: { x: number; y: number } | null = null;
  private gestures = 0;
  private wheelRest = 0;
  private ink = "#2a2233";
  private font = "system-ui, sans-serif";

  constructor(private readonly canvas: HTMLCanvasElement, private readonly host: EaselHost) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    this.context = context;
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.dirty = true;
    });
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.readPalette());
    this.readPalette();
    const frame = (): void => {
      this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Where a point of the picture (time and height, both 0..1) is on the page: for the browser tests. */
  position(t: number, y: number): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const inner = this.inner();
    const scale = box.width / Math.max(1, this.width);
    return { x: box.left + (inner.x + t * inner.width) * scale, y: box.top + (inner.y + (1 - y) * inner.height) * scale };
  }

  private readPalette(): void {
    const style = getComputedStyle(document.documentElement);
    this.ink = style.getPropertyValue("--ink").trim() || this.ink;
    this.font = getComputedStyle(this.canvas).fontFamily || this.font;
    this.dirty = true;
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    this.width = Math.round(box.width);
    this.height = Math.round(box.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.dirty = true;
  }

  /** The sheet inside the canvas: a margin keeps strokes at the edges whole. */
  private inner(): { x: number; y: number; width: number; height: number } {
    const margin = Math.max(8, this.height * 0.035);
    return { x: margin, y: margin, width: this.width - margin * 2, height: this.height - margin * 2 };
  }

  private bild(): Bild | null {
    return trackOf(this.host.project, this.host.selected).bild;
  }

  /** Whether the ring holds notes (then the picture can hold, too). */
  private holds(): boolean {
    return trackInfo(this.host.selected).melodic;
  }

  // ---- drawing ----------------------------------------------------------------

  private frame(): void {
    if (!this.host.easel || this.width === 0) return;
    const track = this.host.selected;
    const seconds = bildSeconds(track, trackOf(this.host.project, track));
    const sounding = this.host.sinceStruck(track) < seconds + 0.25;
    if (!this.dirty && !sounding && !this.drawn) return;
    this.dirty = false;
    this.draw(sounding ? this.host.sinceStruck(track) / seconds : null);
  }

  private draw(playhead: number | null): void {
    const context = this.context;
    const host = this.host;
    const track = host.selected;
    const info = trackInfo(track);
    const inner = this.inner();
    const bild = this.bild();
    context.clearRect(0, 0, this.width, this.height);

    // Quarters of the time, and the lines of pitch.
    context.strokeStyle = this.ink;
    context.lineWidth = 1;
    context.globalAlpha = 0.08;
    for (let quarter = 1; quarter < 4; quarter += 1) {
      const px = Math.round(inner.x + (quarter / 4) * inner.width) + 0.5;
      context.beginPath();
      context.moveTo(px, inner.y);
      context.lineTo(px, inner.y + inner.height);
      context.stroke();
    }
    context.font = `700 ${Math.max(9, Math.min(11, this.height * 0.035))}px ${this.font}`;
    context.textBaseline = "bottom";
    for (const guide of guides(track)) {
      const py = Math.round(inner.y + inner.height - (guide.y / HEIGHT_MAX) * inner.height) + 0.5;
      context.globalAlpha = guide.root ? 0.55 : 0.13;
      context.lineWidth = guide.root ? 1.5 : 1;
      context.strokeStyle = guide.root ? info.color : this.ink;
      context.beginPath();
      context.moveTo(inner.x, py);
      context.lineTo(inner.x + inner.width, py);
      context.stroke();
      if (guide.label) {
        context.globalAlpha = guide.root ? 0.9 : 0.45;
        context.fillStyle = guide.root ? info.color : this.ink;
        context.textAlign = "right";
        context.fillText(guide.label, inner.x + inner.width - 2, py - 2);
      }
    }
    context.globalAlpha = 1;

    // Where a held note stands still.
    const hold = this.holds() ? (bild?.hold ?? null) : null;
    if (hold !== null) {
      const px = inner.x + (hold / TIME_MAX) * inner.width;
      context.strokeStyle = this.ink;
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.moveTo(px, inner.y + 10);
      context.lineTo(px, inner.y + inner.height);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = this.ink;
      context.beginPath();
      context.arc(px, inner.y + 7, 6.5, 0, Math.PI * 2);
      context.fill();
      context.textAlign = px > inner.x + inner.width * 0.8 ? "right" : "left";
      context.textBaseline = "middle";
      context.fillText("Halten", px + (context.textAlign === "left" ? 11 : -11), inner.y + 8);
    }

    const style: BildStyle = { color: info.color, ink: this.ink, scale: Math.max(0.7, Math.min(1.25, this.height / 300)) };
    if (bild) paintBild(context, bild, inner.x, inner.y, inner.width, inner.height, style);

    // The stroke under the brush right now, already as it will sound.
    if (this.drawn && this.mode === "paint") {
      const kind = Math.min(host.brush, 2);
      const stroke = makeStroke(kind, host.brushSize, this.drawn, (y) => snapHeight(track, kind, y));
      if (stroke) paintStroke(context, stroke, 99, inner.x, inner.y, inner.width, inner.height, style);
    }

    if (playhead !== null && playhead <= 1.05) {
      const px = inner.x + Math.min(1, playhead) * inner.width;
      context.strokeStyle = this.ink;
      context.globalAlpha = 0.75 * (1 - Math.max(0, playhead - 0.9) / 0.15);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(px, inner.y);
      context.lineTo(px, inner.y + inner.height);
      context.stroke();
      context.globalAlpha = 1;
    }

    // The brush under the pointer.
    if (this.pointer && !this.mode) {
      const radius = host.brush === ERASER ? 9 : ((WIDTHS[host.brushSize] ?? 7) * style.scale) / 2 + 1;
      context.strokeStyle = this.ink;
      context.lineWidth = 1.25;
      context.globalAlpha = 0.7;
      if (host.brush === ERASER) context.setLineDash([3, 3]);
      context.beginPath();
      context.arc(this.pointer.x, this.pointer.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
    }
  }

  // ---- painting ---------------------------------------------------------------

  private locate(event: PointerEvent | WheelEvent): { x: number; y: number; t: number; h: number } {
    const box = this.canvas.getBoundingClientRect();
    const scale = this.width / Math.max(1, box.width);
    const x = (event.clientX - box.left) * scale;
    const y = (event.clientY - box.top) * scale;
    const inner = this.inner();
    return { x, y, t: Math.max(0, Math.min(1, (x - inner.x) / inner.width)), h: Math.max(0, Math.min(1, 1 - (y - inner.y) / inner.height)) };
  }

  private eraseAt(t: number, h: number, gesture: string): void {
    const bild = this.bild();
    if (!bild) return;
    const inner = this.inner();
    const index = strokeAt(bild, t, h, 13 / inner.height, inner.width / inner.height);
    if (index >= 0) this.host.eraseStroke(index, gesture);
  }

  private down(event: PointerEvent): void {
    this.host.wake();
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the stroke still works while it stays on the sheet.
    }
    const spot = this.locate(event);
    const bild = this.bild();
    const inner = this.inner();
    this.gestures += 1;
    const hold = this.holds() ? (bild?.hold ?? null) : null;
    const holdX = hold === null ? null : inner.x + (hold / TIME_MAX) * inner.width;
    if (event.button === 2 || this.host.brush === ERASER) {
      this.mode = "erase";
      this.eraseAt(spot.t, spot.h, `radieren${this.gestures}`);
    } else if (holdX !== null && Math.abs(spot.x - holdX) < 11 && spot.y < inner.y + 22) {
      this.mode = "hold";
    } else {
      this.mode = "paint";
      this.drawn = [{ t: spot.t, y: spot.h }];
    }
    this.pointer = { x: spot.x, y: spot.y };
    this.dirty = true;
  }

  private move(event: PointerEvent): void {
    const spot = this.locate(event);
    this.pointer = { x: spot.x, y: spot.y };
    this.dirty = true;
    if (this.mode === "paint" && this.drawn) {
      const last = this.drawn[this.drawn.length - 1];
      if (!last || Math.abs(last.t - spot.t) > 0.003 || Math.abs(last.y - spot.h) > 0.006) this.drawn.push({ t: spot.t, y: spot.h });
    } else if (this.mode === "erase") {
      this.eraseAt(spot.t, spot.h, `radieren${this.gestures}`);
    } else if (this.mode === "hold") {
      this.host.setHold(spot.t * TIME_MAX, `halten${this.gestures}`);
    }
  }

  private up(event: PointerEvent): void {
    if (this.mode === "paint" && this.drawn && event.type === "pointerup") this.host.paint(this.drawn);
    this.drawn = null;
    this.mode = null;
    this.host.endGesture();
    this.dirty = true;
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    this.wheelRest += event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY;
    const notches = Math.trunc(this.wheelRest / 45);
    if (notches === 0) return;
    this.wheelRest -= notches * 45;
    this.host.setBrushSize(this.host.brushSize - Math.sign(notches));
  }
}

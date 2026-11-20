import type { App } from "../app/app";

/*
 * The mouth that sings: drawn in the hub of the wheel while a voice sounds,
 * and large in the voice's window. It is as open as the vowel's first
 * resonance is high and as wide as its second one is: an "a" gapes, an "i"
 * smiles, an "u" is a small round hole.
 */

const TAU = Math.PI * 2;
const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

export interface MouthShape {
  /** 0..1: how far the jaw is down. */
  open: number;
  /** 0..1: from pursed to spread. */
  wide: number;
  /** 0..1: how much it is sounding right now (it closes as the note dies). */
  amount: number;
}

/** A mouth around a point: lips in `lip`, the dark of it in `inside`. `size` is half its greatest width. */
export function drawMouth(context: CanvasRenderingContext2D, x: number, y: number, size: number, shape: MouthShape, lip: string, inside: string): void {
  const open = shape.open * shape.amount;
  const width = size * lerp(0.5, 1, shape.wide);
  const height = size * lerp(0.1, 0.82, open);
  context.save();
  context.fillStyle = lip;
  context.beginPath();
  context.ellipse(x, y, width, Math.max(size * 0.1, height), 0, 0, TAU);
  context.fill();
  if (open > 0.04) {
    context.fillStyle = inside;
    context.beginPath();
    context.ellipse(x, y, width * 0.74, height * 0.62, 0, 0, TAU);
    context.fill();
  } else {
    // Closed: a line between the lips.
    context.strokeStyle = inside;
    context.lineWidth = Math.max(1.5, size * 0.05);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x - width * 0.7, y);
    context.lineTo(x + width * 0.7, y);
    context.stroke();
  }
  context.restore();
}

/** The big mouth in the voice's window. */
export class BoothView {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dirty = true;
  private ink = "#2a2233";
  private color = "#e4572e";

  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: App) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    this.context = context;
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.invalidate());
    const frame = (): void => {
      this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Something changed: the colour of the ring, the theme, the size. */
  invalidate(color = this.color): void {
    this.color = color;
    this.ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || this.ink;
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

  private frame(): void {
    if (!this.app.voice.isOpen || this.width === 0) return;
    const mouth = this.app.voice.mouth();
    if (!this.dirty && !mouth) return;
    this.dirty = mouth !== null;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    const size = Math.min(this.width * 0.3, this.height * 0.42);
    drawMouth(context, this.width / 2, this.height / 2, size, mouth ?? { open: 0, wide: 0.55, amount: 0 }, this.color, this.ink);
  }
}

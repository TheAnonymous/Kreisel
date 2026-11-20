import { modesOf, sustains } from "../body";
import { clamp, trackInfo, trackOf, type Body } from "../model";
import type { App } from "../app/app";

/*
 * The workbench: the ring's Klangkörper, drawn as the thing it is. A click
 * strikes it where the pointer is, and that place is where the ring will
 * strike it from then on; so a body is explored by knocking on it. The grip
 * on its right pulls it bigger or smaller, the one on its left tightens it.
 * While it sounds, it is seen to move.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Look {
  ink: string;
  paper: string;
  /** The ring's colour: what moves is drawn in it. */
  color: string;
  /** 1 on the bench, smaller for thumbnails. */
  scale: number;
}

/** Where the mallet is and how the body moves right now. */
interface Motion {
  /** −1..1: the swing of the moment. */
  swing: number;
  /** 0..1: how much it still rings. */
  amount: number;
  /** How far the mallet is lifted off the body, 0..1. */
  lift: number;
  /** The side (−1 left, 1 right) or, on a skin, the angle the body was last struck at. */
  side: number;
  angle: number;
}

/** How far down the bowl's wall the place goes: not quite to the bottom, where the wall lies flat. */
const BOWL_REACH = 0.94;
const REST: Motion = { swing: 0, amount: 0, lift: 1, side: 1, angle: -0.6 };
const TAU = Math.PI * 2;
const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

/** Wood, metal, glass: the colour of what the body is made of. */
function materialColor(material: number): string {
  const stops = [[201, 143, 82], [174, 184, 197], [186, 228, 230]] as const;
  const [from, to, share] = material < 0.5 ? [stops[0], stops[1], material * 2] : [stops[1], stops[2], (material - 0.5) * 2];
  return `rgb(${from.map((value, index) => Math.round(lerp(value, to[index] ?? value, share))).join(" ")})`;
}

interface Shape {
  cx: number;
  cy: number;
  /** Half the body's length, or its radius. */
  half: number;
  /** Half its thickness (bar, tube), the bowl's depth, or the skin's rim. */
  thick: number;
  /** The widest `half` can get: what the size grip pulls against. */
  reach: number;
  left: number;
  right: number;
}

function shapeOf(body: Body, box: Box, scale: number): Shape {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const grow = lerp(0.5, 1, body.size);
  if (body.kind === 0) {
    const reach = Math.min(box.height * 0.4, box.width * 0.3);
    const half = reach * grow;
    return { cx, cy, half, thick: 7 * scale, reach, left: cx - half - 7 * scale, right: cx + half + 7 * scale };
  }
  if (body.kind === 4) {
    const reach = Math.min(box.height * 0.42, box.width * 0.3);
    const half = reach * grow;
    return { cx, cy, half, thick: half * 0.95, reach, left: cx - half, right: cx + half };
  }
  const reach = box.width * 0.38;
  const half = reach * grow;
  const thick = body.kind === 1 ? 20 * scale : body.kind === 2 ? lerp(7, 17, body.tight) * lerp(0.85, 1.2, body.size) * scale : lerp(30, 12, body.tight) * lerp(0.85, 1.15, body.size) * scale;
  return { cx, cy, half, thick, reach, left: cx - half, right: cx + half + (body.kind === 3 ? thick * 0.35 : 0) };
}

/** The point of the body that `where` means, on the side it was last struck. */
function pointOf(body: Body, shape: Shape, motion: Motion): { x: number; y: number } {
  const { cx, cy, half, thick } = shape;
  if (body.kind === 0) {
    const radius = body.where * half * 0.95;
    return { x: cx + Math.cos(motion.angle) * radius, y: cy + Math.sin(motion.angle) * radius };
  }
  if (body.kind === 3) return { x: cx - half + body.where * half * 2, y: cy - thick };
  if (body.kind === 4) {
    // On the bowl's wall, as far down as the place says.
    const drop = (1 - body.where) * BOWL_REACH;
    return { x: cx + motion.side * half * 0.98 * Math.sqrt(1 - drop * drop), y: cy - thick / 2 + thick * drop };
  }
  return { x: cx + motion.side * body.where * half, y: body.kind === 2 ? cy - thick : cy };
}

function drawMallet(context: CanvasRenderingContext2D, body: Body, at: { x: number; y: number }, look: Look, motion: Motion): void {
  const s = look.scale;
  const up = motion.lift * 11 * s;
  const x = at.x;
  const y = at.y - up;
  context.save();
  context.lineCap = "round";
  context.strokeStyle = look.ink;
  context.fillStyle = look.ink;
  context.lineWidth = 2.4 * s;
  if (body.exciter === 0 || body.exciter === 1) {
    const head = (body.exciter === 0 ? 9 : 5) * s;
    context.beginPath();
    context.moveTo(x + head * 0.6, y - head * 0.6);
    context.lineTo(x + 30 * s, y - 34 * s);
    context.stroke();
    context.beginPath();
    context.arc(x, y - head, head, 0, TAU);
    context.fillStyle = body.exciter === 0 ? look.paper : look.ink;
    context.fill();
    context.stroke();
  } else if (body.exciter === 2) {
    // A pick: its point touches the body.
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 7 * s, y - 15 * s);
    context.quadraticCurveTo(x, y - 21 * s, x + 7 * s, y - 15 * s);
    context.closePath();
    context.fill();
  } else if (body.exciter === 3) {
    // A bow: wood and hair, laid across the place.
    const slide = motion.swing * motion.amount * 9 * s;
    context.beginPath();
    context.moveTo(x - 46 * s + slide, y + 16 * s);
    context.lineTo(x + 46 * s + slide, y - 22 * s);
    context.stroke();
    context.lineWidth = 1 * s;
    context.beginPath();
    context.moveTo(x - 44 * s + slide, y + 20 * s);
    context.lineTo(x + 47 * s + slide, y - 17 * s);
    context.stroke();
  } else {
    // Breath: three puffs towards the place.
    context.lineWidth = 2 * s;
    for (let puff = 0; puff < 3; puff += 1) {
      const away = (10 + puff * 9 + motion.amount * motion.swing * 2) * s;
      context.globalAlpha = 0.9 - puff * 0.22;
      context.beginPath();
      context.arc(x - away * 0.7, y - away, (4 + puff * 2.2) * s, Math.PI * 0.15, Math.PI * 0.95);
      context.stroke();
    }
  }
  context.restore();
}

/** Draws `body` into `box`: at rest, or moving as `motion` says. */
export function drawBody(context: CanvasRenderingContext2D, body: Body, box: Box, look: Look, motion: Motion = REST): void {
  const shape = shapeOf(body, box, look.scale);
  const { cx, cy, half, thick } = shape;
  const s = look.scale;
  const matter = materialColor(body.material);
  const wave = motion.swing * motion.amount;
  const hit = pointOf(body, shape, motion);
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = look.ink;
  context.lineWidth = 2 * s;

  if (body.kind === 0) {
    // A drum from above: the shell in its material, the skin inside, the lugs that tighten it.
    context.fillStyle = matter;
    context.beginPath();
    context.arc(cx, cy, half + thick, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = "#f6ecd6";
    context.beginPath();
    context.arc(cx, cy, half, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = look.ink;
    for (let lug = 0; lug < 8; lug += 1) {
      const turn = (lug / 8) * TAU + 0.39;
      context.beginPath();
      context.arc(cx + Math.cos(turn) * (half + thick * 0.5), cy + Math.sin(turn) * (half + thick * 0.5), 2.1 * s, 0, TAU);
      context.fill();
    }
    context.save();
    context.beginPath();
    context.arc(cx, cy, half - 1, 0, TAU);
    context.clip();
    // A slack skin lies in folds.
    context.globalAlpha = (1 - body.tight) * 0.32;
    context.lineWidth = 1.2 * s;
    for (let fold = 1; fold <= 3; fold += 1) {
      context.beginPath();
      context.arc(cx - half * 0.15, cy + half * 0.1, (half * fold) / 3.6, 0.3, 2.2);
      context.stroke();
    }
    // Rings run out from where it was struck.
    context.strokeStyle = look.color;
    context.lineWidth = 2.4 * s;
    for (let ring = 0; ring < 4; ring += 1) {
      const share = (ring + (motion.swing + 1) / 2) / 4;
      context.globalAlpha = motion.amount * (1 - share) * 0.9;
      context.beginPath();
      context.arc(hit.x, hit.y, share * half * 1.5 + 2, 0, TAU);
      context.stroke();
    }
    context.restore();
  } else if (body.kind === 1) {
    // A string between two posts: slack it sags, struck it swings widest where it was touched.
    // The box it sounds in shows what it is made of.
    context.fillStyle = matter;
    context.beginPath();
    context.roundRect(cx - half - 16 * s, cy + 12 * s, half * 2 + 32 * s, 44 * s, 9 * s);
    context.fill();
    context.stroke();
    context.fillStyle = look.ink;
    context.globalAlpha = 0.45;
    context.beginPath();
    context.ellipse(cx, cy + 34 * s, 13 * s, 9 * s, 0, 0, TAU);
    context.fill();
    context.globalAlpha = 1;
    const sag = (1 - body.tight) * 7 * s;
    const width = lerp(4.6, 1.7, body.tight) * lerp(0.8, 1.3, body.size) * s;
    const at = clamp((hit.x - (cx - half)) / (half * 2), 0.04, 0.96);
    const reach = 15 * s * motion.amount;
    const line = (sway: number): void => {
      context.beginPath();
      context.moveTo(cx - half, cy);
      for (let step = 1; step <= 40; step += 1) {
        const share = step / 40;
        const fall = sag * 4 * share * (1 - share);
        const swing = sway * (share < at ? share / at : (1 - share) / (1 - at));
        context.lineTo(cx - half + share * half * 2, cy + fall + swing);
      }
    };
    context.fillStyle = look.color;
    context.globalAlpha = 0.22 * motion.amount;
    line(reach);
    for (let step = 40; step >= 0; step -= 1) {
      const share = step / 40;
      context.lineTo(cx - half + share * half * 2, cy + sag * 4 * share * (1 - share) - reach * (share < at ? share / at : (1 - share) / (1 - at)));
    }
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = width;
    line(reach * motion.swing);
    context.stroke();
    context.lineWidth = 2 * s;
    context.fillStyle = matter;
    for (const post of [cx - half, cx + half]) {
      context.beginPath();
      context.roundRect(post - 5 * s, cy - 13 * s, 10 * s, 26 * s, 3 * s);
      context.fill();
      context.stroke();
    }
  } else if (body.kind === 2) {
    // A bar on two rests: it bends most in the middle and at its ends.
    const bend = (share: number): number => wave * 6 * s * Math.cos(1.5 * Math.PI * (share - 0.5));
    context.fillStyle = look.ink;
    for (const rest of [0.224, 0.776]) {
      const x = cx - half + rest * half * 2;
      context.beginPath();
      context.moveTo(x, cy + thick);
      context.lineTo(x - 7 * s, cy + thick + 13 * s);
      context.lineTo(x + 7 * s, cy + thick + 13 * s);
      context.closePath();
      context.fill();
    }
    context.fillStyle = matter;
    context.beginPath();
    for (let step = 0; step <= 24; step += 1) {
      const share = step / 24;
      const x = cx - half + share * half * 2;
      if (step === 0) context.moveTo(x, cy - thick + bend(share));
      else context.lineTo(x, cy - thick + bend(share));
    }
    for (let step = 24; step >= 0; step -= 1) {
      const share = step / 24;
      context.lineTo(cx - half + share * half * 2, cy + thick + bend(share));
    }
    context.closePath();
    context.fill();
    context.stroke();
    // Wood shows its grain, metal and glass a shine.
    context.lineWidth = 1 * s;
    context.globalAlpha = body.material < 0.4 ? 0.35 : 0.5;
    context.strokeStyle = body.material < 0.4 ? look.ink : "#fff";
    for (const row of body.material < 0.4 ? [-0.4, 0.1, 0.5] : [-0.55]) {
      context.beginPath();
      for (let step = 1; step < 24; step += 1) {
        const share = step / 24;
        const x = cx - half + share * half * 2;
        const y = cy + row * thick + bend(share);
        if (step === 1) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  } else if (body.kind === 3) {
    // A tube, closed on the left and open on the right; the air inside swings most at the closed end.
    context.fillStyle = matter;
    context.beginPath();
    context.roundRect(cx - half, cy - thick, half * 2, thick * 2, [5 * s, 0, 0, 5 * s]);
    context.fill();
    context.stroke();
    context.fillStyle = look.ink;
    context.globalAlpha = 0.5;
    context.beginPath();
    context.ellipse(cx + half, cy, thick * 0.35, thick, 0, 0, TAU);
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
    context.lineWidth = 5 * s;
    context.beginPath();
    context.moveTo(cx - half, cy - thick);
    context.lineTo(cx - half, cy + thick);
    context.stroke();
    context.fillStyle = look.color;
    context.globalAlpha = 0.5 * motion.amount;
    context.beginPath();
    for (let step = 0; step <= 24; step += 1) {
      const share = step / 24;
      const wide = Math.cos((share * Math.PI) / 2) * thick * 0.75 * Math.abs(motion.swing);
      if (step === 0) context.moveTo(cx - half + 4 * s, cy - wide);
      else context.lineTo(cx - half + share * (half * 2 - thick * 0.35), cy - wide);
    }
    for (let step = 24; step >= 0; step -= 1) {
      const share = step / 24;
      context.lineTo(cx - half + Math.max(4 * s, share * (half * 2 - thick * 0.35)), cy + Math.cos((share * Math.PI) / 2) * thick * 0.75 * Math.abs(motion.swing));
    }
    context.fill();
  } else {
    // A bowl from the side: struck, its rim goes oval one way and the other.
    const top = cy - thick / 2;
    const wide = half + wave * 5 * s;
    const flat = half * 0.22 - wave * 2 * s;
    context.lineWidth = lerp(2, 6, body.tight) * s;
    context.fillStyle = matter;
    context.globalAlpha = body.material > 0.75 ? 0.72 : 1;
    context.beginPath();
    context.moveTo(cx - wide, top);
    context.ellipse(cx, top, wide, thick, 0, Math.PI, 0, true);
    context.ellipse(cx, top, wide, flat, 0, 0, Math.PI, true);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
    context.fillStyle = look.ink;
    context.globalAlpha = 0.28;
    context.beginPath();
    context.ellipse(cx, top, wide, flat, 0, 0, TAU);
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
    context.lineWidth = 2 * s;
    context.beginPath();
    context.moveTo(cx - half * 0.3, top + thick + 3 * s);
    context.lineTo(cx + half * 0.3, top + thick + 3 * s);
    context.stroke();
    // Its hum goes out into the air.
    context.strokeStyle = look.color;
    for (let ring = 0; ring < 3; ring += 1) {
      const share = (ring + (motion.swing + 1) / 2) / 3;
      context.globalAlpha = motion.amount * (1 - share) * 0.8;
      context.beginPath();
      context.ellipse(cx, top, wide + share * 26 * s, flat + share * 9 * s, 0, 0, TAU);
      context.stroke();
    }
  }
  context.restore();
  drawMallet(context, body, hit, look, motion);
}

/** A small picture of a body, for its button. */
export function renderBodyThumb(canvas: HTMLCanvasElement, body: Body | null, color: string): void {
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
  if (!body) return;
  const style = getComputedStyle(document.documentElement);
  const look = { ink: style.getPropertyValue("--ink").trim() || "#2a2233", paper: style.getPropertyValue("--paper").trim() || "#fffaf0", color, scale: Math.max(0.3, height / 110) };
  // Always at one size, so the kind of body is told apart at a glance.
  drawBody(context, { ...body, size: 0.9 }, { x: 2, y: 4, width: width - 4, height: height - 4 }, look, { ...REST, lift: 0.4 });
}

type Grip = "size" | "tight";

export class BenchView {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dirty = true;
  private ink = "#2a2233";
  private paper = "#fffaf0";
  private font = "system-ui, sans-serif";
  private drag: { pointer: number; what: Grip | "strike"; x: number; y: number; from: number; where: number; at: number; gesture: string } | null = null;
  private hover: Grip | "body" | null = null;
  private side = 1;
  private angle = -0.6;
  private gestures = 0;
  private wheelRest = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: App) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    this.context = context;
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.canvas.style.cursor = "";
      this.dirty = true;
    });
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("keydown", (event) => this.key(event));
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

  /** Where a place on the body is on the page (0 its middle, 1 its edge): for the browser tests. */
  position(where: number): { x: number; y: number } {
    const body = this.body();
    const page = this.canvas.getBoundingClientRect();
    if (!body) return { x: page.left, y: page.top };
    const shape = shapeOf(body, this.box(), 1);
    const at = pointOf({ ...body, where }, shape, { ...REST, side: 1, angle: -0.6 });
    const scale = page.width / Math.max(1, this.width);
    // A touch inside the body, not on its upper edge.
    const inside = body.kind === 2 || body.kind === 3 ? shape.thick * 0.6 : 0;
    return { x: page.left + at.x * scale, y: page.top + (at.y + inside) * scale };
  }

  /** Where a grip is on the page: for the browser tests. */
  grip(what: Grip): { x: number; y: number } {
    const body = this.body();
    const page = this.canvas.getBoundingClientRect();
    if (!body) return { x: page.left, y: page.top };
    const at = this.grips(shapeOf(body, this.box(), 1))[what];
    const scale = page.width / Math.max(1, this.width);
    return { x: page.left + at.x * scale, y: page.top + at.y * scale };
  }

  private body(): Body | null {
    return trackOf(this.app.project, this.app.selected).body;
  }

  private box(): Box {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  private grips(shape: Shape): Record<Grip, { x: number; y: number }> {
    return { size: { x: shape.right + 20, y: shape.cy }, tight: { x: shape.left - 20, y: shape.cy } };
  }

  private readPalette(): void {
    const style = getComputedStyle(document.documentElement);
    this.ink = style.getPropertyValue("--ink").trim() || this.ink;
    this.paper = style.getPropertyValue("--paper").trim() || this.paper;
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

  // ---- drawing ----------------------------------------------------------------

  private frame(): void {
    const body = this.body();
    if (!this.app.body.isOpen || this.width === 0 || !body) return;
    const track = this.app.selected;
    const since = this.app.sinceStruck(track);
    // It is seen to ring about as long as it is heard to (a bowed one for as long as a short note).
    const lowest = modesOf(body, 220)[0]?.t60 ?? 0.5;
    const lasting = clamp(lowest / 5, 0.1, 1.3);
    const held = sustains(body) ? 0.3 : 0;
    const amount = since < 0 ? 0 : since < held ? 1 : Math.exp(-(since - held) / lasting);
    const sounding = amount > 0.02;
    if (!this.dirty && !sounding) return;
    this.dirty = false;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    const look = { ink: this.ink, paper: this.paper, color: trackInfo(track).color, scale: 1 };
    const motion = {
      swing: Math.sin(since * TAU * 7),
      amount: sounding ? amount : 0,
      lift: sustains(body) ? (sounding ? 0 : 1) : 1 - Math.exp(-Math.max(0, since) / 0.06),
      side: this.side,
      angle: this.angle,
    };
    drawBody(context, body, this.box(), look, motion);

    // The grips: pull the right one to make it bigger, the left one to tighten it.
    const grips = this.grips(shapeOf(body, this.box(), 1));
    context.save();
    context.font = `800 13px ${this.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const what of ["size", "tight"] as const) {
      const at = grips[what];
      const active = this.hover === what || this.drag?.what === what;
      context.beginPath();
      context.arc(at.x, at.y, 11, 0, TAU);
      context.fillStyle = active ? this.ink : this.paper;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = this.ink;
      context.stroke();
      context.fillStyle = active ? this.paper : this.ink;
      context.fillText(what === "size" ? "↔" : "↕", at.x, at.y + 0.5);
    }
    context.restore();
  }

  // ---- pointer ----------------------------------------------------------------

  private point(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const scale = this.width / Math.max(1, box.width);
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  }

  /** Which place of the body a point means (and from which side), or `null` beside the body. */
  private whereAt(body: Body, x: number, y: number): { where: number; side: number; angle: number } | null {
    const { cx, cy, half, thick } = shapeOf(body, this.box(), 1);
    const side = x < cx ? -1 : 1;
    if (body.kind === 0) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > half + thick + 4) return null;
      return { where: clamp(distance / (half * 0.95), 0, 1), side, angle: Math.atan2(y - cy, x - cx) };
    }
    if (body.kind === 4) {
      const top = cy - thick / 2;
      if (Math.abs(x - cx) > half + 8 || y < top - half * 0.3 || y > top + thick + 8) return null;
      return { where: clamp(1 - (y - top) / thick / BOWL_REACH, 0, 1), side, angle: 0 };
    }
    const reach = body.kind === 1 ? 26 : thick + 12;
    if (Math.abs(y - cy) > reach || Math.abs(x - cx) > half + 8) return null;
    if (body.kind === 3) return { where: clamp((x - (cx - half)) / (half * 2), 0, 1), side: 1, angle: 0 };
    return { where: clamp(Math.abs(x - cx) / half, 0, 1), side, angle: 0 };
  }

  private gripAt(body: Body, x: number, y: number): Grip | null {
    const grips = this.grips(shapeOf(body, this.box(), 1));
    for (const what of ["size", "tight"] as const) {
      if (Math.hypot(x - grips[what].x, y - grips[what].y) <= 17) return what;
    }
    return null;
  }

  private strike(body: Body, spot: { where: number; side: number; angle: number }, gesture: string): void {
    this.side = spot.side;
    this.angle = spot.angle;
    this.app.body.strike(spot.where, gesture);
    this.dirty = true;
    void body;
  }

  private down(event: PointerEvent): void {
    const body = this.body();
    if (!body) return;
    this.app.wake();
    const { x, y } = this.point(event);
    const grip = this.gripAt(body, x, y);
    const spot = grip ? null : this.whereAt(body, x, y);
    if (!grip && !spot) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the gesture still works while it stays on the bench.
    }
    this.gestures += 1;
    const gesture = `koerper${this.gestures}`;
    if (grip) {
      this.drag = { pointer: event.pointerId, what: grip, x, y, from: grip === "size" ? body.size : body.tight, where: body.where, at: 0, gesture };
    } else if (spot) {
      this.drag = { pointer: event.pointerId, what: "strike", x, y, from: 0, where: spot.where, at: performance.now(), gesture };
      this.strike(body, spot, gesture);
    }
    this.dirty = true;
  }

  private move(event: PointerEvent): void {
    const body = this.body();
    if (!body) return;
    const { x, y } = this.point(event);
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) {
      if (event.pointerType !== "mouse") return;
      const over = this.gripAt(body, x, y) ?? (this.whereAt(body, x, y) ? "body" : null);
      if (over !== this.hover) this.dirty = true;
      this.hover = over;
      this.canvas.style.cursor = over === "size" ? "ew-resize" : over === "tight" ? "ns-resize" : over === "body" ? "pointer" : "";
      return;
    }
    if (drag.what === "size") {
      // The grip stays under the pointer: the body grows by as much as it is pulled.
      const reach = shapeOf(body, this.box(), 1).reach;
      this.app.body.shape({ size: clamp(drag.from + (x - drag.x) / (reach * 0.5), 0, 1) }, drag.gesture);
    } else if (drag.what === "tight") {
      this.app.body.shape({ tight: clamp(drag.from - (y - drag.y) / 110, 0, 1) }, drag.gesture);
    } else {
      // Dragged across the body, it is knocked on again and again: so it is heard where it sounds how.
      const spot = this.whereAt(body, x, y);
      const now = performance.now();
      if (spot && Math.abs(spot.where - drag.where) >= 0.05 && now - drag.at > 75) {
        drag.where = spot.where;
        drag.at = now;
        this.strike(body, spot, drag.gesture);
      }
    }
    this.dirty = true;
  }

  private up(event: PointerEvent): void {
    if (this.drag?.pointer !== event.pointerId) return;
    this.drag = null;
    this.app.endGesture();
    this.dirty = true;
  }

  /** The wheel makes the body bigger and smaller; with Shift it tightens it. */
  private wheel(event: WheelEvent): void {
    const body = this.body();
    if (!body) return;
    event.preventDefault();
    this.wheelRest += event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY || event.deltaX;
    const notches = Math.trunc(this.wheelRest / 45);
    if (notches === 0) return;
    this.wheelRest -= notches * 45;
    if (event.shiftKey) this.app.body.shape({ tight: clamp(body.tight - notches * 0.05, 0, 1) }, "straff-rad");
    else this.app.body.shape({ size: clamp(body.size - notches * 0.05, 0, 1) }, "groesse-rad");
  }

  /** With the keyboard on the bench: left and right move the place, Enter knocks. */
  private key(event: KeyboardEvent): void {
    const body = this.body();
    if (!body) return;
    const step = event.key === "ArrowLeft" ? -0.05 : event.key === "ArrowRight" ? 0.05 : event.key === "Enter" || event.key === " " ? 0 : null;
    if (step === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.app.wake();
    this.strike(body, { where: clamp(body.where + step, 0, 1), side: this.side, angle: this.angle }, "koerper-taste");
    this.app.endGesture();
  }
}

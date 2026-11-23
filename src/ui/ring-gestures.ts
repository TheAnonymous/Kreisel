import { currentScene, MAX_NOTE_LENGTH, RUMBLE_MAX, SCENE_NAMES, WEATHER_MAX, stepAt, TENSION_MAX, trackInfo, wrap } from "../model";
import { chordAt, chordName, pitchName } from "../music";
import { shakes } from "../rumble";
import { WEATHER_NAMES, windDrift } from "../weather";
import { LONG_PRESS_MS, LONG_PRESS_SLACK } from "./menu";
import type { App, Tool } from "../app/app";
import type { RosterState } from "../piece";
import { capture } from "./dom";
import { type Spot, TAU, BRUSH, lerp } from "./ring-shape";
import type { RingView } from "./ring";

/** A stroke on the piece's ring. */
interface PieceDrag {
  pointer: number;
  lane: boolean;
  last: number;
  height: number;
  gesture: string;
}

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
  /** "context": the right button is down and has not moved on yet (then it erases, otherwise it opens the menu). */
  mode: "pending" | "paint" | "erase" | "pitch" | "value" | "context";
  existed: boolean;
  pitch: number;
  value: number;
  gesture: string;
}

/** A stroke on the Nachbeben; with the right button it erases, and until it moves on it may still mean the menu. */
interface Shake {
  pointer: number;
  last: number;
  erase: boolean;
  pending: boolean;
  gesture: string;
}

/** A finger that is down and may turn out to be a long press. */
interface Press {
  timer: ReturnType<typeof setTimeout>;
  pointer: number;
  x: number;
  y: number;
  target: { kind: "ring"; track: number; step: number } | { kind: "piece"; bar: number } | { kind: "roster"; bar: number };
}

/*
 * The hands on the wheel: what a pointer does on it. A click sets or takes a hit,
 * a stroke paints, pulling outwards bends the pitch, the right button erases
 * or opens the menu, a finger that rests does the same, and the mouse wheel
 * turns a ring. What is drawn is the view's business (ring.ts); this file
 * only works out what was meant and tells the app.
 */
export class RingGestures {
  private pieceDrag: PieceDrag | null = null;
  private drag: Drag | null = null;
  private shake: Shake | null = null;
  /** A stroke in the roster: every phrase it comes over gets the state its first click made. */
  private rosterDrag: { pointer: number; state: RosterState; gesture: string } | null = null;
  private press: Press | null = null;
  /** A stroke of the weather brush: the cells it has already been over get no more from it. */
  private gust: { pointer: number; erase: boolean; gesture: string; done: Set<string> } | null = null;
  /** Counts the strokes, so each one is its own step back. */
  private strokes = 0;
  private wheelRest = 0;
  /** What the pointer is over, and where the weather brush hovers: the view draws both. */
  hover: Spot | null = null;
  brushAt: { x: number; y: number } | null = null;

  constructor(private readonly view: RingView, private readonly app: App, private readonly canvas: HTMLCanvasElement, private readonly tip: HTMLElement) {
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", (event) => this.up(event));
    canvas.addEventListener("pointerleave", () => this.leave());
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  /** Paints the piece from the last bar of the stroke to this one, bar by bar the shorter way round. */
  private paintPiece(drag: PieceDrag, spot: { bar: number; height: number }): void {
    const count = this.app.project.piece.tension.length;
    let delta = spot.bar - drag.last;
    if (delta > count / 2) delta -= count;
    if (delta < -count / 2) delta += count;
    const steps = Math.abs(delta);
    for (let walked = steps === 0 ? 0 : 1; walked <= steps; walked += 1) {
      const bar = wrap(drag.last + Math.sign(delta) * walked, count);
      if (drag.lane) {
        this.app.piece.paintScene(bar, drag.gesture);
      } else {
        const height = steps === 0 ? spot.height : lerp(drag.height, spot.height, walked / steps);
        this.app.piece.paintTension(bar, Math.round(height * TENSION_MAX), drag.gesture);
      }
    }
    drag.last = spot.bar;
    drag.height = spot.height;
  }

  private down(event: PointerEvent): void {
    const { x, y } = this.view.point(event);
    const spot = this.view.locate(x, y);
    this.app.wake();
    this.disarm();
    if (!spot) return;
    // The right button shows what can be done with the place it is on.
    const context = event.button === 2;
    if (spot.kind === "hub") {
      this.hideTip();
      if (context) this.app.openContext({ kind: "hub" }, event.clientX, event.clientY);
      else this.app.togglePlay();
    } else if (this.app.weather.focused) {
      this.hideTip();
      if (spot.kind === "ring") this.beginGust(event, x, y);
    } else if (spot.kind === "chord") {
      this.hideTip();
      if (context) this.app.openContext({ kind: "chord", slot: spot.index }, event.clientX, event.clientY);
      else this.app.chords.open(spot.index);
    } else {
      // A finger has no right button: resting on a ring does the same.
      if (event.pointerType !== "mouse" && !context) this.arm(event, spot);
      if (spot.kind === "piece") this.downOnPiece(event, spot);
      else if (spot.kind === "roster") this.downOnRoster(event, spot);
      else this.downOnRing(event, spot, x, y);
    }
  }

  /**
   * On a ring while the rings show the roster: a click turns around whether the ring plays in that phrase, a stroke
   * carries the same on to every phrase it comes over, and the right button shows all seven rings of the phrase.
   */
  private downOnRoster(event: PointerEvent, spot: Spot & { kind: "roster" }): void {
    this.hideTip();
    if (event.button === 2) {
      this.app.openContext({ kind: "roster", bar: spot.bar }, event.clientX, event.clientY);
      return;
    }
    event.preventDefault();
    capture(this.canvas, event);
    this.strokes += 1;
    const gesture = `einsatz${this.strokes}`;
    const state = this.app.piece.flipRoster(spot.ring, spot.bar, gesture);
    if (state !== null) this.rosterDrag = { pointer: event.pointerId, state, gesture };
    this.view.redraw();
  }

  /** Under the weather brush the wheel is one sheet: every ring the brush reaches gets its weather (or, with the right button, loses it). */
  private beginGust(event: PointerEvent, x: number, y: number): void {
    event.preventDefault();
    capture(this.canvas, event);
    this.strokes += 1;
    this.gust = { pointer: event.pointerId, erase: event.button === 2, gesture: `wetter${this.strokes}`, done: new Set() };
    this.brushAt = { x, y };
    this.blow(x, y);
  }

  /** On the piece's ring: the first touch brings it into focus, the next ones paint the tension or lay down scenes. */
  private downOnPiece(event: PointerEvent, spot: Spot & { kind: "piece" }): void {
    const focused = this.app.piece.focused;
    this.app.piece.focus();
    this.hideTip();
    if (event.button === 2) {
      this.app.openContext({ kind: "piece", bar: spot.bar }, event.clientX, event.clientY);
      return;
    }
    if (event.pointerType !== "mouse" && !focused) return;
    event.preventDefault();
    capture(this.canvas, event);
    this.strokes += 1;
    this.pieceDrag = { pointer: event.pointerId, lane: spot.lane && focused, last: spot.bar, height: spot.height, gesture: `bogen${this.strokes}` };
    this.paintPiece(this.pieceDrag, spot);
    this.view.redraw();
  }

  /** On one of the seven rings: picks it, and begins a stroke with the tool in hand. */
  private downOnRing(event: PointerEvent, spot: Spot & { kind: "ring" }, x: number, y: number): void {
    const { track, step } = spot;
    const context = event.button === 2;
    const picked = this.app.selected === track && !this.app.piece.focused;
    this.app.select(track, step);
    // Under the cloth nothing is painted: picking the ring shows why.
    if (this.app.relay.veiled(track)) return;
    // A finger first picks the ring (the thin ones are too narrow to aim at), a mouse paints at once.
    if (event.pointerType !== "mouse" && !picked && !context) return;
    event.preventDefault();
    capture(this.canvas, event);
    if (shakes(track, this.app.tool)) {
      // On the kick's ring this tool paints the Nachbeben: how far out the pointer is says how much the ground shakes.
      this.strokes += 1;
      this.shake = { pointer: event.pointerId, last: step, erase: context, pending: context, gesture: `beben${this.strokes}` };
      if (!context) this.app.rumble.paint(step, this.shakeAt(x, y), this.shake.gesture);
    } else {
      const drag = this.beginDrag(event, track, step, x, y);
      if (!drag) return;
      this.drag = drag;
    }
    this.hideTip();
    this.view.redraw();
  }

  /** A stroke on a ring begins: what it does first, and what it will go by as it moves on. */
  private beginDrag(event: PointerEvent, track: number, step: number, x: number, y: number): Drag | null {
    const context = event.button === 2;
    const melodic = trackInfo(track).melodic;
    const tool: Tool = context || (this.app.tool === "laenge" && !melodic) ? "setzen" : this.app.tool;
    const pattern = currentScene(this.app.project).patterns[track];
    if (!pattern) return null;
    const note = stepAt(pattern, step);
    const { center } = this.view.geometry();
    this.strokes += 1;
    const drag: Drag = {
      pointer: event.pointerId,
      track,
      origin: step,
      last: step,
      travel: 0,
      distance: Math.hypot(x - center, y - center),
      turn: this.view.turn(x, y),
      tool,
      mode: context ? "context" : tool === "setzen" || tool === "laenge" ? "pending" : "value",
      existed: note.on,
      pitch: note.pitch,
      value: 0,
      gesture: `zug${this.strokes}`,
    };
    if (context) {
      // Nothing yet: pulled along the ring it erases, let go where it is it opens the menu.
    } else if (tool === "setzen" || tool === "laenge") {
      if (!note.on) this.app.rings.addNote(track, step, {}, drag.gesture);
      drag.pitch = stepAt(pattern, step).pitch;
    } else {
      drag.value = this.app.rings.bump(track, step, tool, drag.gesture);
    }
    return drag;
  }

  /** The cells the weather brush covers at a point: on every ring it reaches, the steps within its width. */
  private brushCells(x: number, y: number): [number, number][] {
    const { center, rings } = this.view.geometry();
    const reach = BRUSH[this.app.weather.cloudSize] ?? 18;
    const distance = Math.hypot(x - center, y - center);
    const scene = currentScene(this.app.project);
    const cells: [number, number][] = [];
    rings.forEach((band, track) => {
      // A ring is under the brush if the pointer is on it or the brush reaches its middle.
      const on = distance >= band.inner && distance <= band.outer;
      if ((!on && Math.abs((band.inner + band.outer) / 2 - distance) > reach) || this.app.relay.veiled(track)) return;
      const length = scene.patterns[track]?.len ?? 16;
      const place = this.view.turn(x, y) * length;
      // How many steps of this ring the brush is wide, at the ring's middle.
      const span = (reach / Math.max(1, (band.inner + band.outer) / 2)) / (TAU / length);
      const first = Math.floor(place - span + 0.5);
      const last = Math.max(first, Math.floor(place + span - 0.5));
      for (let step = Math.min(first, Math.floor(place)); step <= Math.max(last, Math.floor(place)); step += 1) cells.push([track, wrap(step, length)]);
    });
    return cells;
  }

  /** The weather brush at a point: every cell it covers that this stroke has not been over yet. */
  private blow(x: number, y: number): void {
    const gust = this.gust;
    if (!gust) return;
    const fresh = this.brushCells(x, y).filter(([track, step]) => !gust.done.has(`${track}:${step}`));
    for (const [track, step] of fresh) gust.done.add(`${track}:${step}`);
    if (fresh.length > 0) this.app.weather.paint(fresh, gust.erase, gust.gesture);
    this.view.redraw();
  }

  /** How much Nachbeben a point of the kick's ring means: nothing at its inner edge, all of it at the outer one. */
  private shakeAt(x: number, y: number): number {
    const { center, rings } = this.view.geometry();
    const band = rings[0] ?? { inner: 0, outer: 1 };
    const share = (Math.hypot(x - center, y - center) - band.inner) / Math.max(1, band.outer - band.inner);
    return Math.max(0, Math.min(1, (share - 0.12) / 0.76));
  }

  /** Starts waiting for a finger to rest long enough to mean "what can I do here?". */
  private arm(event: PointerEvent, spot: Spot & { kind: "ring" | "piece" | "roster" }): void {
    const target = spot.kind === "ring" ? { kind: "ring" as const, track: spot.track, step: spot.step } : { kind: spot.kind, bar: spot.bar };
    this.press = { timer: setTimeout(() => this.rested(), LONG_PRESS_MS), pointer: event.pointerId, x: event.clientX, y: event.clientY, target };
  }

  private disarm(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }

  /** The finger rested: what it did when it came down is taken back, and the menu opens instead. */
  private rested(): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    if (this.drag?.pointer === press.pointer) {
      this.app.cancelGesture(this.drag.gesture);
      this.drag = null;
    }
    if (this.pieceDrag?.pointer === press.pointer) {
      this.app.cancelGesture(this.pieceDrag.gesture);
      this.pieceDrag = null;
    }
    if (this.shake?.pointer === press.pointer) {
      this.app.cancelGesture(this.shake.gesture);
      this.shake = null;
    }
    if (this.rosterDrag?.pointer === press.pointer) {
      this.app.cancelGesture(this.rosterDrag.gesture);
      this.rosterDrag = null;
    }
    this.app.endGesture();
    this.view.redraw();
    if (press.target.kind === "ring" && this.app.relay.veiled(press.target.track)) return;
    this.app.openContext(press.target, press.x, press.y);
  }

  private move(event: PointerEvent): void {
    const { x, y } = this.view.point(event);
    if (this.press?.pointer === event.pointerId && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > LONG_PRESS_SLACK) this.disarm();
    if (this.pieceDrag?.pointer === event.pointerId) {
      this.movePieceStroke(this.pieceDrag, x, y);
      return;
    }
    if (this.rosterDrag?.pointer === event.pointerId) {
      const spot = this.view.locate(x, y);
      if (spot?.kind === "roster") this.app.piece.layRoster(spot.ring, spot.bar, this.rosterDrag.state, this.rosterDrag.gesture);
      this.view.redraw();
      return;
    }
    if (this.app.weather.focused) {
      this.brushAt = { x, y };
      this.view.redraw();
    }
    if (this.gust?.pointer === event.pointerId) this.blow(x, y);
    else if (this.shake?.pointer === event.pointerId) this.moveShake(this.shake, x, y);
    else if (this.drag?.pointer === event.pointerId) this.moveDrag(this.drag, x, y);
    else if (event.pointerType === "mouse") this.pointAt(this.view.locate(x, y), event);
  }

  /** A stroke on the piece's ring stays on it wherever the pointer wanders: only angle and distance count. */
  private movePieceStroke(stroke: PieceDrag, x: number, y: number): void {
    const { center, piece } = this.view.geometry();
    const count = this.app.project.piece.tension.length;
    const distance = Math.hypot(x - center, y - center);
    const height = Math.max(0, Math.min(1, (distance - piece.base) / Math.max(1, piece.outer - piece.base)));
    this.paintPiece(stroke, { bar: Math.min(count - 1, Math.floor(this.view.turn(x, y) * count)), height });
    this.view.redraw();
  }

  /** A stroke on the Nachbeben stays on the kick's ring wherever the pointer wanders: the angle says which step, the distance how much. */
  private moveShake(shake: Shake, x: number, y: number): void {
    const length = currentScene(this.app.project).patterns[0]?.len ?? 16;
    const step = this.view.stepOf(0, x, y);
    if (shake.pending) {
      // The right button stays where it is: the menu is still to come. Pulled on to another step, it erases.
      if (step === shake.last) return;
      shake.pending = false;
      this.app.rumble.paint(shake.last, 0, shake.gesture);
    }
    const share = shake.erase ? 0 : this.shakeAt(x, y);
    let delta = step - shake.last;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    const direction = Math.sign(delta);
    for (let walked = 0; walked !== delta; walked += direction) {
      this.app.rumble.paint(wrap(shake.last + walked + direction, length), share, shake.gesture);
    }
    // Pulled in or out within a step, the step follows.
    if (delta === 0) this.app.rumble.paint(step, share, shake.gesture);
    shake.last = step;
    this.view.redraw();
  }

  /** A stroke on a ring moves on: it paints, erases, sets a value, holds a note longer or bends its pitch. */
  private moveDrag(drag: Drag, x: number, y: number): void {
    const pattern = currentScene(this.app.project).patterns[drag.track];
    if (!pattern) return;
    const length = pattern.len;
    const step = this.view.stepOf(drag.track, x, y);
    // The shortest way round from the last step to this one, walked step by step.
    let delta = step - drag.last;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    const { center } = this.view.geometry();
    const distance = Math.hypot(x - center, y - center);
    const outwards = distance - drag.distance;
    // How far the pointer went along the ring: a stroke across steps drifts inwards a little and must not bend the pitch.
    let turned = Math.abs(this.view.turn(x, y) - drag.turn);
    if (turned > 0.5) turned = 1 - turned;
    const along = turned * TAU * distance;

    if (drag.mode === "context") {
      // The right button stays where it is: the menu is still to come. Pulled on to another step, it erases.
      if (step === drag.origin) return;
      drag.mode = "erase";
      this.app.rings.removeNote(drag.track, drag.origin, drag.gesture);
    }
    if (drag.tool === "laenge") {
      drag.travel += delta;
      drag.last = step;
      this.app.rings.setLength(drag.track, drag.origin, Math.max(1, Math.min(MAX_NOTE_LENGTH, length, drag.travel + 1)), drag.gesture);
      return;
    }
    if (drag.mode === "pending") {
      if (step !== drag.origin) {
        drag.mode = drag.existed ? "erase" : "paint";
        if (drag.mode === "erase") this.app.rings.removeNote(drag.track, drag.origin, drag.gesture);
      } else if (Math.abs(outwards) > 6 && Math.abs(outwards) > along * 1.3) {
        drag.mode = "pitch";
      }
    }
    if (drag.mode === "pitch") {
      this.app.rings.setPitch(drag.track, drag.origin, drag.pitch + Math.round(outwards / 7), drag.gesture);
      return;
    }
    const direction = Math.sign(delta);
    for (let walked = 0; walked !== delta; walked += direction) {
      const at = wrap(drag.last + walked + direction, length);
      const there = stepAt(pattern, at);
      if (drag.mode === "paint" && !there.on) this.app.rings.addNote(drag.track, at, { pitch: drag.pitch }, drag.gesture);
      else if (drag.mode === "erase" && there.on) this.app.rings.removeNote(drag.track, at, drag.gesture);
      else if (drag.mode === "value" && there.on) this.app.rings.setValue(drag.track, at, drag.tool, drag.value, drag.gesture);
    }
    drag.last = step;
  }

  private up(event: PointerEvent): void {
    if (this.press?.pointer === event.pointerId) this.disarm();
    if (this.pieceDrag?.pointer === event.pointerId) {
      this.pieceDrag = null;
      this.app.endGesture();
      this.view.redraw();
      return;
    }
    if (this.gust?.pointer === event.pointerId) {
      this.gust = null;
      this.app.endGesture();
      this.view.redraw();
      return;
    }
    if (this.rosterDrag?.pointer === event.pointerId) {
      this.rosterDrag = null;
      this.app.endGesture();
      this.view.redraw();
      return;
    }
    if (this.shake?.pointer === event.pointerId) {
      const shake = this.shake;
      this.shake = null;
      this.app.endGesture();
      this.view.redraw();
      // The right button let go where it came down: the menu, as on any ring.
      if (shake.pending && event.type === "pointerup") this.app.openContext({ kind: "ring", track: 0, step: shake.last }, event.clientX, event.clientY);
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    // A plain click on a hit takes it away again.
    if (drag.tool === "setzen" && drag.mode === "pending" && drag.existed && event.type === "pointerup") {
      this.app.rings.removeNote(drag.track, drag.origin, drag.gesture);
    }
    this.drag = null;
    this.app.endGesture();
    this.view.redraw();
    if (drag.mode === "context" && event.type === "pointerup") {
      this.app.openContext({ kind: "ring", track: drag.track, step: drag.origin }, event.clientX, event.clientY);
    }
  }

  private leave(): void {
    if (this.hover || this.brushAt) this.view.redraw();
    this.brushAt = null;
    this.hover = null;
    this.canvas.style.cursor = "";
    this.hideTip();
  }

  private wheel(event: WheelEvent): void {
    const { x, y } = this.view.point(event);
    const spot = this.view.locate(x, y);
    if (spot?.kind !== "ring" && spot?.kind !== "piece") return;
    event.preventDefault();
    this.wheelRest += event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY;
    const notches = Math.trunc(this.wheelRest / 45);
    if (notches === 0) return;
    this.wheelRest -= notches * 45;
    if (this.app.weather.focused) {
      // Under the weather brush the wheel makes the brush wider and narrower.
      this.app.weather.setCloudSize(this.app.weather.cloudSize - Math.sign(notches));
      this.view.redraw();
      return;
    }
    if (spot.kind === "piece") this.app.piece.rotate(notches);
    else this.app.rings.rotate(spot.track, notches);
  }

  private pointAt(spot: Spot | null, event: PointerEvent): void {
    const before = JSON.stringify(this.hover);
    this.hover = spot;
    if (JSON.stringify(spot) !== before) this.view.redraw();
    this.canvas.style.cursor = spot ? "pointer" : "";
    if (!spot) {
      this.hideTip();
      return;
    }
    const project = this.app.project;
    const scene = currentScene(project);
    let text: string;
    if (spot.kind === "hub") {
      text = this.app.playing ? "Anhalten (Leertaste)" : "Starten (Leertaste)";
    } else if (spot.kind === "chord") {
      text = `Takt ${spot.index + 1}: ${chordName(project.root, project.scale, scene.chords[spot.index] ?? 0)} · klicken zum Ändern`;
    } else if (spot.kind === "piece") {
      const piece = project.piece;
      const tension = Math.round(((piece.tension[spot.bar] ?? 0) / TENSION_MAX) * 100);
      text = spot.lane && this.app.piece.focused
        ? `Szene ${SCENE_NAMES[project.scene]} hierher malen · Takt ${spot.bar + 1}`
        : `Stück · Takt ${spot.bar + 1} von ${piece.tension.length} · ${tension} % Spannung · Szene ${SCENE_NAMES[piece.scenes[spot.bar] ?? 0]} · Rechtsklick: ab hier spielen und mehr`;
    } else if (spot.kind === "roster") {
      text = this.app.piece.describeRoster(spot.ring, spot.bar);
    } else {
      const pattern = scene.patterns[spot.track];
      const note = pattern ? stepAt(pattern, spot.step) : null;
      const info = trackInfo(spot.track);
      text = this.app.relay.veiled(spot.track) ? `${info.name} · verdeckt (Stille Post)` : `${info.name} · Schritt ${spot.step + 1}`;
      if (this.app.weather.focused && !this.app.relay.veiled(spot.track)) {
        const kind = this.app.weather.cloud;
        const length = scene.patterns[spot.track]?.len ?? 16;
        const drift = Math.floor(windDrift(Math.floor(this.app.playhead() ?? 0), scene.wind[kind] ?? 0));
        const there = scene.weather[kind]?.[spot.track]?.[wrap(spot.step - drift, length)] ?? 0;
        text = `${WEATHER_NAMES[kind]} über ${info.name} · Schritt ${spot.step + 1} · ${Math.round((there / WEATHER_MAX) * 100)} %`;
      } else if (shakes(spot.track, this.app.tool) && !this.app.relay.veiled(spot.track)) {
        text = `Nachbeben · Schritt ${spot.step + 1} · ${Math.round(((scene.rumble[spot.step] ?? 0) / RUMBLE_MAX) * 100)} % · ziehen malt (außen stark), die rechte Taste radiert`;
      } else if (note?.on && !this.app.relay.veiled(spot.track)) text += ` · ${pitchName(project, spot.track, note.pitch, chordAt(scene, this.app.playhead() ?? 0))}`;
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

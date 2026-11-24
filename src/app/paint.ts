import { canListen, listen } from "../audio/listen";
import { diceBild, emptyBild, makeStroke, snapHeight, type RawPoint } from "../bild";
import { unpackBild } from "../codec";
import { framesToBild } from "../imitate";
import { keep, loadKept, saveKept, type Kept } from "../collection";
import { clamp, MAX_STROKES, OWN_SOUND, TIME_MAX, trackInfo, trackOf, type Bild } from "../model";
import type { App } from "./app";
import { WorkshopDesk } from "./workshop";

/** The brushes of the paint box; the fourth takes strokes away again. */
export const BRUSH_TOOLS: readonly { name: string; hint: string }[] = [
  { name: "Hum", hint: "A soft, pure tone" },
  { name: "Buzz", hint: "A sharp, buzzing tone" },
  { name: "Hiss", hint: "Noise at this height: cymbals, brushes, wind" },
  { name: "Erase", hint: "Take a stroke away (also with a right click)" },
];

export const ERASER = 3;

/*
 * The paint box: a ring's own sound, painted as a picture or made to the
 * microphone, and the shelf of pictures that are kept across projects.
 */
export class PaintDesk extends WorkshopDesk<"bild"> {
  /** 0 hum, 1 saw, 2 hiss, 3 the eraser. */
  brush = 0;
  brushSize = 1;
  /** Pictures kept on the shelf, across projects. */
  readonly kept: Kept[] = loadKept();
  /** What the paint box says while the microphone listens; `null` when it does not. */
  listening: string | null = null;
  /** Hears how loud the microphone is while it listens (the paint box shows it). */
  onLoudness: (level: number) => void = () => undefined;
  private stopListening: AbortController | null = null;

  constructor(app: App) {
    super(app, "bild", OWN_SOUND, "paint");
  }

  protected first(track: number): Bild {
    return diceBild(track, this.app.random);
  }

  protected override opened(track: number): void {
    this.app.rings.preview(track);
  }

  setBrush(brush: number): void {
    this.brush = clamp(brush, 0, ERASER);
    this.app.notify();
  }

  setBrushSize(size: number): void {
    const target = clamp(size, 0, 2);
    if (target === this.brushSize) return;
    this.brushSize = target;
    this.app.notify();
  }

  /** One stroke of the brush, through the points it passed (both 0..1). */
  stroke(drawn: readonly RawPoint[]): void {
    const track = this.app.selected;
    const kind = Math.min(this.brush, 2);
    const stroke = makeStroke(kind, this.brushSize, drawn, (y) => snapHeight(track, kind, y));
    if (!stroke) return;
    if ((this.current?.strokes.length ?? 0) >= MAX_STROKES) {
      this.app.say(`No more than ${MAX_STROKES} strokes fit into one sound. Erase one, then you can go on.`);
      return;
    }
    this.app.store.edit((project) => {
      const settings = trackOf(project, track);
      settings.bild ??= emptyBild();
      settings.bild.strokes.push(stroke);
      settings.sound = OWN_SOUND;
    });
    this.app.rings.preview(track);
  }

  eraseStroke(index: number, gesture: string): void {
    const track = this.app.selected;
    if (!this.current?.strokes[index]) return;
    this.app.store.edit((project) => { trackOf(project, track).bild?.strokes.splice(index, 1); }, gesture, Infinity);
  }

  /** Takes the newest stroke away. */
  eraseLast(): void {
    const count = this.current?.strokes.length ?? 0;
    if (count > 0) this.eraseStroke(count - 1, "strich");
    this.app.store.settle();
  }

  setHold(value: number | null, gesture?: string): void {
    const track = this.app.selected;
    const target = value === null ? null : clamp(Math.round(value), 2, TIME_MAX - 2);
    if (!this.current || this.current.hold === target) return;
    this.app.store.edit((project) => {
      const bild = trackOf(project, track).bild;
      if (bild) bild.hold = target;
    }, gesture, Infinity);
  }

  dice(): void {
    if (this.app.relay.refuse(this.app.selected)) return;
    const track = this.app.selected;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { bild: diceBild(track, this.app.random), sound: OWN_SOUND }); });
    this.app.rings.preview(track);
  }

  clear(): void {
    const track = this.app.selected;
    if (!this.current || this.current.strokes.length === 0) return;
    this.app.store.edit((project) => {
      const bild = trackOf(project, track).bild;
      if (bild) bild.strokes = [];
    });
  }

  /** Puts the ring's picture on the shelf. */
  keep(): void {
    const bild = this.current;
    if (!bild || bild.strokes.length === 0) {
      this.app.say("Nothing has been painted here yet.");
      return;
    }
    if (!keep(this.kept, this.app.selected, bild)) {
      this.app.say("This picture is already on the shelf.");
      return;
    }
    saveKept(this.kept);
    this.app.say("Kept. The picture is on the shelf and fits any ring, in another Kreisel too.");
  }

  /** Takes a picture from the shelf into the ring in focus. */
  useKept(index: number): void {
    if (this.app.relay.refuse(this.app.selected)) return;
    const bild = unpackBild(this.kept[index]?.bild);
    if (!bild) return;
    const track = this.app.selected;
    // Only rings that play notes hold; a drum plays the picture through.
    if (!trackInfo(track).melodic) bild.hold = null;
    this.app.store.edit((project) => { Object.assign(trackOf(project, track), { bild, sound: OWN_SOUND }); });
    this.app.rings.preview(track);
  }

  dropKept(index: number): void {
    if (!this.kept[index]) return;
    this.kept.splice(index, 1);
    saveKept(this.kept);
    this.app.notify();
  }

  /** Listens to one sound made into the microphone and paints what it heard; a second call stops listening. */
  async imitate(): Promise<void> {
    if (this.stopListening) {
      this.stopListening.abort();
      return;
    }
    if (!canListen()) {
      this.app.say("This browser gives no microphone here.");
      return;
    }
    const track = this.app.selected;
    // The Kreisel would hear itself through the speakers.
    const wasPlaying = this.app.playing;
    if (wasPlaying) this.app.engine.stop();
    const stop = new AbortController();
    this.stopListening = stop;
    this.listening = "Show the sound: hum, knock or hiss. Everything stays on your device.";
    this.app.notify();
    try {
      const frames = await listen({
        signal: stop.signal,
        onLevel: (level, begun) => {
          this.onLoudness(level);
          if (begun && this.listening !== "I'm listening …") {
            this.listening = "I'm listening …";
            this.app.notify();
          }
        },
      });
      const bild = framesToBild(frames, track);
      if (!bild) {
        this.app.say(stop.signal.aborted ? "Stopped listening." : "I heard nothing. A little closer to the microphone, or louder?");
      } else {
        this.app.store.edit((project) => { Object.assign(trackOf(project, track), { bild, sound: OWN_SOUND }); });
        this.app.say("This is how I understood you. Paint on from here, or show it once more.", this.app.takeBack);
      }
    } catch (error) {
      const refused = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.app.say(refused ? "Without a microphone you cannot show a sound. Allow it in the address bar, then it works." : "The microphone could not be opened.");
    } finally {
      this.stopListening = null;
      this.listening = null;
      this.onLoudness(0);
      this.app.notify();
      if (wasPlaying) await this.app.engine.start();
      else if (this.current) this.app.rings.preview(track);
    }
  }
}

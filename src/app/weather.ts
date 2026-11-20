import type { FxName } from "../audio/engine";
import { diceWeather, hasWeather, WEATHER_STROKE, windOffset } from "../weather";
import { clamp, currentScene, WEATHER_COUNT, WEATHER_MAX, WIND_MAX, wrap } from "../model";
import type { App } from "./app";

/** Effects that leave weather behind when they are held while "Einspielen" is on: dull is fog, the echo throw is rain, the stutter is hail. */
const TRAILS: readonly (readonly [FxName, number])[] = [["dumpf", 0], ["wurf", 3], ["stotter", 5]];

/*
 * The weather: effects painted onto the wheel, and the wind that carries them on.
 */
export class WeatherDesk {
  /** The kind of weather the brush holds (see WEATHER_NAMES), and how wide the brush is (0..2). */
  cloud = 2;
  cloudSize = 0;

  constructor(private readonly app: App) {}

  /** The weather is in focus instead of a ring: strokes on the wheel paint it. */
  get focused(): boolean {
    return this.app.focus === "weather";
  }

  /** Puts the weather in focus: the wheel is painted with it, the tools are the kinds of weather. */
  focus(): void {
    if (this.focused) return;
    this.app.piece.key = null;
    this.app.turnTo("weather");
  }

  setCloud(kind: number): void {
    this.cloud = clamp(Math.round(kind), 0, WEATHER_COUNT - 1);
    this.app.notify();
  }

  setCloudSize(size: number): void {
    this.cloudSize = clamp(Math.round(size), 0, 2);
    this.app.notify();
  }

  /**
   * Changes weather `kind` on cells of the wheel ([ring, step], as they lie under the pointer right now). Where a
   * wind has carried the weather on, the cell that is there now is the one that changes.
   */
  private skyAt(kind: number, cells: readonly (readonly [number, number])[], change: (now: number) => number, gesture: string): void {
    const scene = currentScene(this.app.project);
    const offset = windOffset(Math.floor(this.app.playhead() ?? 0), scene.wind[kind] ?? 0);
    const changes: [number, number, number][] = [];
    for (const [ring, step] of cells) {
      if (this.app.relay.veiled(ring)) continue;
      const length = scene.patterns[ring]?.len ?? 16;
      const index = wrap(step - offset, length);
      const now = scene.weather[kind]?.[ring]?.[index] ?? 0;
      const next = clamp(Math.round(change(now)), 0, WEATHER_MAX);
      if (next !== now) changes.push([ring, index, next]);
    }
    if (changes.length === 0) return;
    this.app.store.edit((project) => {
      const sky = currentScene(project).weather[kind];
      for (const [ring, index, next] of changes) {
        const line = sky?.[ring];
        if (line) line[index] = next;
      }
    }, gesture, Infinity);
  }

  /** A stroke of the weather brush over cells of the wheel: a little more of the brush's weather there, or none (`erase`). */
  paint(cells: readonly (readonly [number, number])[], erase: boolean, gesture: string): void {
    this.skyAt(this.cloud, cells, (now) => (erase ? 0 : now + WEATHER_STROKE), gesture);
  }

  /** Einspielen: an effect held while the Kreisel turns leaves its weather where the Kreisel is, over every ring. */
  trail(local: number): void {
    if (!this.app.rings.live || this.app.relay.oldTurn) return;
    for (const [fx, kind] of TRAILS) {
      if (!this.app.engine.fx[fx]) continue;
      const scene = currentScene(this.app.project);
      const cells = scene.patterns.map((pattern, ring) => [ring, local % pattern.len] as const);
      this.skyAt(kind, cells, (now) => Math.max(now, 10), `spur-${fx}`);
    }
  }

  /** How fast weather `kind` drifts around the wheel, in quarter steps a bar. */
  setWind(kind: number, wind: number, key?: string): void {
    const next = clamp(Math.round(wind), -WIND_MAX, WIND_MAX);
    if ((currentScene(this.app.project).wind[kind] ?? 0) === next) return;
    this.app.store.edit((project) => { currentScene(project).wind[kind] = next; }, key ? `${key}${kind}` : undefined);
  }

  /** Clears the sky: all of it, one kind of weather, or what lies over one ring. */
  clear(kind?: number, ring?: number): void {
    if (!hasWeather(currentScene(this.app.project), kind, ring)) return;
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      scene.weather.forEach((rings, which) => {
        if (kind !== undefined && kind !== which) return;
        rings.forEach((line, where) => {
          if (ring === undefined || ring === where) line.fill(0);
        });
        if (ring === undefined) scene.wind[which] = 0;
      });
    });
  }

  /** The dice: a sky to start from. */
  dice(): void {
    this.app.store.edit((project) => {
      const scene = currentScene(project);
      const sky = diceWeather(scene.patterns.map((pattern) => pattern.len), this.app.random);
      scene.weather = sky.weather;
      scene.wind = sky.wind;
    });
    if (!this.app.playing) this.app.say("Neues Wetter. Starte den Kreisel, dann hörst du es, und was Wind hat, zieht um das Rad.");
  }
}

import { describe, expect, it } from "vitest";
import { heightToHz, hzToHeight } from "../src/bild";
import { analyse, framesToBild, type Frame } from "../src/imitate";
import { seeded } from "../src/patterns";

const RATE = 48_000;
const sine = (hz: number, level = 0.5): Float32Array => Float32Array.from({ length: 2048 }, (_, index) => level * Math.sin((2 * Math.PI * hz * index) / RATE));

describe("hearing", () => {
  it("finds the pitch of a clear tone", () => {
    for (const hz of [90, 110, 220, 330, 440, 700]) {
      const heard = analyse(sine(hz), RATE);
      expect(heard.pitch, `${hz} Hz`).not.toBeNull();
      expect(Math.abs(heard.pitch! / hz - 1), `${hz} Hz`).toBeLessThan(0.015);
      expect(heard.level).toBeCloseTo(0.5 / Math.SQRT2, 1);
    }
  });

  it("hears a rich tone at its root, not at an overtone", () => {
    const rich = Float32Array.from({ length: 2048 }, (_, index) => {
      const phase = (2 * Math.PI * 150 * index) / RATE;
      return 0.3 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase);
    });
    expect(Math.abs(analyse(rich, RATE).pitch! / 150 - 1)).toBeLessThan(0.02);
  });

  it("hears hiss as hiss, and silence as nothing", () => {
    const random = seeded(4);
    const hiss = analyse(Float32Array.from({ length: 2048 }, () => random() - 0.5), RATE);
    expect(hiss.pitch).toBeNull();
    expect(hiss.bright).toBeGreaterThan(3000);
    const quiet = analyse(new Float32Array(2048), RATE);
    expect(quiet).toMatchObject({ level: 0, pitch: null });
  });
});

/** Frames every 16 ms, as the listening side delivers them. */
function frames(seconds: number, at: (time: number) => Partial<Frame>): Frame[] {
  return Array.from({ length: Math.round(seconds / 0.016) }, (_, index) => {
    const time = index * 0.016;
    return { time, level: 0, pitch: null, bright: 1000, ...at(time) };
  });
}

describe("painting what was heard", () => {
  it("turns a falling „bumm“ into one falling stroke that lands low", () => {
    const heard = frames(1, (time) => (time >= 0.2 && time < 0.6 ? { level: 0.4 * (1 - (time - 0.2) / 0.5), pitch: 260 - (time - 0.2) * 400 } : {}));
    const bild = framesToBild(heard, 0)!;
    expect(bild.strokes).toHaveLength(1);
    const stroke = bild.strokes[0]!;
    expect(stroke.kind).toBe(0);
    expect(stroke.swell).toBe(false);
    expect(stroke.points[0]).toBeLessThanOrEqual(1);
    expect(stroke.points[1]).toBeGreaterThan(stroke.points[stroke.points.length - 1]!);
    expect(heightToHz(Math.min(...stroke.points.filter((_, index) => index % 2 === 1)))).toBeCloseTo(52, -1);
    expect(bild.hold).toBeNull();
  });

  it("puts a hummed note on the root of a ring that plays notes", () => {
    const heard = frames(1, (time) => (time >= 0.1 && time < 0.7 ? { level: 0.2, pitch: 183 + Math.sin(time * 40) } : {}));
    const stroke = framesToBild(heard, 6)!.strokes[0]!;
    expect(stroke.kind).toBe(0);
    expect(new Set(stroke.points.filter((_, index) => index % 2 === 1))).toEqual(new Set([hzToHeight(440)]));
  });

  it("turns „tss“ into hiss up high, and a click before a tone into its own dab", () => {
    const hiss = framesToBild(frames(0.6, (time) => (time >= 0.1 && time < 0.3 ? { level: 0.2, bright: 7000 } : {})), 2)!;
    expect(hiss.strokes).toHaveLength(1);
    expect(hiss.strokes[0]!.kind).toBe(2);
    expect(heightToHz(hiss.strokes[0]!.points[1]!)).toBeCloseTo(7000, -3);
    const both = framesToBild(frames(1, (time) => (time >= 0.1 && time < 0.14 ? { level: 0.3, bright: 4000 } : time >= 0.14 && time < 0.5 ? { level: 0.3, pitch: 200 } : {})), 1)!;
    expect(both.strokes.map((stroke) => stroke.kind).sort()).toEqual([0, 2]);
  });

  it("notices a sound that swells", () => {
    const heard = frames(1, (time) => (time >= 0.1 && time < 0.6 ? { level: 0.05 + (time - 0.1) * 0.8, bright: 5000 } : {}));
    expect(framesToBild(heard, 2)!.strokes[0]!.swell).toBe(true);
  });

  it("paints nothing when nothing was heard", () => {
    expect(framesToBild([], 0)).toBeNull();
    expect(framesToBild(frames(1, () => ({ level: 0.003 })), 0)).toBeNull();
  });

  it("squeezes a long sound onto the sheet", () => {
    const heard = frames(2, (time) => (time >= 0.1 && time < 1.9 ? { level: 0.2, pitch: 300 } : {}));
    const stroke = framesToBild(heard, 0)!.strokes[0]!;
    expect(stroke.points[stroke.points.length - 2]).toBeGreaterThan(240);
  });
});

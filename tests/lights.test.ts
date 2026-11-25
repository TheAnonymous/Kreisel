import { describe, expect, it } from "vitest";
import { clear, fade, GLOW_FADE, GLOW_LIFE, Lights, MAX_SPARKS, SPARK_LIFE, sparkAt, WAVE_LIFE, waveAt, type Spark } from "../src/ui/lights";

describe("the light show", () => {
  const spark: Spark = { x: 100, y: 100, vx: 200, vy: 0, born: 10, life: SPARK_LIFE, size: 2, color: "#e4572e" };

  it("lets a spark fly out, ever slower, until nothing is left of it", () => {
    const start = sparkAt(spark, 10);
    expect(start).toEqual({ x: 100, y: 100, left: 1 });
    const early = sparkAt(spark, 10.1).x - 100;
    const late = sparkAt(spark, 10.2).x - sparkAt(spark, 10.1).x;
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
    expect(sparkAt(spark, 10 + SPARK_LIFE / 2).left).toBeCloseTo(0.5, 9);
    expect(sparkAt(spark, 10 + SPARK_LIFE).left).toBe(0);
    expect(sparkAt(spark, 9).left).toBe(1);
  });

  it("lets a wave run out from the hub and die down, a soft kick's less far in strength", () => {
    expect(waveAt({ born: 5, power: 1 }, 5)).toEqual({ reach: 0, left: 1 });
    const middle = waveAt({ born: 5, power: 1 }, 5 + WAVE_LIFE / 2);
    expect(middle.reach).toBeGreaterThan(0.5);
    expect(middle.left).toBeLessThan(0.5);
    const end = waveAt({ born: 5, power: 1 }, 5 + WAVE_LIFE);
    expect(end.reach).toBe(1);
    expect(end.left).toBe(0);
    expect(waveAt({ born: 5, power: 0.4 }, 5).left).toBeCloseTo(0.4, 9);
  });

  it("lets a glow fade evenly and end", () => {
    expect(fade(0)).toBe(1);
    expect(fade(GLOW_FADE)).toBeLessThan(0.37);
    expect(fade(GLOW_LIFE)).toBe(0);
    expect(fade(GLOW_LIFE + 1)).toBe(0);
    let before = 1;
    for (let step = 1; step <= 40; step += 1) {
      const now = fade((step / 40) * GLOW_LIFE);
      expect(now).toBeLessThanOrEqual(before);
      before = now;
    }
    expect(fade(-1)).toBe(1);
  });

  it("takes all of a colour away without changing its hue", () => {
    expect(clear("#e4572e")).toBe("rgba(228, 87, 46, 0)");
    expect(clear("#FFFFFF")).toBe("rgba(255, 255, 255, 0)");
    expect(clear("red")).toBe("rgba(0, 0, 0, 0)");
  });

  it("keeps count of what is in the air, never more sparks than it may, and puts everything out at once", () => {
    const lights = new Lights(null);
    expect(lights.alive).toBe(false);
    lights.strike(1, 300, 100, 600, "#e4572e", 1, 12);
    lights.wave(1, 1);
    expect(lights.count()).toEqual({ sparks: 12, waves: 1, glowing: true });
    expect(lights.alive).toBe(true);
    for (let hit = 0; hit < 40; hit += 1) lights.strike(1, 300, 100, 600, "#e4572e", 1, 12);
    expect(lights.count().sparks).toBe(MAX_SPARKS);
    for (let kick = 0; kick < 20; kick += 1) lights.wave(1, 1);
    expect(lights.count().waves).toBeLessThanOrEqual(6);
    // The glow dies by itself, with no canvas to paint it on as well.
    lights.shine(1 + GLOW_LIFE + 0.01);
    expect(lights.count().glowing).toBe(false);
    lights.clear();
    expect(lights.count()).toEqual({ sparks: 0, waves: 0, glowing: false });
    expect(lights.alive).toBe(false);
  });
});

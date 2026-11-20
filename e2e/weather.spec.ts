import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { focus, onLaptop, onPhone, open, state, status, where } from "./helpers";

/*
 * Wetter: effects painted onto the wheel, and the wind that moves them.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("malt Wetter auf das Rad", async ({ page }) => {
    const problems = await open(page);
    const sky = (kind: number, ring: number): Promise<number[]> =>
      page.evaluate(([which, on]) => window.kreisel.app.project.scenes[window.kreisel.app.project.scene]!.weather[which ?? 0]![on ?? 0]!.slice(0, 16), [kind, ring]);
    /** One stroke of the brush through the middles of steps of rings. */
    const stroke = async (cells: readonly (readonly [number, number])[], button: "left" | "right" = "left"): Promise<void> => {
      const [first, ...rest] = cells;
      if (!first) return;
      let spot = await where(page, first[0], first[1]);
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down({ button });
      for (const [ring, step] of rest) {
        spot = await where(page, ring, step);
        await page.mouse.move(spot.x, spot.y, { steps: 6 });
      }
      await page.mouse.up({ button });
    };

    // The weather is chosen like a ring: then the tools are its six kinds, and the panel is the sky's.
    await page.keyboard.press("9");
    await expect(page.locator(".weather-row")).toHaveClass(/selected/);
    await expect(page.locator("#weathers")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    await expect(page.locator(".panel-weather")).toBeVisible();
    await expect(page.locator(".panel-ring")).toBeHidden();
    await expect(status(page)).toHaveText("Wetter: klarer Himmel");
    await expect(page.locator("#weathers .tool").nth(2)).toHaveAttribute("aria-checked", "true");
    // No ring is in focus now: they all rest at the same width, and the wheel is one sheet.
    await expect.poll(async () => {
      const first = await where(page, 6, 0);
      await page.waitForTimeout(80);
      const second = await where(page, 6, 0);
      return Math.abs(first.y - second.y);
    }).toBeLessThan(0.05);

    // A stroke of clouds along the bass: there and nowhere else, and the hits stay as they are.
    const before = await state(page);
    await stroke([[4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]);
    expect(await sky(2, 4)).toEqual([0, 0, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await sky(2, 3)).every((value) => value === 0)).toBe(true);
    expect((await sky(2, 5)).every((value) => value === 0)).toBe(true);
    await expect(status(page)).toHaveText("Wetter: Wolken auf Bass");
    await expect(page.locator(".weather-row .sound")).toHaveText("Wolken");
    // Over it again, it gets stronger; three times is all there is.
    await stroke([[4, 3], [4, 4], [4, 5]]);
    expect((await sky(2, 4)).slice(2, 7)).toEqual([5, 10, 10, 10, 5]);
    await stroke([[4, 4]]);
    await stroke([[4, 4]]);
    expect((await sky(2, 4))[4]).toBe(15);
    // The right button takes it away; a stroke is one step back.
    await stroke([[4, 5], [4, 6]], "right");
    expect((await sky(2, 4)).slice(2, 7)).toEqual([5, 10, 15, 0, 0]);
    await expect(page.locator("#context")).toBeHidden();
    await page.keyboard.press("Control+z");
    expect((await sky(2, 4)).slice(2, 7)).toEqual([5, 10, 15, 10, 5]);

    // Another weather is on the next key; the wheel makes the brush wider, and a wide brush across the rings takes
    // several with it, each at the step that lies at that angle of its own round.
    await page.keyboard.press("q");
    await expect(page.locator("#weathers .tool").nth(0)).toHaveAttribute("aria-checked", "true");
    const hat = await where(page, 2, 4);
    await page.mouse.move(hat.x, hat.y);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    expect(await page.evaluate(() => window.kreisel.app.weather.cloudSize)).toBe(2);
    await page.mouse.click(hat.x, hat.y);
    const fog = await Promise.all([0, 1, 2, 3, 4].map((ring) => sky(0, ring)));
    expect(fog[2]![4]).toBe(5);
    expect(fog[1]![4]).toBe(5);
    // The tuned drum has twelve steps: the same angle is its fourth.
    expect(fog[3]![3]).toBe(5);
    expect(fog.filter((line) => line.some((value) => value > 0)).length).toBeGreaterThanOrEqual(3);
    await expect(status(page)).toContainText("Nebel auf");
    // Delete takes the weather of the brush away, all of it.
    await page.keyboard.press("Delete");
    expect((await sky(0, 2)).every((value) => value === 0)).toBe(true);
    expect((await sky(2, 4))[4]).toBe(15);

    // Every kind of weather has a wind; the right button holds it still.
    const wind = page.locator(".line.sky input").nth(2);
    await wind.fill("8");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.wind)).toEqual([0, 0, 4, 0, 0, 0]);
    await expect(page.locator(".line.sky output").nth(2)).toHaveText("1 Schritt je Takt ↻");
    await expect(status(page)).toHaveText("Wetter: Wolken auf Bass, zieht 1 Schritt je Takt ↻");
    await wind.click({ button: "right" });
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.wind[2])).toBe(0);

    // Picking a ring leaves the weather where it is; the list says what is in the sky, and the ring's menu clears it there.
    await page.keyboard.press("Escape");
    await expect(page.locator(".panel-ring")).toBeVisible();
    await expect(page.locator("#tools")).toBeVisible();
    await expect(page.locator(".weather-row .sound")).toHaveText("Wolken");
    await focus(page, 4);
    const spot = await where(page, 4, 9);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    const menu = page.locator("#context");
    await menu.getByRole("menuitem", { name: "Das Wetter über diesem Ring wegnehmen" }).click();
    expect((await sky(2, 4)).every((value) => value === 0)).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    expect((await sky(2, 4))[4]).toBe(15);

    // The weather's row has a menu of its own: dice, and a clear sky. Cleared, the Kreisel is as it was.
    await page.locator(".weather-row").click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Wetter");
    await menu.getByRole("menuitem", { name: "Würfeln" }).click();
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.weather.flat(2).some((value) => value > 0))).toBe(true);
    await menu.getByRole("menuitem", { name: "Alles aufklaren" }).click();
    await expect(page.locator(".weather-row .sound")).toHaveText("klar");
    expect(await state(page)).toBe(before);

    // Einspielen: an effect held while the Kreisel turns leaves its weather behind, over every ring; it is one step back.
    await page.evaluate(() => {
      window.kreisel.app.setGlobal({ bpm: 180 });
      window.kreisel.app.rings.toggleLive();
      window.kreisel.app.dismiss();
    });
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.playhead() ?? 0)).toBeGreaterThan(1);
    await page.keyboard.down("KeyZ");
    await page.waitForTimeout(700);
    await page.keyboard.up("KeyZ");
    await page.keyboard.press("Space");
    const trail = await Promise.all([0, 3, 6].map((ring) => sky(0, ring)));
    for (const line of trail) expect(line.filter((value) => value > 0).length).toBeGreaterThanOrEqual(2);
    await expect(page.locator(".weather-row .sound")).toHaveText("Nebel");
    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.weather.flat(2).every((value) => value === 0))).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt das Wetter hören: Nebel, der mit dem Wind zieht, Wolken, Sonne im Bass", async ({ page }) => {
    const problems = await open(page);
    /** Saves the scene with only ring `ring` heard and listens to the file: how bright it is in each half bar, and how loud it rings on after the last step. */
    const listen = async (ring: number, kind = 0, steps: readonly number[] = [], wind = 0): Promise<{ bright: number[]; tail: number }> => {
      await page.evaluate(([only, which, where, blow]) => {
        const app = window.kreisel.app;
        app.store.edit((project) => {
          project.bpm = 150;
          project.pump = 0;
          project.tracks.forEach((track, index) => {
            track.mute = index !== only;
            track.hall = 0;
            track.echo = 0;
          });
          const scene = project.scenes[0]!;
          scene.weather.forEach((rings) => rings.forEach((line) => line.fill(0)));
          scene.wind.fill(0);
          for (const step of where as number[]) scene.weather[which as number]![only as number]![step] = 15;
          scene.wind[which as number] = blow as number;
        });
        app.dismiss();
      }, [ring, kind, [...steps], wind] as const);
      await page.locator("#more").click();
      const rendered = page.waitForEvent("download");
      await page.locator("#menu").getByText("Als Opus speichern").click();
      const bytes = readFileSync(await (await rendered).path());
      return page.evaluate(async (data) => {
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(Uint8Array.from(data).buffer);
        await context.close();
        const samples = buffer.getChannelData(0);
        const rate = buffer.sampleRate;
        const at = (steps: number): number => Math.min(samples.length, Math.round((0.05 + steps * 0.1) * rate));
        // How bright a stretch is: the loudness of what changes from sample to sample.
        const sharp = (from: number, to: number): number => {
          let sum = 0;
          for (let index = Math.max(1, from); index < to; index += 1) sum += ((samples[index] ?? 0) - (samples[index - 1] ?? 0)) ** 2;
          return Math.sqrt(sum / Math.max(1, to - from));
        };
        const loud = (from: number, to: number): number => {
          let sum = 0;
          for (let index = from; index < to; index += 1) sum += (samples[index] ?? 0) ** 2;
          return Math.sqrt(sum / Math.max(1, to - from));
        };
        // Eight bars of sixteen steps; then what rings on.
        const bright = Array.from({ length: 16 }, (_, half) => sharp(at(half * 8), at(half * 8 + 8)));
        return { bright, tail: loud(at(128 + 2), at(128 + 8)) };
      }, [...bytes]);
    };

    // The hi-hat under a clear sky: as bright in the first half of a bar as in the second, and it does not ring on.
    const clear = await listen(2);
    expect(clear.bright[0]! / clear.bright[1]!).toBeGreaterThan(0.4);
    expect(clear.bright[0]! / clear.bright[1]!).toBeLessThan(2.5);
    // Fog over the first half of its ring, with a wind of four steps a bar: in the first bar the first half is dull,
    // two bars later the fog has moved on by half the ring and the second half is.
    const foggy = await listen(2, 0, [0, 1, 2, 3, 4, 5, 6, 7], 16);
    expect(foggy.bright[0]!).toBeLessThan(foggy.bright[1]! * 0.5);
    expect(foggy.bright[0]!).toBeLessThan(clear.bright[0]! * 0.5);
    // (The fog moves on a step every four steps, so the halves are not cut clean: brighter by a third is plenty.)
    expect(foggy.bright[4]!).toBeGreaterThan(foggy.bright[5]! * 1.3);
    // Clouds over all of it: it rings on in the hall.
    const cloudy = await listen(2, 2, Array.from({ length: 16 }, (_, step) => step));
    expect(cloudy.tail).toBeGreaterThan(clear.tail * 3 + 0.0005);
    // Sun over the second half of the bass's ring reaches into the sound itself: those notes are brighter.
    const sunny = await listen(4, 1, [8, 9, 10, 11, 12, 13, 14, 15]);
    const shade = await listen(4);
    expect(sunny.bright[1]! / sunny.bright[0]!).toBeGreaterThan((shade.bright[1]! / shade.bright[0]!) * 1.5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("malt am Handy Wetter mit dem Finger", async ({ page }) => {
    const problems = await open(page);
    await page.locator(".weather-row .pick").tap();
    await expect(page.locator("#weathers")).toBeVisible();
    await expect(page.locator(".panel-weather")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#weathers .tool").nth(3).tap();
    await page.locator("#kreisel").scrollIntoViewIfNeeded();
    // The rings take a moment to come to rest at one width.
    await expect.poll(async () => {
      const first = await where(page, 6, 0);
      await page.waitForTimeout(80);
      const second = await where(page, 6, 0);
      return Math.abs(first.y - second.y);
    }).toBeLessThan(0.05);
    const spot = await where(page, 6, 5);
    await page.touchscreen.tap(spot.x, spot.y);
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.weather[3]![6]![5])).toBe(5);
    await expect(status(page)).toContainText("Regen auf Melodie");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

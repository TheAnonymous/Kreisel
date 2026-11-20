import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { focus, onLaptop, onPhone, open, status } from "./helpers";

/*
 * Nachbeben: the rumble that is painted under the kick.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("malt ein Nachbeben unter die Kick", async ({ page }) => {
    const problems = await open(page);
    const line = (): Promise<number[]> => page.evaluate(() => window.kreisel.app.project.scenes[window.kreisel.app.project.scene]!.rumble.slice(0, 16));
    const quakeAt = (step: number, share: number): Promise<{ x: number; y: number }> => page.evaluate(([at, much]) => window.kreisel.quake(at ?? 0, much ?? 0), [step, share]);
    const hold = page.locator("#tools .tool").nth(4);

    // A drum has no notes to hold: on the kick's ring that tool paints the Nachbeben, and the ring's field has its controls.
    await focus(page, 4);
    await expect(hold).toContainText("Länge");
    await expect(page.locator(".quake")).toBeHidden();
    await focus(page, 0);
    await expect(hold).toContainText("Beben");
    await expect(hold).toBeEnabled();
    await expect(page.locator(".quake")).toBeVisible();

    // Dice lay one of the usual shapes around the kicks: nothing on a kick, something between them.
    await page.locator("#rumble-dice").click();
    let now = await line();
    expect([now[0], now[4], now[8], now[12]]).toEqual([0, 0, 0, 0]);
    expect(now.filter((value) => value > 0)).toHaveLength(12);
    await expect(status(page)).toContainText("Nachbeben");
    await expect(page.locator("#toast")).toContainText("Nachbeben: Offbeat");
    await page.locator("#rumble-off").click();
    expect((await line()).every((value) => value === 0)).toBe(true);
    await expect(status(page)).toHaveText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");

    // Painting: one stroke along the ring. Far out is a lot, further in is less; the kicks stay as they are.
    await page.locator("#rumble-paint").click();
    await expect(hold).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() => window.kreisel.app.dismiss());
    /** Moves the pointer along the ring, from one place to another (in steps, 1.5 is the middle of the second), at one share of the ring's width. */
    const along = async (from: number, to: number, share: number): Promise<void> => {
      for (let place = from; place <= to + 1e-9; place += 0.2) {
        const point = await quakeAt(place - 0.5, share);
        await page.mouse.move(point.x, point.y);
      }
    };
    let spot = await quakeAt(1, 1);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await along(1.5, 4.1, 1);
    // Pulled inwards within a step, the step follows; then on at that height.
    await along(4.1, 6.5, 0.4);
    await page.mouse.up();
    now = await line();
    expect(now.slice(0, 7)).toEqual([0, 15, 15, 15, 6, 6, 6]);
    expect(now.slice(7).every((value) => value === 0)).toBe(true);
    await expect(status(page)).toContainText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16 · Nachbeben auf 6 von 16 Schritten");

    // Pulled along the ring, the right button erases and opens no menu. Each stroke is one step back.
    spot = await quakeAt(5, 0.5);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down({ button: "right" });
    spot = await quakeAt(6, 0.5);
    await page.mouse.move(spot.x, spot.y, { steps: 5 });
    await page.mouse.up({ button: "right" });
    now = await line();
    expect([now[3], now[5], now[6]]).toEqual([15, 0, 0]);
    await expect(page.locator("#context")).toBeHidden();
    await page.keyboard.press("Control+z");
    expect((await line())[6]).toBe(6);
    await page.keyboard.press("Control+z");
    expect((await line()).every((value) => value === 0)).toBe(true);

    // Let go where it came down, the right button opens the ring's menu, which has the shapes.
    spot = await quakeAt(2, 0.5);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu.locator("header")).toHaveText("Kick · Schritt 3");
    await expect(menu.getByRole("menuitemradio", { name: "Das Nachbeben wegnehmen" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: /Form „Rollend“/ }).click();
    expect((await line()).slice(0, 4)).toEqual([0, 15, 13, 15]);
    await expect(menu.getByRole("menuitemradio", { name: /Form „Rollend“/ })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    // A shape brings its way of rolling; the character has two sliders, and the right button puts them back.
    await expect(page.locator("#rumble-roll")).toHaveValue("85");
    await page.locator("#rumble-dirt").fill("100");
    expect(await page.evaluate(() => window.kreisel.app.project.dirt)).toBe(1);
    await page.locator("#rumble-dirt").click({ button: "right" });
    expect(await page.evaluate(() => window.kreisel.app.project.dirt)).toBe(0.35);

    // The ring turns with its Nachbeben.
    await page.evaluate(() => window.kreisel.app.rings.rotate(0, 1));
    expect((await line()).slice(0, 6)).toEqual([15, 0, 15, 13, 15, 0]);
    await expect(status(page)).toContainText("Kick: 4 Schläge auf 2, 6, 10, 14 von 16");
    await page.keyboard.press("Control+z");
    expect((await line()).slice(0, 4)).toEqual([0, 15, 13, 15]);

    // The keyboard: at the cursor, Enter gives a step some, all, none; plus and minus a little more or less.
    await page.locator("#rumble-off").click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    expect((await line())[1]).toBe(9);
    await page.keyboard.press("+");
    expect((await line())[1]).toBe(11);
    await page.keyboard.press("Enter");
    expect((await line())[1]).toBe(15);
    await page.keyboard.press("Enter");
    expect((await line())[1]).toBe(0);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt es zwischen den Kicks beben, in der Tonart", async ({ page }) => {
    const problems = await open(page);
    // Only the kick is heard, at 150 BPM: a sixteenth is a tenth of a second.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 150, pump: 0 });
      for (let track = 1; track < 7; track += 1) app.rings.setTrack(track, { mute: true });
      app.select(0);
      app.dismiss();
    });
    /** Saves the scene and listens to the file: how loud it is between the kicks, and how much each bar sits on the root of its own chord rather than the next bar's. */
    const listen = async (): Promise<{ between: number; own: number[] }> => {
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
        const at = (steps: number): number => Math.round((0.05 + steps * 0.1) * rate);
        let sum = 0;
        let count = 0;
        for (let beat = 0; beat < 16; beat += 1) {
          for (let index = at(beat * 4 + 1.8); index < at(beat * 4 + 3.8); index += 1) {
            sum += (samples[index] ?? 0) ** 2;
            count += 1;
          }
        }
        const strength = (from: number, to: number, hz: number): number => {
          const coefficient = 2 * Math.cos((2 * Math.PI * hz) / rate);
          let one = 0;
          let two = 0;
          for (let index = from; index < to; index += 1) {
            const next = (samples[index] ?? 0) + coefficient * one - two;
            two = one;
            one = next;
          }
          return Math.sqrt(Math.max(0, one * one + two * two - coefficient * one * two));
        };
        // The factory Kreisel's chords are A minor, F, C and G: their roots, where a rumble lives.
        const roots = [55, 43.654, 65.406, 48.999];
        const own = roots.map((hz, bar) => strength(at(bar * 16 + 2), at(bar * 16 + 15), hz) / (strength(at(bar * 16 + 2), at(bar * 16 + 15), roots[(bar + 1) % 4] ?? hz) + 1e-9));
        return { between: Math.sqrt(sum / Math.max(1, count)), own };
      }, [...bytes]);
    };

    // Without a Nachbeben there is next to nothing between the kicks.
    const dry = await listen();
    expect(dry.between).toBeLessThan(0.01);
    // With one, the ground shakes there, and in every bar at the root of that bar's chord.
    await page.evaluate(() => {
      window.kreisel.app.rumble.shape(0);
      window.kreisel.app.dismiss();
    });
    const shaking = await listen();
    expect(shaking.between).toBeGreaterThan(0.06);
    expect(shaking.between).toBeGreaterThan(dry.between * 20);
    for (const share of shaking.own) expect(share).toBeGreaterThan(3);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("legt am Handy ein Nachbeben unter die Kick und malt es mit dem Finger", async ({ page }) => {
    const problems = await open(page);
    const line = (): Promise<number[]> => page.evaluate(() => window.kreisel.app.project.scenes[0]!.rumble.slice(0, 16));
    await focus(page, 0);
    await page.locator("#rumble-dice").tap();
    expect((await line()).filter((value) => value > 0)).toHaveLength(12);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#rumble-off").tap();
    await page.locator("#rumble-paint").tap();
    await page.evaluate(() => window.kreisel.app.dismiss());
    await page.locator("#kreisel").scrollIntoViewIfNeeded();
    const spot = await page.evaluate(() => window.kreisel.quake(2, 1));
    await page.touchscreen.tap(spot.x, spot.y);
    expect((await line())[2]).toBe(15);
    await expect(status(page)).toContainText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16 · Nachbeben auf 1 von 16 Schritten");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

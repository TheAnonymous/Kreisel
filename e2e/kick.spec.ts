import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { focus, onLaptop, onPhone, open } from "./helpers";

/*
 * The kick itself: how hard it is driven, and that it lands in the key.
 */

/** How far from its note the kick may be heard, in Hz (the next note of the key is 6 Hz and more away). */
const OFF = 1.5;
/** How much more of the body stands when the kick is driven hard. */
const STANDS = 1.5;
/** How much of the third overtone a clipped body has at least (a clean one has next to none). */
const CLIPPED = 0.05;

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("macht die Kick hart und lässt sie in der Tonart landen", async ({ page }) => {
    const problems = await open(page);
    // Only the kick is heard, four on the floor at 150 BPM (a sixteenth is a tenth of a second), ringing as long as it can.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 150, pump: 0 });
      for (let track = 1; track < 7; track += 1) app.rings.setTrack(track, { mute: true });
      app.rings.setTrack(0, { sound: 1, y: 1 });
      app.dismiss();
    });
    const hard = (): Promise<number> => page.evaluate(() => window.kreisel.app.project.hard);
    const character = (): Promise<number[]> => page.evaluate(() => (JSON.parse(window.kreisel.state()) as { w: number[] }).w);
    const slider = page.locator("#kick-hard");

    // The control is the kick's: it is in the field of the kick's ring only. A fresh Kreisel has a clean kick, which costs nothing in the link.
    await focus(page, 4);
    await expect(slider).toBeHidden();
    await focus(page, 0);
    await expect(slider).toBeVisible();
    expect(await hard()).toBe(0);
    expect(await character()).toEqual([35, 20]);

    /**
     * Saves the scene and listens to the kicks in the file once their fall is over: how much of the body still stands
     * then (against the first moment), the note it sits on (by how often it crosses nought), and how much of that
     * note's third overtone is in it, which a clean kick has next to none of and a clipped one a lot.
     */
    const listen = async (): Promise<{ body: number; hz: number; third: number }> => {
      await page.locator("#more").click();
      const rendered = page.waitForEvent("download");
      await page.locator("#menu").getByText("Als Opus speichern").click();
      const bytes = readFileSync(await (await rendered).path());
      await page.evaluate(() => window.kreisel.app.dismiss());
      return page.evaluate(async (data) => {
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(Uint8Array.from(data).buffer);
        await context.close();
        const samples = buffer.getChannelData(0);
        const rate = buffer.sampleRate;
        const at = (steps: number, later = 0): number => Math.round((0.05 + steps * 0.1 + later) * rate);
        const power = (from: number, to: number): number => {
          let sum = 0;
          for (let index = from; index < to; index += 1) sum += (samples[index] ?? 0) ** 2;
          return sum / Math.max(1, to - from);
        };
        let early = 0;
        let late = 0;
        let hz = 0;
        let third = 0;
        let kicks = 0;
        for (let beat = 4; beat < 16; beat += 1) {
          early += power(at(beat * 4), at(beat * 4, 0.05));
          late += power(at(beat * 4, 0.05), at(beat * 4, 0.15));
          const from = at(beat * 4, 0.06);
          const to = at(beat * 4, 0.22);
          const crossings: number[] = [];
          for (let index = from + 1; index < to; index += 1) {
            const before = samples[index - 1] ?? 0;
            const now = samples[index] ?? 0;
            if ((before < 0 && now >= 0) || (before > 0 && now <= 0)) crossings.push(index - 1 + before / (before - now));
          }
          if (crossings.length < 3) continue;
          const note = ((crossings.length - 1) * rate) / (2 * ((crossings[crossings.length - 1] ?? 0) - (crossings[0] ?? 0)));
          // The overtone is listened for earlier, while the body is still pressed flat.
          const start = at(beat * 4, 0.05);
          const end = at(beat * 4, 0.13);
          const part = (frequency: number): number => {
            let real = 0;
            let imaginary = 0;
            for (let index = start; index < end; index += 1) {
              const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (index - start)) / (end - start));
              const angle = (2 * Math.PI * frequency * index) / rate;
              real += window * (samples[index] ?? 0) * Math.cos(angle);
              imaginary += window * (samples[index] ?? 0) * Math.sin(angle);
            }
            return Math.hypot(real, imaginary);
          };
          hz += note;
          third += part(note * 3) / Math.max(1e-12, part(note));
          kicks += 1;
        }
        return { body: Math.sqrt(late / Math.max(1e-12, early)), hz: hz / Math.max(1, kicks), third: third / Math.max(1, kicks) };
      }, [...bytes]);
    };

    // In A minor the kick "Hart" lands on A: 55 Hz.
    const clean = await listen();
    expect(Math.abs(clean.hz - 55)).toBeLessThan(OFF);

    // Driven hard, its body stands and is clipped, and it has not moved from its note.
    await slider.fill("80");
    expect(await hard()).toBe(0.8);
    expect(await character()).toEqual([35, 20, 80]);
    const driven = await listen();
    expect(driven.body).toBeGreaterThan(clean.body * STANDS);
    expect(driven.third).toBeGreaterThan(CLIPPED);
    expect(driven.third).toBeGreaterThan(clean.third * 3);
    expect(Math.abs(driven.hz - 55)).toBeLessThan(OFF);

    // In C the same kick lands on G, the key's fifth (49 Hz): that is nearer to where the sound puts it than C is.
    await page.evaluate(() => window.kreisel.app.setGlobal({ root: 0 }));
    const moved = await listen();
    expect(Math.abs(moved.hz - 48.999)).toBeLessThan(OFF);
    await page.evaluate(() => window.kreisel.app.setGlobal({ root: 9 }));

    // The right button puts the control back; that can be taken back like anything else.
    await slider.click({ button: "right" });
    expect(await hard()).toBe(0);
    await page.keyboard.press("Control+z");
    expect(await hard()).toBe(0.8);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("hat am Handy den Regler für die Härte der Kick, und das Feld passt in die Breite", async ({ page }) => {
    const problems = await open(page);
    await focus(page, 0);
    const slider = page.locator("#kick-hard");
    await slider.scrollIntoViewIfNeeded();
    await expect(slider).toBeVisible();
    expect((await slider.boundingBox())!.width).toBeGreaterThan(150);
    await slider.fill("60");
    expect(await page.evaluate(() => window.kreisel.app.project.hard)).toBe(0.6);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

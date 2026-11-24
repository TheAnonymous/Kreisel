import { expect, test } from "@playwright/test";
import { focus, onLaptop, onPhone, open } from "./helpers";

/*
 * Hardness: "Zerre", which drives one ring, and "Druck", which presses the
 * sum of everything. What they do is measured on the whole Kreisel, rendered
 * faster than it plays.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("treibt einen Ring in die Zerre: dichter, kaum lauter, und die Kick bleibt aus dem Spiel", async ({ page }) => {
    const problems = await open(page);
    const row = page.locator("#drive-row");
    const slider = row.locator("input");
    const drive = (ring: number) => page.evaluate((track) => window.kreisel.app.project.tracks[track]!.drive, ring);

    // Every ring but the kick has the control; it is the ring's own and one step back.
    await focus(page, 4);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Zerre");
    await expect(slider).toHaveValue("0");
    await slider.fill("60");
    expect(await drive(4)).toBe(0.6);
    expect(await drive(5)).toBe(0);
    await page.keyboard.press("Control+z");
    expect(await drive(4)).toBe(0);
    await page.keyboard.press("Control+Shift+z");
    await focus(page, 5);
    await expect(slider).toHaveValue("0");
    await focus(page, 4);
    await expect(slider).toHaveValue("60");
    // The right button puts it back where the Werks-Kreisel has it.
    await slider.click({ button: "right" });
    expect(await drive(4)).toBe(0);
    await focus(page, 0);
    await expect(row).toBeHidden();

    // The techno Kreisel's acid line by itself and not pressed, clean and driven: its peaks come down to its body, and it is about as loud.
    const bass = (amount: number) => page.evaluate(async (much) => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.setGlobal({ pressure: 0 });
      for (let ring = 0; ring < 7; ring += 1) app.rings.setTrack(ring, { mute: ring !== 4, drive: ring === 4 ? much : 0 });
      return window.kreisel.whole();
    }, amount);
    const clean = await bass(0);
    const half = await bass(0.5);
    const full = await bass(1);
    expect(clean.crest - full.crest).toBeGreaterThan(3);
    // How loud a half-driven ring is depends a little on the browser (see `driveTrim`): within 3.5 dB in any of them.
    expect(Math.abs(20 * Math.log10(half.loud / clean.loud))).toBeLessThan(3.5);
    expect(20 * Math.log10(full.loud / clean.loud)).toBeGreaterThan(0);
    expect(20 * Math.log10(full.loud / clean.loud)).toBeLessThan(4);
    expect(full.peak).toBeLessThanOrEqual(clean.peak * 1.3);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("presst alles zusammen: lauter und dichter, die Tiefen in der Mitte, und in Ruhe wie zuvor", async ({ page }) => {
    // Seven renders of the whole Kreisel: more than the usual half minute on a busy laptop.
    test.setTimeout(90_000);
    const problems = await open(page);
    // One chord instead of four: what is rendered is a quarter as long.
    await page.evaluate(() => window.kreisel.app.chords.setBars(1));
    const slider = page.locator("#pressure");
    const pressure = () => page.evaluate(() => window.kreisel.app.project.pressure);
    const whole = () => page.evaluate(() => window.kreisel.whole());
    const louder = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);

    // The control is behind the speaker in the bar, under the volume.
    await page.locator("#sound").click();
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue("0");
    const rest = await whole();
    await slider.fill("100");
    expect(await pressure()).toBe(1);
    const full = await whole();
    expect(louder(full, rest)).toBeGreaterThan(3);
    expect(rest.crest - full.crest).toBeGreaterThan(2);
    expect(full.peak).toBeLessThanOrEqual(0.99);
    await slider.fill("35");
    const some = await whole();
    expect(louder(some, rest)).toBeGreaterThan(1);
    expect(louder(full, some)).toBeGreaterThan(1);
    // The right button lets go of it, and the Kreisel is what it was.
    await slider.click({ button: "right" });
    expect(await pressure()).toBe(0);
    const again = await whole();
    expect(Math.abs(louder(again, rest))).toBeLessThan(0.1);
    expect(again.peak).toBeCloseTo(rest.peak, 2);
    await page.keyboard.press("Escape");

    // A bass whose echo jumps from side to side has lows on both sides; the least pressure brings them to the middle.
    const lows = (amount: number) => page.evaluate(async (much) => {
      const app = window.kreisel.app;
      for (let ring = 0; ring < 7; ring += 1) app.rings.setTrack(ring, { mute: ring !== 4, echo: ring === 4 ? 0.9 : 0 });
      app.setGlobal({ pressure: much });
      return window.kreisel.whole();
    }, amount);
    const apart = await lows(0);
    const together = await lows(0.02);
    expect(apart.lowSide).toBeGreaterThan(0.2);
    expect(together.lowSide).toBeLessThan(apart.lowSide / 3);
    // Lows that stood on one side only lose a little when the two sides are added up; more than that would be a fault.
    expect(Math.abs(louder(together, apart))).toBeLessThan(3);

    // The techno Kreisel starts driven and pressed, without clipping.
    await page.evaluate(() => window.plainTechno());
    await page.locator("#sound").click();
    await expect(slider).toHaveValue("35");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.kreisel.app.project.tracks.map((track) => track.drive > 0))).toEqual([false, true, true, true, true, true, true]);
    const techno = await whole();
    expect(techno.peak).toBeLessThanOrEqual(0.99);
    expect(techno.crest).toBeLessThan(12);
    await focus(page, 4);
    await expect(page.locator("#drive-row input")).toHaveValue("40");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("hat am Handy die Zerre im Feld des Rings und den Druck im Menü, und passt in die Breite", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.select(4));
    const row = page.locator("#drive-row");
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await row.locator("input").fill("50");
    expect(await page.evaluate(() => window.kreisel.app.project.tracks[4]!.drive)).toBe(0.5);
    await page.locator("#more").scrollIntoViewIfNeeded();
    await page.locator("#more").tap();
    await page.locator("#pressure").fill("40");
    expect(await page.evaluate(() => window.kreisel.app.project.pressure)).toBe(0.4);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

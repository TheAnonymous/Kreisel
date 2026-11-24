import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onLaptop, onPhone, open, pieceOf } from "./helpers";

/*
 * Playing the tension by hand: the key "Build-up" builds up for as long as it
 * is held and lands on the next one when it is let go, and "Einspielen" on
 * the piece's ring writes the tension into the line while the piece plays.
 */

/** Hz of the low cut on the sum right now (where nothing is cut before the sound has been built), and whether a build-up is held by hand. */
const lowCut = (page: Page): Promise<number> => page.evaluate(() => (window.kreisel.app.engine as unknown as { host: { graph: { highpass: BiquadFilterNode } | null } }).host.graph?.highpass.frequency.value ?? 20);
const held = (page: Page): Promise<boolean> => page.evaluate(() => ((window.kreisel.app.engine as unknown as { player: { hand: unknown } | null }).player?.hand ?? null) !== null);

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("baut auf, solange die Taste „Build-up“ gehalten ist, und landet beim Loslassen auf der nächsten Eins", async ({ page }) => {
    test.slow();
    const problems = await open(page);
    await page.evaluate(() => {
      window.kreisel.app.newProject(false, "techno");
      window.kreisel.app.dismiss();
      window.kreisel.app.setGlobal({ bpm: 200 });
    });
    const pad = page.locator('#fx [data-fx="aufbau"]');
    await expect(pad).toContainText("Build-up");
    await expect(pad).not.toHaveClass(/held/);
    // Six effect keys stand beside the wheel, and all of them are on the page.
    expect(await page.evaluate(() => [...document.querySelectorAll("#fx .pad-fx")].every((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }))).toBe(true);
    await expect(page.locator("#fx .pad-fx")).toHaveCount(6);

    // Without anything playing the key does nothing.
    await page.keyboard.down("Comma");
    await expect(pad).toHaveClass(/held/);
    expect(await held(page)).toBe(false);
    await page.keyboard.up("Comma");

    // Round a scene: held for two bars, the lows go; let go, they are back at the next bar line.
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 5000 }).toBeGreaterThan(0.05);
    expect(await lowCut(page)).toBeLessThan(21);
    await page.keyboard.down("Comma");
    await expect.poll(() => held(page)).toBe(true);
    await expect.poll(() => lowCut(page), { timeout: 8000 }).toBeGreaterThan(24);
    const early = await lowCut(page);
    await page.waitForTimeout(1500);
    expect(await lowCut(page)).toBeGreaterThan(early);
    await page.keyboard.up("Comma");
    await expect(pad).not.toHaveClass(/held/);
    await expect.poll(() => held(page), { timeout: 5000 }).toBe(false);
    await expect.poll(() => lowCut(page), { timeout: 3000 }).toBeLessThan(21);
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 5000 }).toBeGreaterThan(0.05);

    // By a piece too, with the mouse on the key: the piece's own build-ups wait meanwhile.
    await page.evaluate(() => window.kreisel.app.piece.playFrom(20));
    await pad.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
    await expect.poll(() => held(page)).toBe(true);
    await expect.poll(() => lowCut(page), { timeout: 8000 }).toBeGreaterThan(24);
    // Stopping the Kreisel lets the key go and opens the sound at once.
    await page.keyboard.press("Space");
    await expect.poll(() => held(page)).toBe(false);
    await expect.poll(() => lowCut(page), { timeout: 3000 }).toBeLessThan(21);
    await expect(pad).not.toHaveClass(/held/);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt die Spannung ein: Mausrad und Pfeiltasten schreiben sie Takt für Takt in die Linie", async ({ page }) => {
    test.slow();
    const problems = await open(page);
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      app.dismiss();
      app.setGlobal({ bpm: 220 });
      app.store.edit((project) => {
        const line = Array.from({ length: 16 }, () => 10);
        project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6] };
      });
    });
    await focusPiece(page);
    const ride = page.locator("#piece-ride");
    await expect(ride).toContainText("Einspielen");
    await expect(ride).toHaveAttribute("aria-pressed", "false");
    await ride.click();
    await expect(ride).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#panel")).toContainText("Einspielen: 32 % Spannung");
    // The arrows are the hand: ten steps up.
    for (let press = 0; press < 10; press += 1) await page.keyboard.press("ArrowUp");
    await expect(page.locator("#panel")).toContainText("Einspielen: 65 % Spannung");
    expect((await pieceOf(page)).tension.every((tension) => tension === 10)).toBe(true);
    // The piece plays: every bar that begins hands the tension to the one after it.
    await page.evaluate(() => window.kreisel.app.piece.playFrom(0));
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead() ?? 0), { timeout: 10_000 }).toBeGreaterThan(2.2);
    const first = (await pieceOf(page)).tension;
    expect(first.slice(1, 4)).toEqual([20, 20, 20]);
    expect(first[8]).toBe(10);
    // The mouse wheel over the piece's ring is the hand too: up is more.
    const over = await barAt(page, 8, 0.5);
    await page.mouse.move(over.x, over.y);
    await page.mouse.wheel(0, -180);
    await expect(page.locator("#panel")).toContainText("Einspielen: 77 % Spannung");
    const now = Math.floor(await page.evaluate(() => window.kreisel.app.piece.playhead() ?? 0));
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead() ?? 0), { timeout: 10_000 }).toBeGreaterThan(now + 2.2);
    expect((await pieceOf(page)).tension[(now + 3) % 16]).toBe(24);
    await page.keyboard.press("Space");
    // One step back takes the whole ride away.
    await page.keyboard.press("Control+z");
    expect((await pieceOf(page)).tension.every((tension) => tension === 10)).toBe(true);
    // The key E switches it off again; then the wheel turns the piece as before.
    await page.keyboard.press("e");
    await expect(ride).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#panel")).not.toContainText("Einspielen:");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("hat am Handy sechs Effekt-Tasten, und nichts ist breiter als der Bildschirm", async ({ page }) => {
    const problems = await open(page);
    await expect(page.locator("#fx .pad-fx")).toHaveCount(6);
    await expect(page.locator('#fx [data-fx="aufbau"]')).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll("#fx .pad-fx")].every((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; }))).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

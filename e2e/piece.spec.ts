import { expect, test } from "@playwright/test";
import { barAt, copyLink, focusPiece, heard, onPhone, open, pieceOf, state, status } from "./helpers";

/*
 * The piece's ring: the tension of the whole piece, painted around the wheel.
 */

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("paints the piece into the outermost ring", async ({ page }) => {
    const problems = await open(page);
    expect((await pieceOf(page)).on).toBe(false);
    // A click on the resting ring picks it and paints at once.
    const first = await barAt(page, 2, 0.9);
    await page.mouse.click(first.x, first.y);
    await expect(status(page)).toHaveText("Piece: 32 bars, 1:09 minutes, 66 % tension on average (off)");
    await expect(page.locator(".piece-row")).toHaveClass(/selected/);
    await expect(page.locator(".panel-piece")).toContainText("Who comes in first");
    expect((await pieceOf(page)).tension[2]).toBeGreaterThan(24);
    await focusPiece(page);

    // A stroke along the ring sets bar after bar, and is one step back.
    const before = (await pieceOf(page)).tension;
    await page.mouse.move((await barAt(page, 10, 0.5)).x, (await barAt(page, 10, 0.5)).y);
    await page.mouse.down();
    for (const bar of [11, 12, 13]) {
      const spot = await barAt(page, bar, 0.5);
      await page.mouse.move(spot.x, spot.y, { steps: 4 });
    }
    await page.mouse.up();
    for (const tension of (await pieceOf(page)).tension.slice(10, 14)) expect(Math.abs(tension - 15.5)).toBeLessThanOrEqual(2);
    await page.keyboard.press("Control+z");
    expect((await pieceOf(page)).tension).toEqual(before);
    await page.keyboard.press("Control+Shift+z");

    // The wheel turns the piece, the keyboard moves from bar to bar and changes the tension.
    const turned = (await pieceOf(page)).tension;
    await page.mouse.wheel(0, 50);
    expect((await pieceOf(page)).tension).toEqual([turned[31], ...turned.slice(0, 31)]);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const low = (await pieceOf(page)).tension[1]!;
    await page.keyboard.press("+");
    expect((await pieceOf(page)).tension[1]).toBe(Math.min(31, low + 2));

    // Its length stretches the line; the order of the rings is the piece's to keep.
    await page.locator(".panel-piece").getByTitle("64 bars").click();
    expect((await pieceOf(page)).tension).toHaveLength(64);
    await expect(page.locator(".piece-row .sound")).toHaveText("64 bars");
    await page.getByRole("button", { name: "Let Kick come in earlier" }).click();
    expect((await pieceOf(page)).order).toEqual([5, 2, 0, 4, 1, 6, 3]);
    await page.locator(".panel-piece").getByText("Dice").click();
    expect(Math.max(...(await pieceOf(page)).tension)).toBeGreaterThan(25);

    // Switched on, the piece lays the scenes out itself.
    await page.locator(".piece-toggle").click();
    expect((await pieceOf(page)).on).toBe(true);
    await expect(page.locator("#plays").getByRole("radio", { name: "Piece" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#piece-on")).toBeChecked();
    // Back on a ring, the ring's panel is back.
    await page.keyboard.press("ArrowDown");
    await expect(status(page)).toContainText("Melody:");
    await expect(page.locator(".panel-ring")).toBeVisible();
    await expect(page.locator(".panel-piece")).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("plays by the piece: entries, scenes and jumps", async ({ page }) => {
    const problems = await open(page);
    // Eight quick bars: four of silence in scene A, four of everything in scene B.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.scenes.pick(1);
      app.scenes.pick(0);
      app.dismiss();
      app.store.edit((project) => {
        project.bpm = 200;
        project.piece = { on: true, tension: [0, 0, 0, 0, 31, 31, 31, 31], scenes: [0, 0, 0, 0, 1, 1, 1, 1], order: project.piece.order };
      });
    });
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead() ?? 0)).toBeGreaterThan(0.4);
    let loudest = 0;
    for (let look = 0; look < 12; look += 1) {
      loudest = Math.max(loudest, await page.evaluate(() => window.kreisel.level()));
      await page.waitForTimeout(50);
    }
    expect(loudest).toBeLessThan(0.01);
    await expect(page.locator(".scene.current")).toHaveText("A");
    // The second half: everyone plays, in scene B. (The bar before it is no longer silent: it takes the run-up.)
    // (On a busy machine the sound can take a few seconds to get going: the wait is generous.)
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead() ?? 0), { timeout: 16000 }).toBeGreaterThan(4.3);
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.05);
    await expect(page.locator(".scene.current")).toHaveText("B");

    // The right button on a bar offers to play from there; "From the top" goes to the first.
    await focusPiece(page);
    const quiet = await barAt(page, 1, 0.5);
    await page.mouse.click(quiet.x, quiet.y, { button: "right" });
    await page.locator("#context").getByRole("menuitem", { name: "Play from here" }).click();
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piece.playhead() ?? 9)), { timeout: 4000 }).toBe(1);
    await expect(page.locator(".scene.current")).toHaveText("A");
    await page.locator("#piece-top").click();
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piece.playhead() ?? 9)), { timeout: 4000 }).toBe(0);
    // Switched off while it plays, the Kreisel goes back to its loop and is heard at once.
    await page.locator(".piece-toggle").click();
    // (The loop takes over at the next step; what is heard a moment before may still be the piece ringing out.)
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piece.playhead()), { timeout: 6000 }).toBeNull();
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 6000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");
    expect(problems).toEqual([]);
  });

  test("saves the piece as Opus and carries it in the link", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.store.edit((project) => {
        project.bpm = 200;
        project.piece = { on: true, tension: [8, 14, 31, 31], scenes: [0, 0, 0, 0], order: [0, 1, 2, 3, 4, 5, 6] };
      });
    });
    await page.keyboard.press("8");
    const rendered = page.waitForEvent("download");
    await page.locator(".panel-piece").getByText("Save as Opus").click();
    const saved = await rendered;
    await expect(page.locator("#toast")).toContainText("The whole piece saved as Opus");
    // Four bars at 200 BPM are 4.8 seconds, plus what rings out: not the eight bars of a plain scene.
    const piece = await heard(page, saved);
    expect(piece.seconds).toBeGreaterThan(4.8);
    expect(piece.seconds).toBeLessThan(8.5);
    expect(piece.peak).toBeGreaterThan(0.2);

    const shared = await state(page);
    await copyLink(page);
    await expect(page.locator("#toast")).toContainText("Link copied");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("A shared Kreisel");
    expect(await state(other)).toBe(shared);
    expect(await pieceOf(other)).toEqual({ on: true, tension: [8, 14, 31, 31], scenes: [0, 0, 0, 0], order: [0, 1, 2, 3, 4, 5, 6] });
  });
});

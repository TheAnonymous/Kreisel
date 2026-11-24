import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onPhone, open, pieceOf, status } from "./helpers";

/*
 * Seeing the arc and dicing it: the piece's dice have four shapes of their
 * own, the status line counts the bars to the next drop while the piece
 * plays, and the piece can be read written down phrase by phrase.
 */

const menuOf = (page: Page) => page.locator("#context");

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("dices the piece in four shapes: Plateau, Two drops, Waves, Long climb", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.plainTechno(); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const menu = menuOf(page);
    const breaks = async (): Promise<number> => ((await pieceOf(page)).noKick ?? []).filter(Boolean).length;
    const steepest = async (): Promise<number> => { const line = (await pieceOf(page)).tension; return Math.max(...line.map((tension, bar) => Math.abs(tension - (line[(bar + 111) % 112] ?? tension)))); };
    // The right button on the dice opens the piece's menu, where the shapes are.
    await page.locator("#piece-dice").click({ button: "right" });
    await expect(menu).toContainText("Dice a shape");
    for (const name of ["Plateau", "Two drops", "Waves", "Long climb"]) await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
    // Lang gezogen: one climb, no break, nowhere a step.
    await menu.getByRole("menuitem", { name: /^Long climb/ }).click();
    let line = (await pieceOf(page)).tension;
    expect(line.every((tension, bar) => bar === 0 || tension >= (line[bar - 1] ?? 0))).toBe(true);
    expect([line[0]! < 6, line[111]]).toEqual([true, 31]);
    expect(await breaks()).toBe(0);
    // Plateau: no break either, and only small steps (the turn of the ring aside).
    await menu.getByRole("menuitem", { name: /^Plateau/ }).click();
    line = (await pieceOf(page)).tension;
    expect(await breaks()).toBe(0);
    expect(Math.max(...line.slice(1).map((tension, index) => Math.abs(tension - (line[index] ?? tension))))).toBeLessThan(5);
    expect((await pieceOf(page)).drops).toBeUndefined();
    // Zwei Drops: two breaks, and the drop after the second has the big build-up, late.
    await menu.getByRole("menuitem", { name: /^Two drops/ }).click();
    expect(await breaks()).toBeGreaterThan(8);
    const drops = (await pieceOf(page)).drops ?? [];
    expect(drops).toHaveLength(2);
    expect(drops[1]!.build).toMatchObject({ bars: 8, late: true });
    expect(drops[0]!.build).toMatchObject({ bars: 4, late: false });
    // Wellen: no break, and steps up that are drops.
    await menu.getByRole("menuitem", { name: /^Waves/ }).click();
    expect(await breaks()).toBe(0);
    expect(await steepest()).toBeGreaterThan(8);
    await page.keyboard.press("Escape");
    // Each throw is one step back; the dice's own key still throws the form of the Kreisel's style.
    await page.keyboard.press("Control+z");
    expect(((await pieceOf(page)).drops ?? []).length).toBe(2);
    await page.keyboard.press("n");
    expect(await breaks()).toBe(16);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("counts the bars to the next drop in the status line while the piece plays", async ({ page }) => {
    test.slow();
    const problems = await open(page);
    await page.evaluate(() => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.dismiss();
      app.setGlobal({ bpm: 220 });
    });
    await focusPiece(page);
    await expect(status(page)).not.toContainText("Drop in");
    await page.evaluate(() => window.kreisel.app.piece.playFrom(11));
    // From bar 12 the drop in bar 17 is five bars away, then four, and so on.
    await expect(status(page)).toContainText("Drop in 5 bars", { timeout: 8000 });
    await expect(status(page)).toContainText("Drop in 3 bars", { timeout: 8000 });
    await expect(status(page)).toContainText("Drop in 1 bar", { timeout: 8000 });
    await expect(status(page)).not.toContainText("Drop in 1 bars");
    // After it has landed the next one is 48 bars off; with a ring in focus the status line says it too.
    await expect(status(page)).toContainText(/Drop in 4[5-8] bars/, { timeout: 8000 });
    await page.evaluate(() => window.kreisel.app.select(0));
    await expect(status(page)).toContainText(/^Kick: .* · Drop in 4\d bars$/);
    await page.keyboard.press("Space");
    await expect(status(page)).not.toContainText("Drop in");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("writes the piece down as an outline: who plays in which eight bars, and where break, build-up and drop are", async ({ page, browserName }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.plainTechno(); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const bar = await barAt(page, 30, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menuOf(page).getByRole("menuitem", { name: "Outline …" }).click();
    const dialog = page.locator("#protokoll");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText("Outline of the piece");
    const lines = dialog.locator("#protokoll-lines li");
    await expect(lines).toHaveCount(14);
    await expect(lines.nth(0)).toHaveText("Bars 1–8: Kick, Snare (partly), Hi-Hat (partly)");
    await expect(lines.nth(2)).toHaveText("Bars 17–24: all · Drop in bar 17");
    await expect(lines.nth(7)).toHaveText("Bars 57–64: Snare, Hi-Hat, Drum, Bass, Chords (partly) · Break · Build-up");
    await expect(lines.nth(8)).toHaveText("Bars 65–72: all · Drop in bar 65");
    // The window fits on the page, and its list can be copied as text where the browser lets a page do that.
    expect(await dialog.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth; })).toBe(true);
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await dialog.locator("#protokoll-copy").click();
      await expect(dialog.locator("#protokoll-copy")).toHaveText("Copied");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.split("\n")).toHaveLength(14);
      expect(copied).toContain("Bars 65–72: all · Drop in bar 65");
    }
    // Closed and opened again after a change, it is the piece as it is now.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.kreisel.app.piece.resize(16));
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menuOf(page).getByRole("menuitem", { name: "Outline …" }).click();
    await expect(lines).toHaveCount(2);
    await expect(dialog.locator("#protokoll-copy")).toHaveText("Copy as text");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

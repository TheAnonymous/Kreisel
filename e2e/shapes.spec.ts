import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onPhone, open, pieceOf, status } from "./helpers";

/*
 * Seeing the arc and dicing it: the piece's dice have four shapes of their
 * own, the status line counts the bars to the next drop while the piece
 * plays, and the piece can be read written down phrase by phrase.
 */

const menuOf = (page: Page) => page.locator("#context");

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("würfelt das Stück in vier Formen: Plateau, Zwei Drops, Wellen, Lang gezogen", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.newProject(false, "techno"); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const menu = menuOf(page);
    const breaks = async (): Promise<number> => ((await pieceOf(page)).noKick ?? []).filter(Boolean).length;
    const steepest = async (): Promise<number> => { const line = (await pieceOf(page)).tension; return Math.max(...line.map((tension, bar) => Math.abs(tension - (line[(bar + 111) % 112] ?? tension)))); };
    // The right button on the dice opens the piece's menu, where the shapes are.
    await page.locator("#piece-dice").click({ button: "right" });
    await expect(menu).toContainText("Form würfeln");
    for (const name of ["Plateau", "Zwei Drops", "Wellen", "Lang gezogen"]) await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
    // Lang gezogen: one climb, no break, nowhere a step.
    await menu.getByRole("menuitem", { name: /^Lang gezogen/ }).click();
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
    await menu.getByRole("menuitem", { name: /^Zwei Drops/ }).click();
    expect(await breaks()).toBeGreaterThan(8);
    const drops = (await pieceOf(page)).drops ?? [];
    expect(drops).toHaveLength(2);
    expect(drops[1]!.build).toMatchObject({ bars: 8, late: true });
    expect(drops[0]!.build).toMatchObject({ bars: 4, late: false });
    // Wellen: no break, and steps up that are drops.
    await menu.getByRole("menuitem", { name: /^Wellen/ }).click();
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

  test("zählt in der Statuszeile die Takte bis zum nächsten Drop, solange das Stück spielt", async ({ page }) => {
    test.slow();
    const problems = await open(page);
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      app.dismiss();
      app.setGlobal({ bpm: 220 });
    });
    await focusPiece(page);
    await expect(status(page)).not.toContainText("Drop in");
    await page.evaluate(() => window.kreisel.app.piece.playFrom(11));
    // From bar 12 the drop in bar 17 is five bars away, then four, and so on.
    await expect(status(page)).toContainText("Drop in 5 Takten", { timeout: 8000 });
    await expect(status(page)).toContainText("Drop in 3 Takten", { timeout: 8000 });
    await expect(status(page)).toContainText("Drop in 1 Takt", { timeout: 8000 });
    await expect(status(page)).not.toContainText("Drop in 1 Takten");
    // After it has landed the next one is 48 bars off; with a ring in focus the status line says it too.
    await expect(status(page)).toContainText(/Drop in 4[5-8] Takten/, { timeout: 8000 });
    await page.evaluate(() => window.kreisel.app.select(0));
    await expect(status(page)).toContainText(/^Kick: .* · Drop in 4\d Takten$/);
    await page.keyboard.press("Space");
    await expect(status(page)).not.toContainText("Drop in");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("schreibt das Stück als Protokoll auf: wer in welchen acht Takten spielt, und wo Break, Build-up und Drop liegen", async ({ page, browserName }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.newProject(false, "techno"); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const bar = await barAt(page, 30, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menuOf(page).getByRole("menuitem", { name: "Protokoll …" }).click();
    const dialog = page.locator("#protokoll");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText("Protokoll des Stücks");
    const lines = dialog.locator("#protokoll-lines li");
    await expect(lines).toHaveCount(14);
    await expect(lines.nth(0)).toHaveText("Takt 1–8: Kick, Snare (teils), Hi-Hat (teils)");
    await expect(lines.nth(2)).toHaveText("Takt 17–24: alle · Drop in Takt 17");
    await expect(lines.nth(7)).toHaveText("Takt 57–64: Snare, Hi-Hat, Trommel, Bass, Akkorde (teils) · Break · Build-up");
    await expect(lines.nth(8)).toHaveText("Takt 65–72: alle · Drop in Takt 65");
    // The window fits on the page, and its list can be copied as text where the browser lets a page do that.
    expect(await dialog.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth; })).toBe(true);
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await dialog.locator("#protokoll-copy").click();
      await expect(dialog.locator("#protokoll-copy")).toHaveText("Kopiert");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.split("\n")).toHaveLength(14);
      expect(copied).toContain("Takt 65–72: alle · Drop in Takt 65");
    }
    // Closed and opened again after a change, it is the piece as it is now.
    await dialog.getByRole("button", { name: "Schließen" }).click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.kreisel.app.piece.resize(16));
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menuOf(page).getByRole("menuitem", { name: "Protokoll …" }).click();
    await expect(lines).toHaveCount(2);
    await expect(dialog.locator("#protokoll-copy")).toHaveText("Als Text kopieren");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

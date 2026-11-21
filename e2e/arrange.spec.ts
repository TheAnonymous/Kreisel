import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onLaptop, onPhone, open, pieceOf } from "./helpers";

/*
 * Arranging techno: bars of the piece without the kick, the run-ups a piece
 * can take before a landing, and the small changes every eight bars. What the
 * piece then plays is measured on short pieces, rendered faster than they play.
 */

const marked = async (page: Page): Promise<number[]> => (await pieceOf(page)).noKick?.flatMap((out, bar) => (out ? [bar] : [])) ?? [];
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, index) => from + index);

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("macht acht Takte des Stücks zum Break ohne Kick: im Menü, mit der Taste, und der Link nimmt es mit", async ({ page }) => {
    const problems = await open(page);
    // The Werks-Kreisel's piece has no such bars, and is the plain piece it always was.
    expect(Object.keys(await pieceOf(page))).toEqual(["on", "tension", "scenes", "order"]);

    // The techno Kreisel's piece has a break of sixteen bars.
    await page.evaluate(() => window.kreisel.app.newProject(false, "techno"));
    await focusPiece(page);
    expect(await marked(page)).toEqual(range(48, 64));
    await expect(page.locator("#panel")).toContainText("112 Takte");
    await expect(page.locator("#panel")).toContainText("16 Takte Break");

    // The right button on a bar: the kick stays out of the eight bars around it, or plays there again.
    const bar = await barAt(page, 20, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu).toContainText("Takt 17 bis 24");
    await expect(menu).toContainText("Break");
    const plays = menu.getByRole("menuitemradio", { name: "Die Kick spielt in diesen Takten" });
    const rests = menu.getByRole("menuitemradio", { name: "Break: Kick und Nachbeben setzen in diesen Takten aus" });
    await expect(plays).toHaveAttribute("aria-checked", "true");
    await expect(rests).toHaveAttribute("aria-checked", "false");
    await rests.click();
    expect(await marked(page)).toEqual([...range(16, 24), ...range(48, 64)]);
    await expect(page.locator("#toast")).toContainText("Break in Takt 17 bis 24");
    await expect(page.locator("#panel")).toContainText("24 Takte Break");
    await page.keyboard.press("Escape");
    // One step back, and forth again.
    await page.keyboard.press("Control+z");
    expect(await marked(page)).toEqual(range(48, 64));
    await page.keyboard.press("Control+Shift+z");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(48, 64)]);

    // The key K does it at the keyboard's pointer, and undoes it.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("k");
    expect(await marked(page)).toEqual([...range(0, 8), ...range(16, 24), ...range(48, 64)]);
    await page.keyboard.press("k");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(48, 64)]);
    // In the menu the break itself can be given its kick back.
    const inBreak = await barAt(page, 50, 0.5);
    await page.mouse.click(inBreak.x, inBreak.y, { button: "right" });
    await expect(menu).toContainText("Takt 49 bis 56");
    await expect(rests).toHaveAttribute("aria-checked", "true");
    await plays.click();
    await page.keyboard.press("Escape");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(56, 64)]);

    // It is kept over a restart, and a Kreisel read from what was kept has it too.
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melodie");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(56, 64)]);
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    expect(state.z).toHaveLength(4);
    // The techno dice lay the breaks anew; a free line has none.
    await focusPiece(page);
    await page.keyboard.press("n");
    expect(await marked(page)).toEqual(range(48, 64));
    await page.evaluate(() => window.kreisel.app.toggleStyle());
    await page.keyboard.press("n");
    expect(await marked(page)).toEqual([]);
    expect(Object.keys(await pieceOf(page))).toEqual(["on", "tension", "scenes", "order"]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("schaltet Build-up und Fills im Feld des Stücks und in seinem Menü", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.newProject(false, "techno"));
    await focusPiece(page);
    const chips = { roll: page.locator("#piece-roll"), kick: page.locator("#piece-kick"), hat: page.locator("#piece-hat"), vary: page.locator("#piece-vary") };
    await expect(page.locator("#piece-moves")).toContainText("Build-up");
    await expect(page.locator("#piece-moves")).toContainText("Fills");
    await expect(chips.roll).toHaveText("Roll");
    await expect(chips.kick).toHaveText("ohne Kick");
    await expect(chips.hat).toHaveText("ohne Hi-Hat");
    await expect(chips.vary).toHaveText("alle 8 Takte");
    await expect(page.getByRole("button", { name: "Fills alle acht Takte" })).toBeVisible();
    // All of it is off to begin with.
    for (const chip of Object.values(chips)) await expect(chip).toHaveAttribute("aria-pressed", "false");
    expect([(await pieceOf(page)).runUp, (await pieceOf(page)).vary]).toEqual([undefined, undefined]);

    await chips.roll.click();
    await chips.hat.click();
    await chips.vary.click();
    await expect(chips.roll).toHaveAttribute("aria-pressed", "true");
    await expect(chips.kick).toHaveAttribute("aria-pressed", "false");
    await expect(chips.hat).toHaveAttribute("aria-pressed", "true");
    await expect(chips.vary).toHaveAttribute("aria-pressed", "true");
    expect([(await pieceOf(page)).runUp, (await pieceOf(page)).vary]).toEqual([{ roll: true, kick: false, hat: true }, true]);
    // The piece's panel still fits on this screen, and no chip is cut short.
    expect(await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      const moves = document.getElementById("piece-moves")!;
      const cut = [...moves.querySelectorAll<HTMLElement>(".chip")].some((chip) => chip.scrollWidth > chip.clientWidth || chip.getBoundingClientRect().right > moves.getBoundingClientRect().right);
      return panel.scrollHeight - panel.clientHeight <= 2 && !cut;
    })).toBe(true);

    // The same in the piece's menu, where each is a tick.
    const bar = await barAt(page, 20, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu).toContainText("Build-up vor dem Drop");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Snare-Roll" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Letzter Takt ohne Kick" })).toHaveAttribute("aria-checked", "false");
    await menu.getByRole("menuitemcheckbox", { name: "Letzter Takt ohne Kick" }).click();
    await menu.getByRole("menuitemcheckbox", { name: "Fills alle acht Takte" }).click();
    await page.keyboard.press("Escape");
    await expect(chips.kick).toHaveAttribute("aria-pressed", "true");
    await expect(chips.vary).toHaveAttribute("aria-pressed", "false");
    expect([(await pieceOf(page)).runUp, (await pieceOf(page)).vary]).toEqual([{ roll: true, kick: true, hat: true }, undefined]);
    // A link carries it: the marks and one small number.
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    expect(state.z).toHaveLength(5);
    expect(state.z[4]).toBe(7);
    // Switched off again, the piece is what it was.
    await chips.roll.click();
    await chips.kick.click();
    await chips.hat.click();
    expect((await pieceOf(page)).runUp).toBeUndefined();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt den Break ohne Kick, den Snare-Roll und die Fills", async ({ page }) => {
    // A dozen renders of eight bars.
    test.setTimeout(120_000);
    const problems = await open(page);
    const louder = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);
    // A techno piece of eight bars at full height; `solo` is the one ring that is heard, `setup` shapes the piece.
    const hear = (solo: number, setup: string) => page.evaluate(async ([ring, code]) => {
      const app = window.kreisel.app;
      app.newProject(false, "techno");
      app.setGlobal({ pressure: 0 });
      for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== ring, hall: 0, echo: 0 });
      app.store.edit((project) => { project.piece = { on: true, tension: Array.from({ length: 8 }, () => 31), scenes: Array.from({ length: 8 }, () => 0), order: [0, 2, 1, 3, 4, 5, 6] }; });
      new Function("app", code)(app);
      return window.kreisel.whole();
    }, [solo, setup] as const);
    const rise = "app.store.edit((project) => { project.piece.tension = [14, 14, 14, 14, 31, 31, 31, 31]; });";
    // The third and fourth bar without the kick: it leaves after the second and lands on the fifth.
    const pause = "app.store.edit((project) => { project.piece.noKick = [false, false, true, true, false, false, false, false]; });";

    // Two of eight bars without the kick: the kick alone is that much quieter, and has less of the deep lows.
    const kick = await hear(0, "");
    const kickPause = await hear(0, pause);
    expect(louder(kick, kickPause)).toBeGreaterThan(0.6);
    expect(kickPause.peak).toBeGreaterThan(0.1);
    // The run-up without the kick: one bar of the eight is missing.
    const kickRise = await hear(0, rise);
    const kickOut = await hear(0, `${rise} app.piece.toggleRunUp("kick");`);
    expect(louder(kickRise, kickOut)).toBeGreaterThan(0.2);
    // The roll: where the snare's ring has nothing of its own, the roll before the landing is all that is heard of it.
    // (Without it the bars are not silent: the noise of the run-up and the crash of the landing are there either way.)
    const noRoll = await hear(1, `${pause} app.rings.clear(1); app.rings.setTrack(1, { level: 1 });`);
    const roll = await hear(1, `${pause} app.rings.clear(1); app.rings.setTrack(1, { level: 1 }); app.piece.toggleRunUp("roll");`);
    expect(louder(roll, noRoll)).toBeGreaterThan(1);
    // On a ring that plays, the roll takes the place of its own hits in those two bars: more strikes, and louder.
    expect(louder(await hear(1, `${pause} app.piece.toggleRunUp("roll");`), await hear(1, pause))).toBeGreaterThan(0.3);
    // Abwechslung: a kick ring with no hits of its own is silent without it, and has its one kick more with it.
    const still = await hear(0, "app.rings.clear(0);");
    const varied = await hear(0, "app.rings.clear(0); app.piece.toggleVary();");
    expect(still.peak).toBeLessThan(0.005);
    expect(varied.peak).toBeGreaterThan(0.05);
    // Every sixteenth bar the tuned drum has two strokes as well.
    const drum = await hear(3, "app.rings.clear(3); app.piece.resize(16); app.piece.toggleVary();");
    expect(drum.peak).toBeGreaterThan(0.03);
    expect((await hear(3, "app.rings.clear(3); app.piece.resize(16);")).peak).toBeLessThan(0.005);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("hat am Handy Build-up und Fills im Feld des Stücks, und alles passt in die Breite", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.kreisel.app.newProject(false, "techno");
      window.kreisel.app.piece.focus();
    });
    const roll = page.locator("#piece-roll");
    await roll.scrollIntoViewIfNeeded();
    await roll.tap();
    await page.locator("#piece-vary").tap();
    await expect(roll).toHaveAttribute("aria-pressed", "true");
    expect([(await pieceOf(page)).runUp, (await pieceOf(page)).vary]).toEqual([{ roll: true, kick: false, hat: false }, true]);
    await expect(page.locator("#panel")).toContainText("16 Takte Break");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

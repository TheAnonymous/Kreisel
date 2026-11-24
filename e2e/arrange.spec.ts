import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onLaptop, onPhone, open, pieceOf } from "./helpers";

/*
 * Arranging techno: bars of the piece without the kick, the run-ups a piece
 * can take before a landing, and the small changes every eight bars. What the
 * piece then plays is measured on short pieces, rendered faster than they play.
 */

const marked = async (page: Page): Promise<number[]> => (await pieceOf(page)).noKick?.flatMap((out, bar) => (out ? [bar] : [])) ?? [];
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, index) => from + index);

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("makes eight bars of the piece a break without the kick: in the menu, with the key, and the link carries it", async ({ page }) => {
    const problems = await open(page);
    // The Werks-Kreisel's piece has no such bars, and is the plain piece it always was.
    expect(Object.keys(await pieceOf(page))).toEqual(["on", "tension", "scenes", "order"]);

    // The techno Kreisel's piece has a break of sixteen bars.
    await page.evaluate(() => window.plainTechno());
    await focusPiece(page);
    expect(await marked(page)).toEqual(range(48, 64));
    await expect(page.locator("#panel")).toContainText("112 bars");
    await expect(page.locator("#panel")).toContainText("16 bars of break");

    // The right button on a bar: the kick stays out of the eight bars around it, or plays there again.
    const bar = await barAt(page, 20, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu).toContainText("Bars 17 to 24");
    await expect(menu).toContainText("Break");
    const plays = menu.getByRole("menuitemradio", { name: "The kick plays in these bars" });
    const rests = menu.getByRole("menuitemradio", { name: "Break: kick and rumble drop out in these bars" });
    await expect(plays).toHaveAttribute("aria-checked", "true");
    await expect(rests).toHaveAttribute("aria-checked", "false");
    await rests.click();
    expect(await marked(page)).toEqual([...range(16, 24), ...range(48, 64)]);
    await expect(page.locator("#toast")).toContainText("Break in bars 17 to 24");
    await expect(page.locator("#panel")).toContainText("24 bars of break");
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
    await expect(menu).toContainText("Bars 49 to 56");
    await expect(rests).toHaveAttribute("aria-checked", "true");
    await plays.click();
    await page.keyboard.press("Escape");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(56, 64)]);

    // It is kept over a restart, and a Kreisel read from what was kept has it too.
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melody");
    expect(await marked(page)).toEqual([...range(16, 24), ...range(56, 64)]);
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    // The marks, and after them the build-up that the drop out of the break has of its own.
    expect(state.z).toHaveLength(7);
    expect(state.z[3]).toMatch(/^[\w-]+$/);
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

  test("sets the build-up of all drops in the piece's panel, and switches the fills there and in the menu", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await focusPiece(page);
    const kit = page.locator("#piece-build");
    const vary = page.locator("#piece-vary");
    const menu = page.locator("#context");
    await expect(page.locator("#piece-moves")).toContainText("Build-up");
    await expect(page.locator("#piece-moves")).toContainText("Fills");
    await expect(kit).toHaveText("all drops: small ▾");
    await expect(vary).toHaveText("every 8 bars");
    await expect(page.getByRole("button", { name: "Fills every eight bars" })).toBeVisible();
    // A fresh piece has the small build-up before every drop, and no fills.
    await expect(vary).toHaveAttribute("aria-pressed", "false");
    expect([(await pieceOf(page)).build, (await pieceOf(page)).vary]).toEqual([undefined, undefined]);

    // The button opens the kit for all drops under itself; a second press puts it away.
    await kit.click();
    await expect(menu).toContainText("All drops · Build-up");
    await expect(kit).toHaveAttribute("aria-expanded", "true");
    // All of the kit is there at once, on the page and beside its button: nothing of it has to be scrolled to.
    expect(await page.evaluate(() => {
      const node = document.getElementById("context")!;
      const box = node.getBoundingClientRect();
      const opener = document.getElementById("piece-build")!.getBoundingClientRect();
      const apart = box.right <= opener.left || box.top >= opener.bottom;
      return node.scrollHeight <= node.clientHeight + 1 && box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth && apart;
    })).toBe(true);
    await menu.getByRole("menuitemcheckbox", { name: /^Snare roll/ }).click();
    await menu.getByRole("menuitemcheckbox", { name: "Last bar without hi-hat" }).click();
    await expect(menu.getByRole("menuitemcheckbox", { name: /^Snare roll/ })).toHaveAttribute("aria-checked", "true");
    await expect(kit).toHaveText("all drops: own ▾");
    await kit.click();
    await expect(menu).toBeHidden();
    await vary.click();
    await expect(vary).toHaveAttribute("aria-pressed", "true");
    expect((await pieceOf(page)).build).toEqual({ bars: 1, riser: 1, roll: true, lows: false, wash: false, dip: false, kick: false, hat: true, gap: 0, late: false });
    expect((await pieceOf(page)).vary).toBe(true);
    // The piece's panel still fits on this screen, and no chip is cut short.
    expect(await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      const moves = document.getElementById("piece-moves")!;
      const cut = [...moves.querySelectorAll<HTMLElement>(".chip")].some((chip) => chip.scrollWidth > chip.clientWidth || chip.getBoundingClientRect().right > moves.getBoundingClientRect().right);
      return panel.scrollHeight - panel.clientHeight <= 2 && !cut;
    })).toBe(true);

    // The piece's menu has the fills as a tick, and leads to the same kit.
    const bar = await barAt(page, 20, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await expect(menu).toContainText("Build-up of all drops: own");
    await menu.getByRole("menuitemcheckbox", { name: "Fills every eight bars" }).click();
    await menu.getByRole("menuitem", { name: /^Build-up of all drops/ }).click();
    await expect(menu).toContainText("All drops · Build-up");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Last bar without kick" })).toHaveAttribute("aria-checked", "false");
    await menu.getByRole("menuitemcheckbox", { name: "Last bar without kick" }).click();
    await page.keyboard.press("Escape");
    await expect(vary).toHaveAttribute("aria-pressed", "false");
    expect((await pieceOf(page)).build).toMatchObject({ bars: 1, roll: true, kick: true, hat: true });
    expect((await pieceOf(page)).vary).toBeUndefined();
    // A link carries it: after the marks, what the piece does by itself and the place of the roster come the build-ups.
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    expect(state.z).toHaveLength(7);
    expect(state.z.slice(4, 6)).toEqual([0, []]);
    // Back at the small size, the piece has no build-up of its own for all drops.
    await kit.click();
    await menu.getByRole("menuitemradio", { name: /^Small/ }).click();
    await page.keyboard.press("Escape");
    await expect(kit).toHaveText("all drops: small ▾");
    expect((await pieceOf(page)).build).toBeUndefined();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("plays the break without the kick, the snare roll and the fills", async ({ page }) => {
    // A dozen renders of eight bars.
    test.setTimeout(120_000);
    const problems = await open(page);
    const louder = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);
    // A techno piece of eight bars at full height; `solo` is the one ring that is heard, `setup` shapes the piece.
    const hear = (solo: number, setup: string) => page.evaluate(async ([ring, code]) => {
      const app = window.kreisel.app;
      window.plainTechno();
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
    const kickOut = await hear(0, `${rise} app.piece.setBuild(null, { kick: true });`);
    expect(louder(kickRise, kickOut)).toBeGreaterThan(0.2);
    // The roll: where the snare's ring has nothing of its own, the roll before the landing is all that is heard of it.
    // (Without it the bars are not silent: the noise of the run-up and the crash of the landing are there either way.)
    const noRoll = await hear(1, `${pause} app.rings.clear(1); app.rings.setTrack(1, { level: 1 });`);
    const roll = await hear(1, `${pause} app.rings.clear(1); app.rings.setTrack(1, { level: 1 }); app.piece.setBuild(null, { bars: 2, roll: true });`);
    expect(louder(roll, noRoll)).toBeGreaterThan(1);
    // On a ring that plays, the roll takes the place of its own hits in those two bars: more strikes, and louder.
    expect(louder(await hear(1, `${pause} app.piece.setBuild(null, { bars: 2, roll: true });`), await hear(1, pause))).toBeGreaterThan(0.3);
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

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("has build-up and fills in the piece's panel on a phone, and everything fits the width", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.plainTechno();
      window.kreisel.app.piece.focus();
    });
    const kit = page.locator("#piece-build");
    await kit.scrollIntoViewIfNeeded();
    await kit.tap();
    const menu = page.locator("#context");
    await expect(menu).toContainText("All drops · Build-up");
    await menu.getByRole("menuitemcheckbox", { name: /^Snare roll/ }).tap();
    await expect(menu.getByRole("menuitemcheckbox", { name: /^Snare roll/ })).toHaveAttribute("aria-checked", "true");
    // The whole kit is within reach of a finger: the menu fits on the page.
    expect(await menu.evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight; })).toBe(true);
    await page.keyboard.press("Escape");
    await page.locator("#piece-vary").tap();
    await expect(page.locator("#piece-vary")).toHaveAttribute("aria-pressed", "true");
    expect([(await pieceOf(page)).build?.roll, (await pieceOf(page)).vary]).toEqual([true, true]);
    await expect(page.locator("#panel")).toContainText("16 bars of break");
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

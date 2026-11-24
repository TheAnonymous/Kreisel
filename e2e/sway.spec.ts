import { expect, test, type Page } from "@playwright/test";
import { barAt, focusPiece, onPhone, open, pieceOf } from "./helpers";

/*
 * What the tension moves beyond who plays ("Was die Spannung bewegt"): the
 * hi-hat's length, the brightness of bass, chords and melody, the kick, the
 * quiet hits, Zerre and hall. The piece's panel has a button that opens the
 * list; what each then does to the sound is measured on a short piece that is
 * low for four bars and at the top for four, with one ring heard by itself.
 */

const menuOf = (page: Page) => page.locator("#context");
const over = (now: number, before: number): number => 20 * Math.log10(Math.max(now, 1e-9) / Math.max(before, 1e-9));

interface Half { loud: number; sharp: number; peak: number; floor: number }

/**
 * A techno piece of eight bars, four at `low` and four at the top, without a build-up before the step between them,
 * with only ring `solo` heard, dry and well under where the master begins to even things out. `sway` is what the
 * tension moves; `setup` shapes the Kreisel further. Measured in sixteenths: bars 2 to 4 are "low", bars 6 to 8 are
 * "top". `floor` is the quietest sixteenth, where nothing was struck.
 */
const hear = async (page: Page, solo: number, low: number, sway: Record<string, number>, setup = ""): Promise<{ low: Half; top: Half }> => {
  const parts = await page.evaluate(async ([ring, tension, moves, code]) => {
    const app = window.kreisel.app;
    app.newProject(false, "techno");
    app.setGlobal({ pressure: 0 });
    for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== ring, hall: 0, echo: 0, ...(track === ring ? { level: 0.3 } : {}) });
    new Function("app", code)(app);
    app.store.edit((project) => {
      const line = Array.from({ length: 8 }, (_, bar) => (bar < 4 ? tension : 31));
      project.piece = {
        on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6],
        build: { bars: 0, riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false },
        sway: { hat: 0, bright: 0, kick: 0, dense: 0, drive: 0, room: 0, ...moves },
      };
    });
    return window.kreisel.beats(4);
  }, [solo, low, sway, setup] as const);
  const half = (from: number, to: number): Half => {
    const part = parts.slice(from * 16, to * 16);
    const energy = part.reduce((sum, beat) => sum + beat.loud ** 2, 0);
    return {
      loud: Math.sqrt(energy / part.length),
      // Each sixteenth's sharpness counts by how loud it is.
      sharp: energy > 0 ? part.reduce((sum, beat) => sum + beat.sharp * beat.loud ** 2, 0) / energy : 0,
      peak: Math.max(...part.map((beat) => beat.loud)),
      floor: Math.min(...part.map((beat) => beat.loud)),
    };
  };
  return { low: half(1, 4), top: half(5, 8) };
};

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("stellt im Feld des Stücks ein, was die Spannung bewegt, und der Link nimmt es mit", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.newProject(false, "techno"); window.kreisel.app.dismiss(); });
    await focusPiece(page);
    const button = page.locator("#piece-sway");
    const menu = menuOf(page);
    await expect(button).toHaveText("nur die Einsätze ▾");
    expect((await pieceOf(page)).sway).toBeUndefined();
    // The piece's panel still fits on this screen with the new line.
    expect(await page.evaluate(() => { const panel = document.getElementById("panel")!; return panel.scrollHeight - panel.clientHeight <= 2; })).toBe(true);

    await button.click();
    await expect(menu).toContainText("Was die Spannung bewegt");
    for (const name of ["Hi-Hat öffnet sich", "Helligkeit", "Kick wächst", "Dichte", "Zerre", "Raum"]) await expect(menu).toContainText(name);
    // All of the list is there at once, on the page.
    expect(await menu.evaluate((node) => { const box = node.getBoundingClientRect(); return node.scrollHeight <= node.clientHeight + 1 && box.top >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth; })).toBe(true);
    const pick = (name: RegExp) => menu.getByRole("menuitemradio", { name });
    await expect(pick(/^Hi-Hat öffnet sich: aus/)).toHaveAttribute("aria-checked", "true");
    await pick(/^Hi-Hat öffnet sich, deutlich/).click();
    await expect(pick(/^Hi-Hat öffnet sich, deutlich/)).toHaveAttribute("aria-checked", "true");
    await expect(button).toHaveText("1 Sache mehr ▾");
    await pick(/^Raum, sanft/).click();
    await pick(/^Helligkeit, sanft/).click();
    await expect(button).toHaveText("3 Sachen mehr ▾");
    expect((await pieceOf(page)).sway).toEqual({ hat: 2, bright: 1, kick: 0, dense: 0, drive: 0, room: 1 });
    await pick(/^Helligkeit: aus/).click();
    await button.click();
    await expect(menu).toBeHidden();
    expect((await pieceOf(page)).sway).toEqual({ hat: 2, bright: 0, kick: 0, dense: 0, drive: 0, room: 1 });

    // The piece's menu leads to the same list.
    const bar = await barAt(page, 30, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await menu.getByRole("menuitem", { name: /^Die Spannung bewegt: 2 Sachen mehr/ }).click();
    await expect(menu).toContainText("Was die Spannung bewegt");
    await expect(pick(/^Raum, sanft/)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // A link carries it as the eighth part of the piece, and it is there again after a reload.
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { z: unknown[] };
    expect(state.z).toHaveLength(8);
    expect(state.z[7]).toEqual({ s: 2 | (1 << 10) });
    const kept = await pieceOf(page);
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melodie");
    expect(await pieceOf(page)).toEqual(kept);
    // One step back takes the last change away.
    await page.evaluate(() => { window.kreisel.app.piece.setSway("room", 0); window.kreisel.app.undo(); });
    expect((await pieceOf(page)).sway).toEqual({ hat: 2, bright: 0, kick: 0, dense: 0, drive: 0, room: 1 });
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt die Spannung Hi-Hat, Helligkeit und Kick bewegen", async ({ page }) => {
    // Six renders of eight bars.
    test.setTimeout(180_000);
    const problems = await open(page);
    // The hi-hat rings longer at the top than it does without, and more so than further down.
    const hat = await hear(page, 2, 10, {});
    const hatOpen = await hear(page, 2, 10, { hat: 2 });
    expect(over(hatOpen.top.loud, hat.top.loud)).toBeGreaterThan(1);
    expect(over(hatOpen.top.loud, hat.top.loud)).toBeGreaterThan(over(hatOpen.low.loud, hat.low.loud) + 0.5);

    // The bass (an acid machine) is brighter at the top than it is without.
    const bass = await hear(page, 4, 18, {});
    const bassBright = await hear(page, 4, 18, { bright: 2 });
    expect(bassBright.top.sharp / bass.top.sharp).toBeGreaterThan(1.4);
    expect(bassBright.top.sharp / bass.top.sharp).toBeGreaterThan(bassBright.low.sharp / bass.low.sharp + 0.1);

    // The kick is smaller where little is going on, and whole at the top.
    const kick = await hear(page, 0, 4, {});
    const kickGrows = await hear(page, 0, 4, { kick: 2 });
    expect(over(kickGrows.low.loud, kick.low.loud)).toBeLessThan(-2);
    expect(Math.abs(over(kickGrows.top.loud, kick.top.loud))).toBeLessThan(0.3);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt die Spannung Dichte, Zerre und Raum bewegen", async ({ page }) => {
    // Six renders of eight bars.
    test.setTimeout(180_000);
    const problems = await open(page);
    // A kick ring with nothing but quiet hits: they play everywhere without it, and only at the top with it.
    const quiet = "app.rings.clear(0); for (const step of [0, 4, 8, 12]) { app.rings.addNote(0, step, {}, 'leise'); app.rings.setStep(0, step, { vel: 0 }); }";
    const all = await hear(page, 0, 10, {}, quiet);
    const thin = await hear(page, 0, 10, { dense: 1 }, quiet);
    expect(all.low.peak).toBeGreaterThan(0.02);
    expect(thin.low.peak).toBeLessThan(0.002);
    expect(thin.top.peak).toBeGreaterThan(0.02);

    // Zerre: at the top the bass has more overtones than without, further down fewer of them.
    const clean = await hear(page, 4, 18, {});
    const driven = await hear(page, 4, 18, { drive: 2 });
    expect(driven.top.sharp / clean.top.sharp).toBeGreaterThan(1.05);
    // A little above the middle of the line there is only a little of it.
    expect(driven.low.sharp / clean.low.sharp).toBeLessThan(driven.top.sharp / clean.top.sharp - 0.02);

    // Raum: where little is going on the snare stands in more hall, at the top it is as dry as it was.
    const dry = await hear(page, 1, 13, {});
    const roomy = await hear(page, 1, 13, { room: 2 });
    // Between its hits the dry snare is all but silent; in the hall something rings there.
    expect(over(roomy.low.floor, dry.low.floor)).toBeGreaterThan(10);
    expect(Math.abs(over(roomy.top.loud, dry.top.loud))).toBeLessThan(0.5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

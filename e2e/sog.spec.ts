import { expect, test, type Page } from "@playwright/test";
import { onPhone, open, status } from "./helpers";

/*
 * The pull of a loop ("Pull"): tides let a weather swell and ebb over a number
 * of bars, the status line says when rings of unequal length are together
 * again and how far a ring lies behind the kick, and "Ausrichten" lets all
 * rings begin together again every eight bars.
 */

const menuOf = (page: Page) => page.locator("#context");
const sceneOf = (page: Page) => page.evaluate(() => window.kreisel.app.project.scenes[window.kreisel.app.project.scene]!);

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("gives every weather tides, and the link carries them", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.store.edit((project) => { for (let step = 0; step < 16; step += 1) project.scenes[project.scene]!.weather[0]![2]![step] = 15; });
      app.weather.focus();
    });
    const fog = page.getByLabel("Tides for Fog, in bars");
    const rain = page.getByLabel("Tides for Rain, in bars");
    await expect(fog).toBeVisible();
    await expect(fog).toHaveValue("0");
    expect((await sceneOf(page)).tide).toBeUndefined();
    await fog.selectOption("12");
    await rain.selectOption("64");
    expect((await sceneOf(page)).tide).toEqual([12, 0, 0, 64, 0, 0]);
    await expect(fog).toHaveValue("12");
    // The weather's panel still fits on this screen, and no line of it is wider than the panel.
    expect(await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      const lines = [...panel.querySelectorAll<HTMLElement>(".line.sky")];
      return panel.scrollHeight - panel.clientHeight <= 2 && lines.length === 6 && lines.every((line) => line.scrollWidth <= line.clientWidth + 1 && line.getBoundingClientRect().right <= panel.getBoundingClientRect().right);
    })).toBe(true);
    // One step back, and again; "–" takes a tide away.
    await page.keyboard.press("Control+z");
    expect((await sceneOf(page)).tide).toEqual([12, 0, 0, 0, 0, 0]);
    await expect(rain).toHaveValue("0");
    await page.keyboard.press("Control+y");
    await rain.selectOption("0");
    expect((await sceneOf(page)).tide).toEqual([12, 0, 0, 0, 0, 0]);
    // The link has the tides beside the winds, and they are there again after a reload.
    const state = JSON.parse(await page.evaluate(() => window.kreisel.state())) as { c: ({ e?: number[] } | 0)[] };
    expect((state.c[0] as { e?: number[] }).e).toEqual([12, 0, 0, 0, 0, 0]);
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    await expect(status(page)).toContainText("hits");
    expect((await sceneOf(page)).tide).toEqual([12, 0, 0, 0, 0, 0]);
    // Clearing a kind of weather takes its tide with it.
    await page.evaluate(() => window.kreisel.app.weather.clear(0));
    expect((await sceneOf(page)).tide).toBeUndefined();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lets a weather swell and ebb with the tides", async ({ page }) => {
    // Two renders of four bars.
    test.setTimeout(120_000);
    const problems = await open(page);
    // Fog over every step of the hi-hat, on a piece of four bars at the top; the hi-hat by itself.
    const hear = (tide: number) => page.evaluate(async (bars) => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.setGlobal({ pressure: 0 });
      for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== 2, hall: 0, echo: 0, ...(track === 2 ? { level: 0.3 } : {}) });
      app.store.edit((project) => {
        const scene = project.scenes[project.scene]!;
        for (let step = 0; step < scene.patterns[2]!.len; step += 1) scene.weather[0]![2]![step] = 15;
        if (bars > 0) scene.tide = [bars, 0, 0, 0, 0, 0];
        const line = [31, 31, 31, 31];
        project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6], build: { bars: 0, riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false } };
      });
      return window.kreisel.beats();
    }, tide);
    const sharp = (beats: { loud: number; sharp: number }[], from: number, to: number): number => {
      const part = beats.slice(from, to);
      return part.reduce((sum, beat) => sum + beat.sharp * beat.loud ** 2, 0) / Math.max(1e-12, part.reduce((sum, beat) => sum + beat.loud ** 2, 0));
    };
    // Under a tide of four bars the fog is gone as the scene begins and thickest after two bars; without one it is thick throughout.
    const tided = await hear(4);
    const steady = await hear(0);
    expect(sharp(tided, 0, 2) / sharp(tided, 7, 9)).toBeGreaterThan(1.3);
    expect(sharp(tided, 14, 16) / sharp(tided, 7, 9)).toBeGreaterThan(1.3);
    expect(Math.abs(sharp(steady, 0, 2) / sharp(steady, 7, 9) - 1)).toBeLessThan(0.15);
    // At its thickest it is the fog without a tide.
    expect(Math.abs(sharp(tided, 7, 9) / sharp(steady, 7, 9) - 1)).toBeLessThan(0.15);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("says when rings of unequal length meet again and how far a ring lies behind the kick, and realigns every eight bars", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    // The Werks-Kreisel has a ring of twelve steps among its sixteens: together again every three bars. The kick's line says so.
    await page.evaluate(() => window.kreisel.app.select(0));
    await expect(status(page)).toContainText("all rings meet every 3 bars");
    // A hi-hat on the off-beats lies two steps behind a kick on every beat; a ring of five steps meets the others only after fifteen bars.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.rings.clear(2);
      for (const step of [2, 6, 10, 14]) app.rings.addNote(2, step, {}, "versatz");
      app.select(2);
    });
    await expect(status(page)).toContainText("2 steps behind the kick");
    await expect(status(page)).not.toContainText("meets the kick");
    // The ring that runs askew says when it meets the kick again; the kick says when all of them do.
    await page.evaluate(() => { window.kreisel.app.rings.resize(2, 5); });
    await expect(status(page)).toContainText("meets the kick again every 5 bars");
    await page.evaluate(() => window.kreisel.app.select(0));
    await expect(status(page)).toContainText("all rings meet every 15 bars");
    await page.evaluate(() => { window.kreisel.app.rings.resize(2, 16); });

    // "Ausrichten" is a switch in the Kreisel's own menu (the right button on the hub).
    const hub = await page.evaluate(() => { const box = document.getElementById("kreisel")!.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
    await page.mouse.click(hub.x, hub.y, { button: "right" });
    const menu = menuOf(page);
    const row = menu.getByRole("menuitemcheckbox", { name: /^Realign every eight bars/ });
    await expect(row).toHaveAttribute("aria-checked", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.kreisel.app.project.align)).toBe(true);
    await expect(status(page)).toContainText("all rings meet every 3 bars, realigned every 8");
    expect((JSON.parse(await page.evaluate(() => window.kreisel.state())) as { a?: number }).a).toBe(1);

    // What it does: a ring of twelve steps with one hit at its beginning, by itself, on a piece of nine bars. Free, it
    // strikes every twelve steps and so on step 5 of the ninth bar; aligned, it begins again with the ninth bar.
    const hear = (align: boolean) => page.evaluate(async (on) => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.setGlobal({ pressure: 0 });
      for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== 2, hall: 0, echo: 0, ...(track === 2 ? { level: 0.3 } : {}) });
      app.rings.clear(2);
      app.rings.resize(2, 12);
      app.rings.addNote(2, 0, {}, "eins");
      app.store.edit((project) => {
        if (on) project.align = true;
        const line = Array.from({ length: 9 }, () => 31);
        project.piece = { on: true, tension: line, scenes: line.map(() => 0), order: [0, 2, 1, 3, 4, 5, 6], build: { bars: 0, riser: 0, roll: false, lows: false, wash: false, dip: false, kick: false, hat: false, gap: 0, late: false } };
      });
      return (await window.kreisel.beats(4)).map((part) => part.loud);
    }, align);
    const free = await hear(false);
    const aligned = await hear(true);
    const struck = (steps: number[], at: number): boolean => (steps[at] ?? 0) > 5 * Math.max(steps[at + 2] ?? 0, 1e-5);
    expect([struck(free, 120), struck(free, 128), struck(free, 132)]).toEqual([true, false, true]);
    expect([struck(aligned, 120), struck(aligned, 128), struck(aligned, 132)]).toEqual([true, true, false]);
    // Within the eight bars both are the same.
    expect([0, 12, 24, 108].map((at) => struck(aligned, at))).toEqual([true, true, true, true]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

import { expect, test } from "@playwright/test";
import { barAt, focus, focusPiece, onLaptop, onPhone, open, paint, pickSound, pieceOf, state, status, where } from "./helpers";

/*
 * The wheel itself: hits by pointer, by finger and by key, notes, chords and
 * scenes, and that it sounds.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("zeigt den Werks-Kreisel, malt, radiert und nimmt zurück", async ({ page }) => {
    const problems = await open(page);
    await expect(status(page)).toHaveText("Melodie: 7 Schläge auf 1, 4, 7, 9, 11, 13, 15 von 16");

    // A click on another ring picks it and paints at once.
    let spot = await where(page, 0, 2);
    await page.mouse.click(spot.x, spot.y);
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 1, 3, 5, 9, 13 von 16");
    await focus(page, 0);
    spot = await where(page, 0, 2);
    await page.mouse.click(spot.x, spot.y);
    await expect(status(page)).toHaveText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");

    // A stroke along the ring paints every step it crosses, as one step back.
    const from = await where(page, 0, 5);
    const over = await where(page, 0, 6);
    const to = await where(page, 0, 7);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    await expect(status(page)).toHaveText("Kick: 7 Schläge auf 1, 5, 6, 7, 8, 9, 13 von 16");
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");
    await page.keyboard.press("Control+Shift+z");
    await expect(status(page)).toContainText("7 Schläge");

    // Pulled along the ring, the right button erases, whatever the tool, and opens no menu.
    await page.keyboard.press("w");
    await page.mouse.move(to.x, to.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(over.x, over.y, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 1, 5, 6, 9, 13 von 16");
    await expect(page.locator("#context")).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect(status(page)).toContainText("7 Schläge");
    await page.keyboard.press("Control+Shift+z");

    // The wheel turns the ring.
    await page.mouse.move(to.x, to.y);
    await page.mouse.wheel(0, 50);
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 2, 6, 7, 10, 14 von 16");
    expect(problems).toEqual([]);
  });

  test("zieht Töne nach außen höher und hält sie länger", async ({ page }) => {
    await open(page);
    await focus(page, 6);
    const pitchOf = (step: number): Promise<number> => page.evaluate((at) => window.kreisel.app.project.scenes[0]!.patterns[6]!.steps[at]!.pitch, step);
    const lengthOf = (step: number): Promise<number> => page.evaluate((at) => window.kreisel.app.project.scenes[0]!.patterns[6]!.steps[at]!.len, step);
    const box = (await page.locator("#kreisel").boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const spot = await where(page, 6, 5);
    const away = Math.hypot(spot.x - centre.x, spot.y - centre.y);
    const out = { x: spot.x + ((spot.x - centre.x) / away) * 21, y: spot.y + ((spot.y - centre.y) / away) * 21 };
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(out.x, out.y, { steps: 6 });
    await page.mouse.up();
    await expect(status(page)).toContainText("8 Schläge");
    expect(await pitchOf(5)).toBe(7);

    await page.keyboard.press("t");
    const start = await where(page, 6, 5);
    const end = await where(page, 6, 7);
    const middle = await where(page, 6, 6);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    expect(await lengthOf(5)).toBe(3);
  });

  test("spielt unter der Produktions-CSP, auch am Lautlos-Schalter vorbei", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "audioSession", { value: { type: "auto" }, configurable: true });
    });
    const problems = await open(page);
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    const first = await page.evaluate(() => window.kreisel.app.playhead());
    await expect.poll(() => page.evaluate(() => window.kreisel.app.playhead() ?? 0)).toBeGreaterThan((first ?? 0) + 2);
    expect(await page.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type)).toBe("playback");

    // Held effects, the pause and the stutter must not throw or silence the Kreisel for good.
    // The bottom row by position: these are Y X C V B on a German keyboard.
    for (const key of ["z", "x", "c", "v", "b"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(250);
      await page.keyboard.up(key);
    }
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    let loudest = 0;
    for (let look = 0; look < 30; look += 1) {
      loudest = Math.max(loudest, await page.evaluate(() => window.kreisel.level()));
      await page.waitForTimeout(40);
    }
    expect(loudest).toBeLessThanOrEqual(0.99);

    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt mit der Tastatur: Zeiger, Eingabe, Werkzeuge, Einspielen", async ({ page }) => {
    await open(page);
    await page.keyboard.press("1");
    await expect(status(page)).toContainText("Kick: 4 Schläge");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 1, 3, 5, 9, 13 von 16");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 2, 4, 6, 10, 14 von 16");
    await page.keyboard.press("Shift+Delete");
    await expect(status(page)).toHaveText("Kick: leer, 16 Schritte");

    // Live: what is played on the home row lands in the turning ring.
    await page.keyboard.press("l");
    await expect(page.locator("#live")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.playhead() ?? 0)).toBeGreaterThan(1);
    await page.keyboard.press("a");
    await page.waitForTimeout(300);
    await page.keyboard.press("d");
    await expect(status(page)).toContainText("Kick: 2 Schläge");
    await page.keyboard.press("Space");

    await page.keyboard.press("7");
    await page.keyboard.press("n");
    const diced = await state(page);
    await page.keyboard.press("Shift+n");
    expect(await state(page)).not.toBe(diced);
    await page.keyboard.press("?");
    await expect(page.locator("#help")).toBeVisible();
  });

  test("wählt Akkorde, Klänge und Tonart", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.chords.open(1));
    const menu = page.locator("#chord-menu");
    await expect(menu).toContainText("Takt 2 von 4");
    await expect(menu.locator(".chord[aria-pressed=true]")).toContainText("F");
    await menu.locator(".chord", { hasText: "Dm" }).click();
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.chords)).toEqual([0, 3, 2, 6]);
    await menu.getByTitle("Einen Takt mehr").click();
    await expect(menu).toContainText("Takt 2 von 5");
    await page.mouse.click(5, 300);
    await expect(menu).toBeHidden();

    await page.keyboard.press("5");
    await pickSound(page, "Acid");
    await expect(page.locator(".track.selected .sound")).toHaveText("Acid");
    await page.locator("#scale").selectOption("dur");
    await page.locator("#root").selectOption("0");
    await page.evaluate(() => window.kreisel.app.chords.open(0));
    await expect(menu.locator(".chord").first()).toContainText("C");
    expect(problems).toEqual([]);
  });

  test("baut aus Szenen eine Folge", async ({ page }) => {
    await open(page);
    await page.locator(".scene", { hasText: "B" }).click();
    await expect(page.locator("#toast")).toContainText("Kopie von A");
    await expect(page.locator(".scene.current")).toHaveText("B");
    await page.keyboard.press("1");
    await page.keyboard.press("Shift+Delete");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[0]!.steps[0]!.on)).toBe(true);

    // While it plays, a scene comes up at the next bar line.
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.playhead() ?? 0)).toBeGreaterThan(1);
    await page.locator(".scene", { hasText: "A" }).click();
    await expect(page.locator(".scene.current")).toHaveText("A", { timeout: 6000 });

    // The chain walks through the filled scenes by itself.
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 200 }));
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.store.edit((project) => {
        for (const scene of project.scenes) if (scene) scene.chords = [0];
      });
    });
    await page.locator("#chain").check();
    await expect(page.locator(".scene.current")).toHaveText("B", { timeout: 6000 });
    await expect(page.locator(".scene.current")).toHaveText("A", { timeout: 6000 });
    await page.keyboard.press("Space");
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("passt in die Breite; der Finger wählt erst den Ring und malt dann", async ({ page }) => {
    const problems = await open(page);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    let spot = await where(page, 0, 2);
    await page.touchscreen.tap(spot.x, spot.y);
    await expect(status(page)).toHaveText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");
    await focus(page, 0);
    spot = await where(page, 0, 2);
    await page.touchscreen.tap(spot.x, spot.y);
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 1, 3, 5, 9, 13 von 16");

    const box = (await page.locator("#kreisel").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.locator(".pad-fx", { hasText: "Dumpf" }).dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true });
    await expect(page.locator(".pad-fx", { hasText: "Dumpf" })).toHaveClass(/held/);
    await page.locator(".pad-fx", { hasText: "Dumpf" }).dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true });
    await expect(page.locator(".pad-fx", { hasText: "Dumpf" })).not.toHaveClass(/held/);
    await page.locator("#play").tap();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");

    // A phone's bar has no speaker and no help of its own: the three dots hold all of that, Reihum too.
    await expect(page.locator("#sound")).toBeHidden();
    await expect(page.locator("#help-open")).toBeHidden();
    await page.locator("#more").tap();
    await page.locator("#context").getByText("Reihum").tap();
    await expect(page.locator("#reihum")).toBeVisible();
    await page.locator("#reihum").getByRole("button", { name: "Schließen", exact: true }).tap();
    await expect(page.locator("#reihum")).toBeHidden();

    // A finger first picks the piece's ring and paints with the next touch.
    const rim = await barAt(page, 6, 0.5);
    const untouched = (await pieceOf(page)).tension;
    await page.touchscreen.tap(rim.x, rim.y);
    await expect(status(page)).toContainText("Stück: 32 Takte");
    expect((await pieceOf(page)).tension).toEqual(untouched);
    await focusPiece(page);
    const wide = await barAt(page, 6, 1);
    await page.touchscreen.tap(wide.x, wide.y);
    expect((await pieceOf(page)).tension[6]).toBeGreaterThan(27);
    await page.evaluate(() => window.kreisel.app.select(0));

    // The paint box fits the phone, too.
    await page.locator("#paint").tap();
    await expect(page.locator("#easel")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    const paper = (await page.locator("#bild").boundingBox())!;
    expect(paper.height).toBeGreaterThan(150);
    await page.locator("#bild-clear").tap();
    await page.locator("#bild").scrollIntoViewIfNeeded();
    await paint(page, [[0.1, 0.5], [0.6, 0.3]]);
    await expect(status(page)).toHaveText("Klangmalerei Kick: 1 Strich (1× Summen)");
    await page.locator("#easel-done").tap();
    await expect(page.locator("#easel")).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

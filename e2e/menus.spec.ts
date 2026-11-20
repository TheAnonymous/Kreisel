import { expect, test } from "@playwright/test";
import { barAt, focus, focusPiece, onLaptop, onPhone, open, pieceOf, soundOf, state, status, where } from "./helpers";

/*
 * What the right button, and a long press of a finger, offer at each place.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("zeigt mit der rechten Taste, was an der Stelle geht", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    const bass = (step: number) => page.evaluate((at) => window.kreisel.app.project.scenes[0]!.patterns[4]!.steps[at]!, step);
    await focus(page, 4);

    // A right click on a hit leaves it where it is and shows what can be done with it.
    let spot = await where(page, 4, 3);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Bass · Schritt 4");
    await expect(status(page)).toHaveText("Bass: 6 Schläge auf 1, 4, 7, 9, 12, 15 von 16");
    await menu.getByRole("menuitemradio", { name: "laut" }).click();
    await menu.getByRole("menuitemradio", { name: /50 % der Runden/ }).click();
    await menu.getByRole("menuitemradio", { name: "3 schnelle Schläge" }).click();
    await menu.getByRole("menuitem", { name: "Den Ton länger halten" }).click();
    await menu.getByRole("menuitem", { name: "Höher" }).click();
    expect(await bass(3)).toEqual({ on: true, vel: 2, chance: 2, ratchet: 3, pitch: 1, len: 2 });
    // The menu stays open and says what is there now.
    await expect(menu.getByRole("menuitemradio", { name: "laut" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByText("Länge 2")).toBeVisible();
    // Used with the mouse, it leaves the keyboard with the Kreisel: the space bar starts and stops.
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await expect(menu).toBeVisible();
    expect(await bass(3)).toEqual({ on: true, vel: 2, chance: 2, ratchet: 3, pitch: 1, len: 2 });
    await menu.getByRole("menuitem", { name: "Schlag löschen" }).click();
    await expect(menu).toBeHidden();
    await expect(status(page)).toHaveText("Bass: 5 Schläge auf 1, 7, 9, 12, 15 von 16");

    // On an empty step it offers to set a hit, and then shows the hit's rows.
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.getByText("Betonung")).toBeHidden();
    await menu.getByRole("menuitem", { name: "Schlag setzen" }).click();
    await expect(menu.getByText("Betonung")).toBeVisible();
    await expect(status(page)).toHaveText("Bass: 6 Schläge auf 1, 4, 7, 9, 12, 15 von 16");

    // The whole ring: its length, its sound, who is heard.
    await menu.getByRole("menuitemradio", { name: "12 Schritte" }).click();
    await expect(status(page)).toContainText("von 12");
    await menu.getByRole("menuitemradio", { name: "Acid" }).click();
    expect(await soundOf(page, 4)).toBe(2);
    await menu.getByRole("menuitemradio", { name: /stumm schalten/ }).click();
    expect(await page.evaluate(() => window.kreisel.app.project.tracks[4]!.mute)).toBe(true);
    await expect(menu.getByRole("menuitemradio", { name: /stumm schalten/ })).toHaveAttribute("aria-checked", "true");
    // Escape puts it away, although the keyboard never went into it.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // A pattern goes from one ring into another.
    const before = await state(page);
    spot = await where(page, 0, 2);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Noch nichts kopiert" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Das Muster dieses Rings merken" }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Muster von Kick kopiert");
    spot = await where(page, 1, 5);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Snare · Schritt 6");
    await menu.getByRole("menuitem", { name: "Das Muster von Kick hierher legen" }).click();
    await expect(status(page)).toHaveText("Snare: 4 Schläge auf 1, 5, 9, 13 von 16");
    // A press beside the menu puts it away, too.
    await page.mouse.click(4, 400);
    await expect(menu).toBeHidden();
    await page.keyboard.press("Control+z");
    expect(await state(page)).toBe(before);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("hat auch an Mitte, Akkorden, Szenen, Stück und Liste ein Menü", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    const chords = () => page.evaluate(() => window.kreisel.app.project.scenes[0]!.chords);

    // The hub: the right button does not start the Kreisel, it shows what else the hub can do.
    const box = (await page.locator("#kreisel").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Kreisel");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await menu.getByRole("menuitem", { name: /Hilfe und Tasten/ }).click();
    await expect(page.locator("#help")).toBeVisible();
    await expect(page.locator("#help")).toContainText("Rechtsklick");
    await page.keyboard.press("Escape");
    await expect(page.locator("#help")).toBeHidden();

    // A chord field: another chord, a bar more, a bar less.
    const field = await page.evaluate(() => window.kreisel.slot(1));
    await page.mouse.click(field.x, field.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Takt 2 von 4");
    await expect(page.locator("#chord-menu")).toBeHidden();
    await menu.getByRole("menuitemradio", { name: "Dm" }).click();
    expect(await chords()).toEqual([0, 3, 2, 6]);
    await menu.getByRole("menuitem", { name: "Takt verdoppeln" }).click();
    expect(await chords()).toEqual([0, 3, 3, 2, 6]);
    await expect(menu.locator("header")).toHaveText("Takt 2 von 5");
    await menu.getByRole("menuitem", { name: "Takt entfernen" }).click();
    expect(await chords()).toEqual([0, 3, 2, 6]);
    await expect(menu).toBeHidden();

    // A scene: a copy in the next free one; an empty one says so.
    await page.locator(".scene", { hasText: "A" }).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Szene A");
    await menu.getByRole("menuitem", { name: "Kopie nach B legen" }).click();
    await expect(page.locator(".scene.current")).toHaveText("B");
    await page.locator(".scene", { hasText: "D" }).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Szene D (leer)");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.kreisel.app.dismiss());

    // The piece: a scene on four bars, more tension, and playing from a bar.
    const bar = await barAt(page, 9, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Stück · Takt 10");
    await menu.getByRole("menuitemradio", { name: "Szene A auf diese vier Takte legen" }).click();
    expect((await pieceOf(page)).scenes.slice(7, 13)).toEqual([0, 0, 0, 0, 0, 0]);
    await menu.getByRole("menuitemradio", { name: "Szene B auf diese vier Takte legen" }).click();
    expect((await pieceOf(page)).scenes.slice(7, 13)).toEqual([0, 1, 1, 1, 1, 0]);
    const tension = (await pieceOf(page)).tension[9]!;
    await menu.getByRole("menuitem", { name: "Mehr los in diesem Takt" }).click();
    expect((await pieceOf(page)).tension[9]).toBe(tension + 2);
    await menu.getByRole("menuitem", { name: "Ab hier spielen" }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => [window.kreisel.app.project.piece.on, window.kreisel.app.piece.start])).toEqual([true, 9]);
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");

    // A ring's row in the list opens the ring's menu and picks the ring.
    await page.locator(".track", { hasText: "Hi-Hat" }).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Hi-Hat");
    await expect(status(page)).toContainText("Hi-Hat:");
    await page.keyboard.press("Escape");

    // The menu key opens the same menu at the keyboard's cursor and takes the keyboard with it.
    await page.locator("#kreisel").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ContextMenu");
    await expect(menu.locator("header")).toHaveText("Hi-Hat · Schritt 1");
    await expect(menu.locator("button:focus")).toHaveText("leise");
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator("button:focus")).toHaveText("normal");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[1]!.patterns[2]!.steps[0]!.vel)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("kreisel");
    expect(problems).toEqual([]);
  });

  test("rastet Effekte mit der rechten Taste ein und setzt Regler zurück", async ({ page }) => {
    const problems = await open(page);
    const fx = () => page.evaluate(() => ({ ...window.kreisel.app.engine.fx }));
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    const dull = page.locator(".pad-fx", { hasText: "Dumpf" });
    await dull.click({ button: "right" });
    await expect(dull).toHaveClass(/latched/);
    await expect(dull).toHaveAttribute("aria-pressed", "true");
    expect((await fx()).dumpf).toBe(true);
    // The next press lets it go again.
    await dull.click();
    await expect(dull).not.toHaveClass(/held/);
    expect((await fx()).dumpf).toBe(false);
    // With Shift the key latches, the same key lets go; stopping lets everything go.
    const thin = page.locator(".pad-fx", { hasText: "Dünn" });
    await page.keyboard.press("Shift+KeyX");
    await expect(thin).toHaveClass(/latched/);
    expect((await fx()).duenn).toBe(true);
    await page.keyboard.press("KeyX");
    await expect(thin).not.toHaveClass(/held/);
    await page.keyboard.press("Shift+KeyX");
    await expect(thin).toHaveClass(/latched/);
    await page.keyboard.press("Space");
    await expect(page.locator(".pad-fx.latched")).toHaveCount(0);
    expect((await fx()).duenn).toBe(false);
    // Latched with the mouse, an effect does not keep the keyboard: the space bar still stops the Kreisel.
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await dull.click({ button: "right" });
    await expect(dull).toHaveClass(/latched/);
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".pad-fx.latched")).toHaveCount(0);

    // The right button puts a control back where a fresh Kreisel has it.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.select(6);
      app.rings.setTrack(6, { hall: 0.9, echo: 0.9, x: 0.1, y: 0.9 });
      app.setGlobal({ swing: 0.5 });
    });
    await page.locator(".panel-ring .line", { hasText: "Hall" }).locator("input").click({ button: "right" });
    await page.locator(".panel-ring .pad").click({ button: "right" });
    await page.locator("#swing").click({ button: "right" });
    expect(await page.evaluate(() => {
      const project = window.kreisel.app.project;
      const melody = project.tracks[6]!;
      return [melody.hall, melody.echo, melody.x, melody.y, project.swing];
    })).toEqual([0.3, 0.9, 0.55, 0.45, 0.18]);
    await expect(page.locator(".panel-ring .line", { hasText: "Hall" }).locator("input")).toHaveValue("30");
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("öffnet mit einem langen Fingerdruck dasselbe Menü wie die rechte Taste", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    /** A finger that comes down, rests for `hold` ms and goes up again. */
    const rest = async (selector: string, x: number, y: number, hold: number): Promise<void> => {
      const finger = { pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true };
      await page.locator(selector).dispatchEvent("pointerdown", finger);
      await page.waitForTimeout(hold);
      await page.locator(selector).dispatchEvent("pointerup", finger);
    };

    // Resting on an empty step: the hit the touch had set is taken back, the menu opens instead.
    await focus(page, 0);
    let spot = await where(page, 0, 2);
    const before = await state(page);
    await rest("#kreisel", spot.x, spot.y, 800);
    await expect(menu.locator("header")).toHaveText("Kick · Schritt 3");
    expect(await state(page)).toBe(before);
    expect(await page.evaluate(() => window.kreisel.app.store.canUndo)).toBe(false);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await menu.getByRole("menuitem", { name: "Schlag setzen" }).tap();
    await expect(status(page)).toHaveText("Kick: 5 Schläge auf 1, 3, 5, 9, 13 von 16");
    await menu.getByRole("menuitemradio", { name: "laut" }).tap();
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[0]!.steps[2]!.vel)).toBe(2);
    // A touch beside the menu puts it away.
    await page.locator("#status").tap();
    await expect(menu).toBeHidden();

    // A short touch still sets and removes hits.
    spot = await where(page, 0, 2);
    await rest("#kreisel", spot.x, spot.y, 120);
    await expect(menu).toBeHidden();
    await expect(status(page)).toHaveText("Kick: 4 Schläge auf 1, 5, 9, 13 von 16");

    // Resting on the piece's ring does not paint: it asks what to do with the bar.
    await focusPiece(page);
    const rim = await barAt(page, 6, 1);
    const tension = (await pieceOf(page)).tension;
    await rest("#kreisel", rim.x, rim.y, 800);
    await expect(menu.locator("header")).toHaveText("Stück · Takt 7");
    expect((await pieceOf(page)).tension).toEqual(tension);
    await menu.getByRole("menuitem", { name: "Ab hier spielen" }).tap();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.kreisel.app.piece.start)).toBe(6);
    await page.locator("#play").tap();

    // A ring's row in the list and a scene answer a resting finger, too, without being pressed.
    const row = (await page.locator(".track", { hasText: "Snare" }).boundingBox())!;
    await rest(".track:has-text('Snare')", row.x + 30, row.y + row.height / 2, 800);
    await expect(menu.locator("header")).toHaveText("Snare");
    await page.keyboard.press("Escape");
    const scene = (await page.locator(".scene", { hasText: "C" }).boundingBox())!;
    await rest(".scene:has-text('C')", scene.x + scene.width / 2, scene.y + scene.height / 2, 800);
    await expect(menu.locator("header")).toHaveText("Szene C (leer)");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[2])).toBeNull();
    expect(problems).toEqual([]);
  });
});

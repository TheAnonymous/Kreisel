import { expect, test } from "@playwright/test";
import { barAt, focus, focusPiece, onLaptop, onPhone, open, pieceOf, soundOf, state, status, where } from "./helpers";

/*
 * What the right button, and a long press of a finger, offer at each place.
 */

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("shows with the right button what can be done at that place", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    const bass = (step: number) => page.evaluate((at) => window.kreisel.app.project.scenes[0]!.patterns[4]!.steps[at]!, step);
    await focus(page, 4);

    // A right click on a hit leaves it where it is and shows what can be done with it.
    let spot = await where(page, 4, 3);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Bass · step 4");
    await expect(status(page)).toHaveText("Bass: 6 hits on 1, 4, 7, 9, 12, 15 of 16");
    await menu.getByRole("menuitemradio", { name: "loud" }).click();
    await menu.getByRole("menuitemradio", { name: /50 % of the rounds/ }).click();
    await menu.getByRole("menuitemradio", { name: "3 fast hits" }).click();
    await menu.getByRole("menuitem", { name: "Hold the note longer" }).click();
    await menu.getByRole("menuitem", { name: "Higher" }).click();
    expect(await bass(3)).toEqual({ on: true, vel: 2, chance: 2, ratchet: 3, pitch: 1, len: 2 });
    // The menu stays open and says what is there now.
    await expect(menu.getByRole("menuitemradio", { name: "loud" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByText("Length 2")).toBeVisible();
    // Used with the mouse, it leaves the keyboard with the Kreisel: the space bar starts and stops.
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await expect(menu).toBeVisible();
    expect(await bass(3)).toEqual({ on: true, vel: 2, chance: 2, ratchet: 3, pitch: 1, len: 2 });
    await menu.getByRole("menuitem", { name: "Remove hit" }).click();
    await expect(menu).toBeHidden();
    await expect(status(page)).toHaveText("Bass: 5 hits on 1, 7, 9, 12, 15 of 16");

    // On an empty step it offers to set a hit, and then shows the hit's rows.
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.getByText("Accent")).toBeHidden();
    await menu.getByRole("menuitem", { name: "Place hit" }).click();
    await expect(menu.getByText("Accent")).toBeVisible();
    await expect(status(page)).toHaveText("Bass: 6 hits on 1, 4, 7, 9, 12, 15 of 16");

    // The whole ring: its length, its sound, who is heard.
    await menu.getByRole("menuitemradio", { name: "12 steps" }).click();
    await expect(status(page)).toContainText("of 12");
    await menu.getByRole("menuitem", { name: "Next sound from the palette" }).click();
    expect(await soundOf(page, 4)).toBe(34);
    await expect(menu.getByRole("menuitem", { name: "Show all 50 sounds of this ring" })).toHaveText("Bounce");
    await menu.getByRole("menuitemradio", { name: /Mute this ring/ }).click();
    expect(await page.evaluate(() => window.kreisel.app.project.tracks[4]!.mute)).toBe(true);
    await expect(menu.getByRole("menuitemradio", { name: /Mute this ring/ })).toHaveAttribute("aria-checked", "true");
    // Escape puts it away, although the keyboard never went into it.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // A pattern goes from one ring into another.
    const before = await state(page);
    spot = await where(page, 0, 2);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Nothing copied yet" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Remember this ring's pattern" }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Pattern of Kick copied");
    spot = await where(page, 1, 5);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Snare · step 6");
    await menu.getByRole("menuitem", { name: "Put the pattern of Kick here" }).click();
    await expect(status(page)).toHaveText("Snare: 4 hits on 1, 5, 9, 13 of 16 · with the kick");
    // A press beside the menu puts it away, too.
    await page.mouse.click(4, 400);
    await expect(menu).toBeHidden();
    await page.keyboard.press("Control+z");
    expect(await state(page)).toBe(before);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("also has a menu at the middle, the chords, the scenes, the piece and the list", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    const chords = () => page.evaluate(() => window.kreisel.app.project.scenes[0]!.chords);

    // The hub: the right button does not start the Kreisel, it shows what else the hub can do.
    const box = (await page.locator("#kreisel").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Kreisel");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await menu.getByRole("menuitem", { name: /Help and keys/ }).click();
    await expect(page.locator("#help")).toBeVisible();
    await expect(page.locator("#help")).toContainText("Right click");
    await page.keyboard.press("Escape");
    await expect(page.locator("#help")).toBeHidden();

    // A chord field: another chord, a bar more, a bar less.
    const field = await page.evaluate(() => window.kreisel.slot(1));
    await page.mouse.click(field.x, field.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Bar 2 of 4");
    await expect(page.locator("#chord-menu")).toBeHidden();
    await menu.getByRole("menuitemradio", { name: "Dm" }).click();
    expect(await chords()).toEqual([0, 3, 2, 6]);
    await menu.getByRole("menuitem", { name: "Double the bar" }).click();
    expect(await chords()).toEqual([0, 3, 3, 2, 6]);
    await expect(menu.locator("header")).toHaveText("Bar 2 of 5");
    await menu.getByRole("menuitem", { name: "Remove the bar" }).click();
    expect(await chords()).toEqual([0, 3, 2, 6]);
    await expect(menu).toBeHidden();

    // A scene: a copy in the next free one; an empty one says so.
    await page.locator(".scene", { hasText: "A" }).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Scene A");
    await menu.getByRole("menuitem", { name: "Put a copy on B" }).click();
    await expect(page.locator(".scene.current")).toHaveText("B");
    await page.locator(".scene", { hasText: "D" }).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Scene D (empty)");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.kreisel.app.dismiss());

    // The piece: a scene on four bars, more tension, and playing from a bar.
    const bar = await barAt(page, 9, 0.5);
    await page.mouse.click(bar.x, bar.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Piece · bar 10");
    await menu.getByRole("menuitemradio", { name: "Put scene A on these four bars" }).click();
    expect((await pieceOf(page)).scenes.slice(7, 13)).toEqual([0, 0, 0, 0, 0, 0]);
    await menu.getByRole("menuitemradio", { name: "Put scene B on these four bars" }).click();
    expect((await pieceOf(page)).scenes.slice(7, 13)).toEqual([0, 1, 1, 1, 1, 0]);
    const tension = (await pieceOf(page)).tension[9]!;
    await menu.getByRole("menuitem", { name: "More going on in this bar" }).click();
    expect((await pieceOf(page)).tension[9]).toBe(tension + 2);
    await menu.getByRole("menuitem", { name: "Play from here" }).click();
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
    await expect(menu.locator("header")).toHaveText("Hi-Hat · step 1");
    await expect(menu.locator("button:focus")).toHaveText("quiet");
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator("button:focus")).toHaveText("normal");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[1]!.patterns[2]!.steps[0]!.vel)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("kreisel");
    expect(problems).toEqual([]);
  });

  test("latches effects with the right button and resets sliders", async ({ page }) => {
    const problems = await open(page);
    const fx = () => page.evaluate(() => ({ ...window.kreisel.app.engine.fx }));
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    const dull = page.locator(".pad-fx", { hasText: "Dull" });
    await dull.click({ button: "right" });
    await expect(dull).toHaveClass(/latched/);
    await expect(dull).toHaveAttribute("aria-pressed", "true");
    expect((await fx()).dumpf).toBe(true);
    // The next press lets it go again.
    await dull.click();
    await expect(dull).not.toHaveClass(/held/);
    expect((await fx()).dumpf).toBe(false);
    // With Shift the key latches, the same key lets go; stopping lets everything go.
    const thin = page.locator(".pad-fx", { hasText: "Thin" });
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
    await page.locator(".panel-ring .line", { hasText: "Reverb" }).locator("input").click({ button: "right" });
    await page.locator(".panel-ring .pad").click({ button: "right" });
    await page.locator("#swing").click({ button: "right" });
    expect(await page.evaluate(() => {
      const project = window.kreisel.app.project;
      const melody = project.tracks[6]!;
      return [melody.hall, melody.echo, melody.x, melody.y, project.swing];
    })).toEqual([0.3, 0.9, 0.55, 0.45, 0.18]);
    await expect(page.locator(".panel-ring .line", { hasText: "Reverb" }).locator("input")).toHaveValue("30");
    expect(problems).toEqual([]);
  });

  test("latches an effect while it stands too, and it acts from the first beat on", async ({ page }) => {
    const problems = await open(page);
    const fx = () => page.evaluate(() => ({ ...window.kreisel.app.engine.fx }));
    const struck = (track: number): Promise<boolean> => page.evaluate((ring) => (window.kreisel.app.engine.struck[ring] ?? -10) > 0, track);
    // While the Kreisel stands, Shift and the key latch, and the latch holds; the same key lets it go.
    const thin = page.locator(".pad-fx", { hasText: "Thin" });
    await page.keyboard.press("Shift+KeyX");
    await expect(thin).toHaveClass(/latched/);
    await expect(thin).toHaveAttribute("aria-pressed", "true");
    expect((await fx()).duenn).toBe(true);
    await page.keyboard.press("KeyX");
    await expect(thin).not.toHaveClass(/latched/);
    await expect(thin).not.toHaveClass(/held/);
    expect((await fx()).duenn).toBe(false);
    // The pause, latched before the start, holds drums and bass back from the first hit on: only the upper rings play.
    const pause = page.locator(".pad-fx", { hasText: "Pause" });
    await pause.click({ button: "right" });
    await expect(pause).toHaveClass(/latched/);
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => struck(6)).toBe(true);
    await page.waitForTimeout(1500);
    expect(await struck(0)).toBe(false);
    await expect(pause).toHaveClass(/latched/);
    // Letting it go brings them in.
    await pause.click();
    await expect(pause).not.toHaveClass(/latched/);
    await expect.poll(() => struck(0)).toBe(true);
    // Stopping lets everything go, as it did.
    await page.keyboard.press("Shift+KeyX");
    await expect(thin).toHaveClass(/latched/);
    await page.keyboard.press("Space");
    await expect(page.locator(".pad-fx.latched")).toHaveCount(0);
    expect(await fx()).toEqual({ dumpf: false, duenn: false, stotter: false, wurf: false, pause: false, aufbau: false });
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("opens the same menu as the right button with a long press of a finger", async ({ page }) => {
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
    await expect(menu.locator("header")).toHaveText("Kick · step 3");
    expect(await state(page)).toBe(before);
    expect(await page.evaluate(() => window.kreisel.app.store.canUndo)).toBe(false);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await menu.getByRole("menuitem", { name: "Place hit" }).tap();
    await expect(status(page)).toHaveText("Kick: 5 hits on 1, 3, 5, 9, 13 of 16 · all rings meet every 3 bars");
    await menu.getByRole("menuitemradio", { name: "loud" }).tap();
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[0]!.steps[2]!.vel)).toBe(2);
    // A touch beside the menu puts it away.
    await page.locator("#status").tap();
    await expect(menu).toBeHidden();

    // A short touch still sets and removes hits.
    spot = await where(page, 0, 2);
    await rest("#kreisel", spot.x, spot.y, 120);
    await expect(menu).toBeHidden();
    await expect(status(page)).toHaveText("Kick: 4 hits on 1, 5, 9, 13 of 16 · all rings meet every 3 bars");

    // Resting on the piece's ring does not paint: it asks what to do with the bar.
    await focusPiece(page);
    const rim = await barAt(page, 6, 1);
    const tension = (await pieceOf(page)).tension;
    await rest("#kreisel", rim.x, rim.y, 800);
    await expect(menu.locator("header")).toHaveText("Piece · bar 7");
    expect((await pieceOf(page)).tension).toEqual(tension);
    await menu.getByRole("menuitem", { name: "Play from here" }).tap();
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
    await expect(menu.locator("header")).toHaveText("Scene C (empty)");
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[2])).toBeNull();
    expect(problems).toEqual([]);
  });
});

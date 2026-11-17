import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readOggOpus } from "../src/ogg";

/*
 * The built app behind the preview server, which sends the production
 * Content-Security-Policy: whatever the live site would block fails here.
 */

declare global {
  interface Window {
    cspViolations: string[];
  }
}

async function open(page: Page, path = "./"): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("kreisel.hinweis", "1");
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.goto(path);
  await expect(page.locator("#status")).toContainText("Schläge");
  return problems;
}

const status = (page: Page) => page.locator("#status");
const state = (page: Page): Promise<string> => page.evaluate(() => window.kreisel.state());
const where = (page: Page, track: number, step: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([ring, at]) => window.kreisel.where(ring ?? 0, at ?? 0), [track, step]);

/** Picks a ring and waits until it has grown to its full width. */
async function focus(page: Page, track: number): Promise<void> {
  await page.evaluate((ring) => window.kreisel.app.select(ring), track);
  await expect.poll(async () => {
    const first = await where(page, track, 0);
    await page.waitForTimeout(80);
    const second = await where(page, track, 0);
    return Math.abs(first.y - second.y);
  }).toBeLessThan(0.05);
}

/** Where a point of the open paint box is on the page (time and height, both 0..1). */
const sheet = (page: Page, t: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([time, height]) => window.kreisel.sheet(time ?? 0, height ?? 0), [t, y]);

/** One stroke of the brush through the given points. */
async function paint(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const start = await sheet(page, first[0], first[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of rest) {
    const spot = await sheet(page, point[0], point[1]);
    await page.mouse.move(spot.x, spot.y, { steps: 5 });
  }
  await page.mouse.up();
}

const bodyOf = (page: Page, track: number) => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.body, track);
/** Where a place on the body on the workbench is on the page (0 its middle, 1 its edge). */
const knockAt = (page: Page, where: number): Promise<{ x: number; y: number }> => page.evaluate((place) => window.kreisel.knock(place), where);

/** What a saved Opus file says about itself, and what the browser hears when it decodes it. */
async function heard(page: Page, download: Download): Promise<{ seconds: number; channels: number; ended: boolean; decoded: number; peak: number; bytes: number }> {
  const bytes = readFileSync(await download.path());
  const file = readOggOpus(bytes);
  expect(file).not.toBeNull();
  const decoded = await page.evaluate(async (data) => {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(Uint8Array.from(data).buffer);
    let peak = 0;
    for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
    await context.close();
    return { seconds: buffer.duration, peak };
  }, [...bytes]);
  return { seconds: file!.samples / 48_000, channels: file!.channels, ended: file!.ended, decoded: decoded.seconds, peak: decoded.peak, bytes: bytes.length };
}

const bildOf = (page: Page, track: number) => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.bild, track);
const soundOf = (page: Page, track: number): Promise<number> => page.evaluate((ring) => window.kreisel.app.project.tracks[ring]!.sound, track);

/** Where a bar of the piece's ring is on the page, at a tension of 0..1. */
const barAt = (page: Page, bar: number, height: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([index, share]) => window.kreisel.bar(index ?? 0, share ?? 0), [bar, height]);
const pieceOf = (page: Page) => page.evaluate(() => window.kreisel.app.project.piece);

/** Puts the piece's ring in focus and waits until it has grown to its full width. */
async function focusPiece(page: Page): Promise<void> {
  await page.evaluate(() => window.kreisel.app.focusPiece());
  await expect.poll(async () => {
    const first = await barAt(page, 0, 1);
    await page.waitForTimeout(80);
    const second = await barAt(page, 0, 0);
    const third = await barAt(page, 0, 1);
    return Math.abs(first.y - third.y) + (second.y > third.y ? 0 : 1);
  }).toBeLessThan(0.05);
}

const laptop = ({ isMobile }: { isMobile: boolean }): boolean => !isMobile;

test.describe("am Laptop", () => {
  test.skip(({ isMobile }) => isMobile, "Maus und Tastatur");

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
    expect(await page.evaluate(() => [window.kreisel.app.project.piece.on, window.kreisel.app.pieceStart])).toEqual([true, 9]);
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
      app.setTrack(6, { hall: 0.9, echo: 0.9, x: 0.1, y: 0.9 });
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
    await page.evaluate(() => window.kreisel.app.openChord(1));
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
    await page.locator(".chips .chip", { hasText: "Acid" }).click();
    await expect(page.locator(".track.selected .sound")).toHaveText("Acid");
    await page.locator("#scale").selectOption("dur");
    await page.locator("#root").selectOption("0");
    await page.evaluate(() => window.kreisel.app.openChord(0));
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

  test("teilt den Kreisel als Link und behält den eigenen", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.keyboard.press("n");
    await page.locator("#bpm").fill("133");
    await page.locator("#bpm").blur();
    const shared = await state(page);
    await page.locator("#share").click();
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/Kreisel\/#k=1\.[0-9A-Za-z_-]+$/);
    expect(link.length).toBeLessThan(1200);

    const other = await context.newPage();
    await open(other);
    const mine = await state(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect(other.url()).not.toContain("#");
    await other.locator("#toast").getByRole("button", { name: "Zurück zu meinem" }).click();
    expect(await state(other)).toBe(mine);

    await other.goto(`${new URL(link).origin}/Kreisel/#k=1.kaputt`);
    await expect(other.locator("#toast")).toContainText("nicht öffnen");
  });

  test("merkt sich den Kreisel über einen Neustart", async ({ page }) => {
    await open(page);
    await page.keyboard.press("n");
    await page.locator("#pump").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.kreisel.app.project.pump)).toBeCloseTo(0.32);
    const before = await state(page);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(status(page)).toContainText("Melodie:");
    expect(await state(page)).toBe(before);
  });

  test("speichert als Opus: die Szene und eine Aufnahme", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 180 }));
    await page.locator("#more").click();
    const rendered = page.waitForEvent("download");
    await page.locator("#menu").getByText("Als Opus speichern").click();
    const saved = await rendered;
    // The name stays an Opus file's, also in Firefox (which renames files whose type it thinks it knows better).
    expect(saved.suggestedFilename()).toBe("kreisel.opus");
    await expect(page.locator("#toast")).toContainText("Die Szene als Opus gespeichert");
    const scene = await heard(page, saved);
    // Eight bars at 180 BPM are a little over ten seconds, plus what rings out; in stereo, ended properly.
    expect(scene.seconds).toBeGreaterThan(10.6);
    expect(scene.seconds).toBeLessThan(14);
    expect(scene.channels).toBe(2);
    expect(scene.ended).toBe(true);
    // The browser plays what it wrote: as long as the file says, and not silent.
    expect(Math.abs(scene.decoded - scene.seconds)).toBeLessThan(0.05);
    expect(scene.peak).toBeGreaterThan(0.2);
    expect(scene.peak).toBeLessThanOrEqual(1);
    // A tenth and less of what the WAV weighed.
    expect(scene.bytes).toBeGreaterThan(60_000);
    expect(scene.bytes).toBeLessThan(500_000);

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1800);
    const taken = page.waitForEvent("download");
    await page.locator("#record").click();
    const take = await taken;
    expect(take.suggestedFilename()).toBe("kreisel-aufnahme.opus");
    await expect(page.locator("#toast")).toContainText("Aufnahme als Opus gespeichert");
    const recording = await heard(page, take);
    expect(recording.seconds).toBeGreaterThan(1);
    expect(recording.seconds).toBeLessThan(5);
    expect(recording.peak).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("speichert ein WAV, wo der Browser kein Opus schreiben kann", async ({ page }) => {
    await page.addInitScript(() => {
      // A browser without the encoder, as older ones are.
      delete (window as { AudioEncoder?: unknown }).AudioEncoder;
    });
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 180 }));
    await page.locator("#more").click();
    const rendered = page.waitForEvent("download");
    await page.locator("#menu").getByText("Als Opus speichern").click();
    const wav = await rendered;
    expect(wav.suggestedFilename()).toBe("kreisel.wav");
    await expect(page.locator("#toast")).toContainText("als WAV (dieser Browser schreibt kein Opus) gespeichert");
    const bytes = readFileSync(await wav.path());
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    // Eight bars at 180 BPM are a little over ten seconds of 16-bit stereo.
    expect(bytes.length).toBeGreaterThan(1_500_000);
    let peak = 0;
    for (let offset = 44; offset + 1 < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(6000);
    expect(peak).toBeLessThan(32_500);
    expect(problems).toEqual([]);
  });

  test("baut einem Ring einen Klangkörper", async ({ page }) => {
    const problems = await open(page);
    const bench = page.locator("#bench");
    await page.keyboard.press("7");
    await page.locator("#build").click();
    await expect(bench).toBeVisible();
    await expect(page.locator("#mallets")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    await expect(status(page)).toContainText("Klangkörper Melodie:");
    // A ring without a body gets a first one that suits it, and plays it from then on.
    expect(await bodyOf(page, 6)).not.toBeNull();
    expect(await soundOf(page, 6)).toBe(5);

    // Another kind of body; knocking on it is heard, and where it was last knocked is where the ring strikes it.
    await bench.getByRole("button", { name: "Schale", exact: true }).click();
    expect((await bodyOf(page, 6))!.kind).toBe(4);
    await expect(page.locator(".track.selected .sound")).toHaveText("Schale");
    let spot = await knockAt(page, 0.2);
    await page.mouse.click(spot.x, spot.y);
    expect((await bodyOf(page, 6))!.where).toBeCloseTo(0.2, 1);
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);
    spot = await knockAt(page, 0.9);
    await page.mouse.click(spot.x, spot.y);
    expect((await bodyOf(page, 6))!.where).toBeCloseTo(0.9, 1);
    await expect(status(page)).toContainText("Rand");

    // What sets it going is on the top row of keys; a bowed body sounds on.
    await page.keyboard.press("e");
    expect((await bodyOf(page, 6))!.exciter).toBe(2);
    await expect(page.locator("#mallets .tool").nth(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("r");
    await expect(status(page)).toContainText("gestrichen");
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);

    // The right grip pulls it bigger, the left one tightens it; the wheel changes its size, too.
    await bench.getByRole("button", { name: "Stab", exact: true }).click();
    const before = (await bodyOf(page, 6))!;
    const size = await page.evaluate(() => window.kreisel.grip("size"));
    await page.mouse.move(size.x, size.y);
    await page.mouse.down();
    await page.mouse.move(size.x + (before.size > 0.5 ? -50 : 50), size.y, { steps: 5 });
    await page.mouse.up();
    const sized = (await bodyOf(page, 6))!;
    expect(Math.abs(sized.size - before.size)).toBeGreaterThan(0.1);
    const tight = await page.evaluate(() => window.kreisel.grip("tight"));
    await page.mouse.move(tight.x, tight.y);
    await page.mouse.down();
    await page.mouse.move(tight.x, tight.y + (before.tight > 0.5 ? 45 : -45), { steps: 5 });
    await page.mouse.up();
    expect(Math.abs((await bodyOf(page, 6))!.tight - before.tight)).toBeGreaterThan(0.2);
    spot = await knockAt(page, 0.3);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, sized.size > 0.5 ? 100 : -100);
    expect(Math.abs((await bodyOf(page, 6))!.size - sized.size)).toBeGreaterThan(0.05);

    // The material: a slider from wood to glass, and the right button puts it back in the middle.
    const material = page.locator("#bench-shape input").nth(2);
    await material.fill("100");
    expect((await bodyOf(page, 6))!.material).toBe(1);
    await expect(page.locator("#bench-shape .label").nth(2)).toHaveText("Material: Glas");
    await material.fill("0");
    await expect(page.locator("#bench-shape .label").nth(2)).toHaveText("Material: Holz");
    await material.click({ button: "right" });
    expect((await bodyOf(page, 6))!.material).toBe(0.5);

    // Dice, one step back, and away with the bench.
    const built = (await bodyOf(page, 6))!;
    await page.keyboard.press("n");
    expect(await bodyOf(page, 6)).not.toEqual(built);
    await page.keyboard.press("Control+z");
    expect(await bodyOf(page, 6)).toEqual(built);
    await page.keyboard.press("Escape");
    await expect(bench).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();

    // In the ring's field the body is one of its sounds: picked with a click, built further with the next.
    const pick = page.locator("#built-pick");
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(pick).toContainText("Klangkörper: Stab");
    await page.locator(".panel-ring .chips .chip").nth(1).click();
    expect(await soundOf(page, 6)).toBe(1);
    await pick.click();
    expect(await soundOf(page, 6)).toBe(5);
    await expect(bench).toBeHidden();
    await pick.click();
    await expect(bench).toBeVisible();
    await page.locator("#bench-done").click();

    // The ring plays its body.
    await page.evaluate(() => window.kreisel.app.toggleSolo(6));
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.04);
    await page.keyboard.press("Space");

    // The right button on another ring leads to its bench; a ring that has no body yet has none to take.
    const kick = await where(page, 0, 2);
    await page.mouse.click(kick.x, kick.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu.getByRole("menuitemradio", { name: "Noch nicht gebaut" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Den Klangkörper dieses Rings bauen" }).click();
    await expect(bench).toBeVisible();
    await expect(page.locator("#bench-title")).toHaveText("Klangkörper: Kick");
    expect(await soundOf(page, 0)).toBe(5);
    // A ring without a body has no bench: picking one puts it away.
    await page.keyboard.press("2");
    await expect(bench).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("nimmt Klangkörper im Link und in der Datei mit", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const problems = await open(page);
    // Only the kick is heard, and it plays a body.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 180 });
      for (let track = 1; track < 7; track += 1) app.setTrack(track, { mute: true });
      app.select(0);
      app.openBench();
      app.shapeBody({ kind: 0, size: 0.9, tight: 0.2, material: 0.1, exciter: 0, where: 0.1 });
      app.closeBench();
      app.dismiss();
    });
    const shared = await state(page);
    await page.locator("#share").click();
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect(await bodyOf(other, 0)).toEqual({ kind: 0, size: 0.9, tight: 0.2, material: 0.1, exciter: 0, where: 0.1 });
    expect(await soundOf(other, 0)).toBe(5);

    // The saved file holds the body's sound.
    await other.locator("#more").click();
    const rendered = other.waitForEvent("download");
    await other.locator("#menu").getByText("Als Opus speichern").click();
    const file = await heard(other, await rendered);
    expect(file.peak).toBeGreaterThan(0.15);
    expect(problems).toEqual([]);
  });

  test("malt einem Ring einen eigenen Klang", async ({ page }) => {
    const problems = await open(page);
    await page.keyboard.press("1");
    await page.locator("#paint").click();
    await expect(page.locator("#easel")).toBeVisible();
    await expect(page.locator("#brushes")).toBeVisible();
    await expect(page.locator("#tools")).toBeHidden();
    // A ring without a picture gets a first one to start from, and plays it at once.
    await expect(status(page)).toContainText(/Klangmalerei Kick: \d Strich/);
    await expect(page.locator("#own-pick")).toHaveAttribute("aria-pressed", "true");
    expect(await soundOf(page, 0)).toBe(4);

    await page.locator("#bild-clear").click();
    await expect(status(page)).toHaveText("Klangmalerei Kick: noch leer");
    await paint(page, [[0.05, 0.4], [0.15, 0.12], [0.5, 0.1]]);
    await expect(status(page)).toHaveText("Klangmalerei Kick: 1 Strich (1× Summen)");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { intervals: [30, 30, 50, 50, 100, 100] }).toBeGreaterThan(0.02);

    // The third brush, thick, from right to left: a hiss that swells.
    await page.keyboard.press("e");
    await page.keyboard.press("t");
    await paint(page, [[0.6, 0.8], [0.3, 0.8]]);
    expect((await bildOf(page, 0))!.strokes[1]).toMatchObject({ kind: 2, size: 2, swell: true });

    // The right button erases, and undo paints it back.
    const hiss = await sheet(page, 0.45, 0.8);
    await page.mouse.click(hiss.x, hiss.y, { button: "right" });
    await expect(status(page)).toHaveText("Klangmalerei Kick: 1 Strich (1× Summen)");
    await page.keyboard.press("Control+z");
    await expect(status(page)).toHaveText("Klangmalerei Kick: 2 Striche (1× Summen, 1× Zischen)");

    // Back at the wheel, the Kreisel plays the picture.
    await page.keyboard.press("Escape");
    await expect(page.locator("#easel")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    await page.keyboard.press("Shift+m");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");

    // A built-in sound again; the picture waits, one click brings it back, another opens the paint box.
    await page.locator(".chips .chip", { hasText: "Hart" }).click();
    expect(await soundOf(page, 0)).toBe(1);
    await expect(page.locator("#own-pick")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#own-pick").click();
    expect(await soundOf(page, 0)).toBe(4);
    await expect(page.locator("#easel")).toBeHidden();
    await page.locator("#own-pick").click();
    await expect(page.locator("#easel")).toBeVisible();
    await page.locator("#easel-done").click();
    await expect(page.locator("#easel")).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("hält gemalte Töne in der Stimmung und lange Noten an der Linie", async ({ page }) => {
    await open(page);
    await page.keyboard.press("5");
    await page.locator("#paint").click();
    await page.locator("#bild-clear").click();
    // A hum drawn roughly along the root: it sticks to the line.
    await paint(page, [[0.03, 0.118], [0.4, 0.106], [0.8, 0.114]]);
    // The bass's root is 55 Hz: one octave above the bottom of the sheet's nine, 65535 / 9.
    const root = 7282;
    const along = (await bildOf(page, 4))!.strokes[0]!.points;
    expect(along).toHaveLength(4);
    expect([along[1], along[3]]).toEqual([root, root]);
    // Browsers round the pointer's place differently by a pixel.
    expect(Math.abs(along[0]! - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(along[2]! - 204)).toBeLessThanOrEqual(1);
    // A hiss does not stick, and neither does a tone far from every line.
    await paint(page, [[0.1, 0.55], [0.3, 0.57]]);
    const free = (await bildOf(page, 4))!.strokes[1]!.points;
    expect(free[1]).not.toBe(free[3]);

    // The first picture may or may not have held; emptying the sheet does not change that.
    await page.locator("#hold").uncheck();
    expect((await bildOf(page, 4))!.hold).toBeNull();
    await page.locator("#hold").check();
    expect((await bildOf(page, 4))!.hold).toBe(82);
    const handle = await sheet(page, 82 / 255, 1);
    await page.mouse.move(handle.x, handle.y + 7);
    await page.mouse.down();
    const moved = await sheet(page, 0.5, 1);
    await page.mouse.move(moved.x, moved.y + 7, { steps: 5 });
    await page.mouse.up();
    expect((await bildOf(page, 4))!.hold).toBeGreaterThan(120);
    expect((await bildOf(page, 4))!.strokes).toHaveLength(2);
    await page.locator("#hold").uncheck();
    expect((await bildOf(page, 4))!.hold).toBeNull();
    // Drums are struck: no hold to offer.
    await page.keyboard.press("1");
    await expect(page.locator("#hold-box")).toBeHidden();
  });

  test("merkt sich Klangbilder und nimmt sie im Link mit", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.keyboard.press("5");
    await page.locator("#paint").click();
    await page.locator("#bild-keep").click();
    await expect(page.locator("#toast")).toContainText("Gemerkt");
    await expect(page.locator(".kept")).toHaveCount(1);
    const bass = await bildOf(page, 4);

    // From the shelf into another ring.
    await page.keyboard.press("7");
    await expect(status(page)).toHaveText("Klangmalerei Melodie: noch leer");
    await page.locator(".kept-pick").click();
    expect((await bildOf(page, 6))!.strokes).toEqual(bass!.strokes);
    expect(await soundOf(page, 6)).toBe(4);

    await page.keyboard.press("Escape");
    const shared = await state(page);
    await page.locator("#share").click();
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link.length).toBeLessThan(1600);
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect((await bildOf(other, 4))!.strokes).toEqual(bass!.strokes);

    // The shelf outlives the project.
    await page.waitForTimeout(500);
    await page.reload();
    await page.evaluate(() => window.kreisel.app.newProject(true));
    await page.keyboard.press("3");
    await page.locator("#paint").click();
    await expect(page.locator(".kept")).toHaveCount(1);
    await page.locator(".kept-drop").click();
    await expect(page.locator(".kept")).toHaveCount(0);
  });

  test("macht einen Klang vor", async ({ page }) => {
    const problems = await open(page);
    await page.keyboard.press("1");
    await page.locator("#paint").click();
    await page.locator("#bild-clear").click();
    await page.locator("#bild-listen").click();
    await expect(page.locator("#listening")).toBeVisible();
    await expect(page.locator("#toast")).toContainText("So habe ich dich verstanden", { timeout: 15_000 });
    await expect(page.locator("#listening")).toBeHidden();
    // The stand-in microphone plays a falling tone: a humming stroke that ends lower than it began, moved down to where a kick lives.
    const strokes = (await bildOf(page, 0))!.strokes;
    const hum = strokes.find((stroke) => stroke.kind === 0)!;
    expect(hum.points[1]).toBeGreaterThan(hum.points[hum.points.length - 1]!);
    expect(hum.points[hum.points.length - 1]).toBeLessThan(12_000);
    expect(await soundOf(page, 0)).toBe(4);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("malt das Stück in den äußersten Ring", async ({ page }) => {
    const problems = await open(page);
    expect((await pieceOf(page)).on).toBe(false);
    // A click on the resting ring picks it and paints at once.
    const first = await barAt(page, 2, 0.9);
    await page.mouse.click(first.x, first.y);
    await expect(status(page)).toHaveText("Stück: 32 Takte, 1:09 Minuten, im Mittel 66 % Spannung (aus)");
    await expect(page.locator(".piece-row")).toHaveClass(/selected/);
    await expect(page.locator(".panel-piece")).toContainText("Wer zuerst einsetzt");
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
    await page.locator(".panel-piece").getByTitle("64 Takte").click();
    expect((await pieceOf(page)).tension).toHaveLength(64);
    await expect(page.locator(".piece-row .sound")).toHaveText("64 Takte");
    await page.getByRole("button", { name: "Kick früher einsetzen lassen" }).click();
    expect((await pieceOf(page)).order).toEqual([5, 2, 0, 4, 1, 6, 3]);
    await page.locator(".panel-piece").getByText("Würfeln").click();
    expect(Math.max(...(await pieceOf(page)).tension)).toBeGreaterThan(25);

    // Switched on, the piece lays the scenes out itself.
    await page.locator(".piece-toggle").click();
    expect((await pieceOf(page)).on).toBe(true);
    await expect(page.locator("#chain")).toBeDisabled();
    await expect(page.locator("#piece-on")).toBeChecked();
    // Back on a ring, the ring's panel is back.
    await page.keyboard.press("ArrowDown");
    await expect(status(page)).toContainText("Melodie:");
    await expect(page.locator(".panel-ring")).toBeVisible();
    await expect(page.locator(".panel-piece")).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("spielt nach dem Stück: Einsätze, Szenen und Sprünge", async ({ page }) => {
    const problems = await open(page);
    // Eight quick bars: four of silence in scene A, four of everything in scene B.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.pickScene(1);
      app.pickScene(0);
      app.dismiss();
      app.store.edit((project) => {
        project.bpm = 200;
        project.piece = { on: true, tension: [0, 0, 0, 0, 31, 31, 31, 31], scenes: [0, 0, 0, 0, 1, 1, 1, 1], order: project.piece.order };
      });
    });
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piecePlayhead() ?? 0)).toBeGreaterThan(0.4);
    let loudest = 0;
    for (let look = 0; look < 12; look += 1) {
      loudest = Math.max(loudest, await page.evaluate(() => window.kreisel.level()));
      await page.waitForTimeout(50);
    }
    expect(loudest).toBeLessThan(0.01);
    await expect(page.locator(".scene.current")).toHaveText("A");
    // The second half: everyone plays, in scene B. (The bar before it is no longer silent: it takes the run-up.)
    // (On a busy machine the sound can take a few seconds to get going: the wait is generous.)
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piecePlayhead() ?? 0), { timeout: 16000 }).toBeGreaterThan(4.3);
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.05);
    await expect(page.locator(".scene.current")).toHaveText("B");

    // The right button on a bar offers to play from there; "Von vorn" goes to the first.
    await focusPiece(page);
    const quiet = await barAt(page, 1, 0.5);
    await page.mouse.click(quiet.x, quiet.y, { button: "right" });
    await page.locator("#context").getByRole("menuitem", { name: "Ab hier spielen" }).click();
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piecePlayhead() ?? 9)), { timeout: 4000 }).toBe(1);
    await expect(page.locator(".scene.current")).toHaveText("A");
    await page.locator("#piece-top").click();
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piecePlayhead() ?? 9)), { timeout: 4000 }).toBe(0);
    // Switched off while it plays, the Kreisel goes back to its loop and is heard at once.
    await page.locator(".piece-toggle").click();
    // (The loop takes over at the next step; what is heard a moment before may still be the piece ringing out.)
    await expect.poll(() => page.evaluate(() => window.kreisel.app.piecePlayhead()), { timeout: 6000 }).toBeNull();
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 6000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");
    expect(problems).toEqual([]);
  });

  test("speichert das Stück als Opus und nimmt es im Link mit", async ({ page, context }) => {
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
    await page.locator(".panel-piece").getByText("Als Opus speichern").click();
    const saved = await rendered;
    await expect(page.locator("#toast")).toContainText("Das ganze Stück als Opus gespeichert");
    // Four bars at 200 BPM are 4.8 seconds, plus what rings out: not the eight bars of a plain scene.
    const piece = await heard(page, saved);
    expect(piece.seconds).toBeGreaterThan(4.8);
    expect(piece.seconds).toBeLessThan(8.5);
    expect(piece.peak).toBeGreaterThan(0.2);

    const shared = await state(page);
    await page.locator("#share").click();
    await expect(page.locator("#toast")).toContainText("Link kopiert");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const other = await context.newPage();
    await open(other);
    await other.goto(link);
    await expect(other.locator("#toast")).toContainText("Ein geteilter Kreisel");
    expect(await state(other)).toBe(shared);
    expect(await pieceOf(other)).toEqual({ on: true, tension: [8, 14, 31, 31], scenes: [0, 0, 0, 0], order: [0, 1, 2, 3, 4, 5, 6] });
  });

  test("geht reihum von Hand zu Hand im Link", async ({ page, context, browser, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const problems = await open(page);
    const kick = (who: Page): Promise<string> => who.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[0]!.steps.slice(0, 16).map((step) => (step.on ? "x" : ".")).join(""));
    const turns = (who: Page) => who.evaluate(() => window.kreisel.app.relay?.turns.map((turn) => turn.name) ?? null);

    // The first turn: a name is needed, and the first person picks the rule.
    await page.locator("#relay").click();
    await expect(page.locator("#reihum")).toBeVisible();
    await page.locator("#relay-send").click();
    await expect(page.locator("#relay-message")).toContainText("Trag erst deinen Namen ein");
    await page.locator("#relay-name").fill("Jodie");
    await expect(page.locator("#relay-message")).toBeHidden();
    await page.locator("#relay-rules input").nth(1).check();
    await page.locator("#relay-send").click();
    await expect(page.locator("#toast")).toContainText("Zug 1 ist abgeschlossen");
    await expect(page.locator("#reihum")).toBeHidden();
    await expect(page.locator("#relay")).toHaveText("Reihum · 2");
    const first = await page.evaluate(() => navigator.clipboard.readText());

    // Someone else, with a browser of their own, takes the second turn. The rule says: one ring.
    const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
    await elsewhere.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guest = await elsewhere.newPage();
    await open(guest);
    await guest.goto(first);
    await expect(guest.locator("#toast")).toContainText("Reihum: Jodie hat Zug 1 gemacht. Du bist dran.");
    for (const key of ["1", "n", "5", "n"]) await guest.keyboard.press(key);
    await guest.locator("#relay").click();
    await expect(guest.locator("#relay-rules")).toBeHidden();
    await expect(guest.locator("#relay-rule")).toContainText("Spielregel dieser Runde: Ein Ring.");
    await expect(guest.locator("#relay-now")).toHaveText("Dein Zug (Nr. 2): Kick, Bass angefasst.");
    await guest.locator("#relay-name").fill("Mika");
    await guest.locator("#relay-send").click();
    await expect(guest.locator("#relay-message")).toContainText("ein Ring pro Zug. Du hast 2 angefasst (Kick, Bass)");
    await guest.keyboard.press("Escape");
    await guest.keyboard.press("Control+z");
    await guest.locator("#relay").click();
    await expect(guest.locator("#relay-now")).toHaveText("Dein Zug (Nr. 2): Kick angefasst.");
    await guest.locator("#relay-send").click();
    await expect(guest.locator("#toast")).toContainText("Zug 2 ist abgeschlossen");
    const second = await guest.evaluate(() => navigator.clipboard.readText());
    expect(second.length).toBeLessThan(1500);
    const answered = await kick(guest);
    expect(answered).not.toBe("x...x...x...x...");

    // Back with the first person: both turns are there, and the first can be heard again.
    await page.goto(second);
    await expect(page.locator("#toast")).toContainText("Reihum: Mika hat Zug 2 gemacht. Du bist dran.");
    expect(await turns(page)).toEqual(["Jodie", "Mika"]);
    expect(await kick(page)).toBe(answered);
    await page.locator("#relay").click();
    await expect(page.locator(".turn")).toHaveCount(2);
    await page.locator(".turn").first().getByText("Anhören").click();
    await expect(page.locator("#lookback")).toContainText("Rückblick: Zug 1 von Jodie");
    expect(await kick(page)).toBe("x...x...x...x...");
    // Looking back, nothing can be changed, but it plays.
    await page.keyboard.press("1");
    await page.keyboard.press("n");
    await expect(page.locator("#toast")).toContainText("Das ist ein Rückblick");
    expect(await kick(page)).toBe("x...x...x...x...");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.05);
    await page.keyboard.press("Space");
    await page.locator("#lookback").getByText("Zurück zu jetzt").click();
    await expect(page.locator("#lookback")).toBeHidden();
    expect(await kick(page)).toBe(answered);

    // Going on from the first turn drops the second; undo brings it back.
    await page.locator("#relay").click();
    await page.locator(".turn").first().getByText("Von hier weiter").click();
    await expect(page.locator("#toast")).toContainText("Du baust von Zug 1 weiter");
    expect(await turns(page)).toEqual(["Jodie"]);
    expect(await kick(page)).toBe("x...x...x...x...");
    await page.keyboard.press("Control+z");
    expect(await turns(page)).toEqual(["Jodie", "Mika"]);
    expect(await kick(page)).toBe(answered);

    // A round can be ended; the Kreisel stays.
    await page.locator("#relay").click();
    await page.locator("#relay-end").click();
    expect(await turns(page)).toBeNull();
    await expect(page.locator("#relay")).toHaveText("Reihum");
    expect(await kick(page)).toBe(answered);
    await elsewhere.close();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("spielt Stille Post im Link", async ({ page, context, browser, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const veiled = (who: Page): Promise<number[]> => who.evaluate(() => [0, 1, 2, 3, 4, 5, 6].filter((ring) => window.kreisel.app.veiled(ring)));
    const finish = async (who: Page, name: string, rule?: number): Promise<void> => {
      await who.locator("#relay").click();
      await who.locator("#relay-name").fill(name);
      if (rule !== undefined) await who.locator("#relay-rules input").nth(rule).check();
      await who.locator("#relay-send").click();
    };

    // It starts with one ring on an empty Kreisel: the factory groove is too much.
    await finish(page, "Jodie", 2);
    await expect(page.locator("#relay-message")).toContainText("Stille Post beginnt mit einem einzigen Ring");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.kreisel.app.newProject(true);
      window.kreisel.app.dismiss();
    });
    await page.keyboard.press("1");
    await page.keyboard.press("n");
    await finish(page, "Jodie", 2);
    await expect(page.locator("#toast")).toContainText("Zug 1 ist abgeschlossen");

    // The second person hears the kick and builds a bass to it.
    const elsewhere = await browser.newContext({ baseURL: baseURL ?? "" });
    await elsewhere.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guest = await elsewhere.newPage();
    await open(guest, "./");
    await guest.goto(await page.evaluate(() => navigator.clipboard.readText()));
    await expect(guest.locator("#toast")).toContainText("Stille Post von Jodie: Du hörst nur den Ring davor.");
    expect(await veiled(guest)).toEqual([]);
    await guest.keyboard.press("5");
    await guest.keyboard.press("n");
    await finish(guest, "Mika");
    await expect(guest.locator("#toast")).toContainText("Zug 2 ist abgeschlossen");

    // Back with the first: now the bass is heard and the kick is under the cloth, out of sight, hearing and reach.
    await page.goto(await guest.evaluate(() => navigator.clipboard.readText()));
    await expect(page.locator("#toast")).toContainText("Stille Post von Mika");
    expect(await veiled(page)).toEqual([0]);
    expect(await page.evaluate(() => window.kreisel.app.audible(0))).toBe(false);
    expect(await page.evaluate(() => window.kreisel.app.audible(4))).toBe(true);
    await expect(page.locator(".track.veiled")).toHaveCount(1);
    await expect(page.locator(".track.veiled .sound")).toHaveText("verdeckt");
    const before = await state(page);
    await page.keyboard.press("1");
    await expect(status(page)).toHaveText("Kick: verdeckt (Stille Post)");
    await expect(page.locator(".veil-text")).toBeVisible();
    await page.keyboard.press("n");
    await expect(page.locator("#toast")).toContainText("Dieser Ring ist verdeckt");
    await focus(page, 0);
    const spot = await where(page, 0, 6);
    await page.mouse.click(spot.x, spot.y);
    expect(await state(page)).toBe(before);
    // No listening back before the reveal.
    await page.locator("#relay").click();
    await expect(page.locator(".turn").first().getByText("Anhören")).toBeDisabled();
    await page.keyboard.press("Escape");

    // The third turn takes a free ring; then the round is revealed.
    await page.keyboard.press("2");
    await page.keyboard.press("n");
    await finish(page, "Jodie");
    await expect(page.locator("#toast")).toContainText("Zug 3 ist abgeschlossen");
    expect(await veiled(page)).toEqual([0, 4]);
    await page.locator("#relay").click();
    await page.locator("#relay-reveal").click();
    await expect(page.locator("#toast")).toContainText("Aufgedeckt");
    expect(await veiled(page)).toEqual([]);
    await expect(page.locator(".track.veiled")).toHaveCount(0);
    await page.locator("#relay").click();
    await expect(page.locator(".turn").first().getByText("Anhören")).toBeEnabled();
    await elsewhere.close();
  });

  test("startet auch ohne Netz", async ({ page, context }) => {
    await open(page);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 10_000 }).toBe("activated");
    await context.setOffline(true);
    await page.reload();
    await expect(status(page)).toContainText("Melodie: 7 Schläge");
    await context.setOffline(false);
  });
});

test.describe("am Handy", () => {
  test.skip(laptop, "Finger");

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

    // Reihum lives in the menu here.
    await page.locator("#more").tap();
    await page.locator("#menu").getByText("Reihum").tap();
    await expect(page.locator("#reihum")).toBeVisible();
    await expect(page.locator("#relay")).toBeHidden();
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

  test("baut einen Klangkörper: die Werkbank passt aufs Handy, ein Finger klopft", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.select(3));
    await page.locator("#build").tap();
    await expect(page.locator("#bench")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator("#bench").getByRole("button", { name: "Fell", exact: true }).tap();
    await page.locator("#koerper").scrollIntoViewIfNeeded();
    expect((await page.locator("#koerper").boundingBox())!.height).toBeGreaterThan(110);
    const spot = await knockAt(page, 0.6);
    await page.touchscreen.tap(spot.x, spot.y);
    expect((await bodyOf(page, 3))!.where).toBeCloseTo(0.6, 1);
    await page.locator("#mallets .tool").nth(0).tap();
    expect((await bodyOf(page, 3))!.exciter).toBe(0);
    await page.locator("#bench-done").tap();
    await expect(page.locator("#bench")).toBeHidden();
    expect(await soundOf(page, 3)).toBe(5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

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
    expect(await page.evaluate(() => window.kreisel.app.pieceStart)).toBe(6);
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

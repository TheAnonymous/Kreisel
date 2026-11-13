import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

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

    // The right button erases, whatever the tool.
    await page.keyboard.press("w");
    await page.mouse.click(to.x, to.y, { button: "right" });
    await expect(status(page)).toHaveText("Kick: 6 Schläge auf 1, 5, 6, 7, 9, 13 von 16");

    // The wheel turns the ring.
    await page.mouse.move(to.x, to.y);
    await page.mouse.wheel(0, 50);
    await expect(status(page)).toHaveText("Kick: 6 Schläge auf 2, 6, 7, 8, 10, 14 von 16");
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

  test("speichert ein WAV und eine Aufnahme", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 180 }));
    await page.locator("#more").click();
    const rendered = page.waitForEvent("download");
    await page.locator("#menu").getByText("Als WAV speichern").click();
    const wav = await rendered;
    expect(wav.suggestedFilename()).toBe("kreisel.wav");
    const file = await wav.path();
    // Eight bars at 180 BPM are a little over ten seconds of 16-bit stereo.
    expect(statSync(file).size).toBeGreaterThan(1_500_000);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    let peak = 0;
    for (let offset = 44; offset + 1 < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(6000);
    expect(peak).toBeLessThan(32_500);

    await page.locator("#record").click();
    await expect(page.locator("#record")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1800);
    const taken = page.waitForEvent("download");
    await page.locator("#record").click();
    const take = await taken;
    expect(take.suggestedFilename()).toBe("kreisel-aufnahme.wav");
    expect(statSync(await take.path()).size).toBeGreaterThan(150_000);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
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
    await expect(page.locator(".own-pick")).toHaveAttribute("aria-pressed", "true");
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
    await expect(page.locator(".own-pick")).toHaveAttribute("aria-pressed", "false");
    await page.locator(".own-pick").click();
    expect(await soundOf(page, 0)).toBe(4);
    await expect(page.locator("#easel")).toBeHidden();
    await page.locator(".own-pick").click();
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
    await expect(page.locator(".panel-box").last()).toContainText("Wer zuerst einsetzt");
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
    await page.locator(".panel-box").last().getByTitle("64 Takte").click();
    expect((await pieceOf(page)).tension).toHaveLength(64);
    await expect(page.locator(".piece-row .sound")).toHaveText("64 Takte");
    await page.getByRole("button", { name: "Kick früher einsetzen lassen" }).click();
    expect((await pieceOf(page)).order).toEqual([5, 2, 0, 4, 1, 6, 3]);
    await page.locator(".panel-box").last().getByText("Würfeln").click();
    expect(Math.max(...(await pieceOf(page)).tension)).toBeGreaterThan(25);

    // Switched on, the piece lays the scenes out itself.
    await page.locator(".piece-toggle").click();
    expect((await pieceOf(page)).on).toBe(true);
    await expect(page.locator("#chain")).toBeDisabled();
    await expect(page.locator("#piece-on")).toBeChecked();
    // Back on a ring, the ring's panel is back.
    await page.keyboard.press("ArrowDown");
    await expect(status(page)).toContainText("Melodie:");
    await expect(page.locator(".panel-box").first()).toBeVisible();
    await expect(page.locator(".panel-box").last()).toBeHidden();
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
    // The second half: everyone plays, in scene B.
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 9000 }).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => window.kreisel.app.piecePlayhead() ?? 0)).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".scene.current")).toHaveText("B");

    // The right button sends the piece to a bar; "Von vorn" to its first.
    await focusPiece(page);
    const quiet = await barAt(page, 1, 0.5);
    await page.mouse.click(quiet.x, quiet.y, { button: "right" });
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piecePlayhead() ?? 9)), { timeout: 4000 }).toBe(1);
    await expect(page.locator(".scene.current")).toHaveText("A");
    await page.locator("#piece-top").click();
    await expect.poll(() => page.evaluate(() => Math.floor(window.kreisel.app.piecePlayhead() ?? 9)), { timeout: 4000 }).toBe(0);
    // Switched off while it plays, the Kreisel goes back to its loop and is heard at once.
    await page.locator(".piece-toggle").click();
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 6000 }).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => window.kreisel.app.piecePlayhead())).toBeNull();
    await page.keyboard.press("Space");
    expect(problems).toEqual([]);
  });

  test("speichert das Stück als WAV und nimmt es im Link mit", async ({ page, context }) => {
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
    await page.locator(".panel-box").last().getByText("Als WAV speichern").click();
    const wav = await rendered;
    await expect(page.locator("#toast")).toContainText("Das ganze Stück als WAV gespeichert");
    // Four bars at 200 BPM are 4.8 seconds of 16-bit stereo, plus what rings out: not the eight bars of a plain scene.
    const size = statSync(await wav.path()).size;
    expect(size).toBeGreaterThan(4.8 * 44_100 * 4);
    expect(size).toBeLessThan(8.5 * 44_100 * 4);

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

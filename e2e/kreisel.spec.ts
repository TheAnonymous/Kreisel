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
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

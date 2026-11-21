import { expect, test } from "@playwright/test";
import { fromBar, onLaptop, onPhone, open, status, where } from "./helpers";

/*
 * How the page moves and shows itself: the small motions, the tour of a first
 * visit, the light show and the stage.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("bewegt sich, wo sich etwas ändert, und hält still, wenn weniger Bewegung gewünscht ist", async ({ page }) => {
    const problems = await open(page);
    /** What is in motion on the wheel two frames from now (a change is looked at in the next frame). */
    const moving = (): Promise<{ popping: number; shrinking: number; sliding: number }> =>
      page.evaluate(async () => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return window.kreisel.motion();
      });
    /** The motions that play on a node or in it right now, by name. */
    const playing = (selector: string): Promise<string[]> =>
      page.evaluate((query) => [...document.querySelectorAll(query)].flatMap((node) => node.getAnimations({ subtree: true })).map((motion) => motion.id || (motion instanceof CSSAnimation ? motion.animationName : "")), selector);
    const still = { popping: 0, shrinking: 0, sliding: 0 };

    // At first the hits of the factory Kreisel are dealt around their rings; then the wheel lies still.
    expect((await moving()).popping).toBeGreaterThan(10);
    await expect.poll(moving).toEqual(still);

    // A hit that is set hops in, one that is taken shrinks away, a ring that is turned slides.
    const free = await where(page, 6, 1);
    await page.mouse.click(free.x, free.y);
    expect(await moving()).toEqual({ popping: 1, shrinking: 0, sliding: 0 });
    await expect.poll(moving).toEqual(still);
    await page.mouse.click(free.x, free.y);
    expect(await moving()).toEqual({ popping: 0, shrinking: 1, sliding: 0 });
    await expect.poll(moving).toEqual(still);
    await page.mouse.move(free.x, free.y);
    await page.mouse.wheel(0, -100);
    expect(await moving()).toEqual({ popping: 0, shrinking: 0, sliding: 1 });
    await expect.poll(moving).toEqual(still);

    // A diced ring deals its new pattern, the dice in its row tumble and the button answers; so does a key.
    await page.locator(".panel-ring .doing .button", { hasText: "Würfeln" }).click();
    expect(await playing(".track.selected .roll")).toContain("tumble");
    expect(await playing(".panel-ring .doing")).toContain("flash");
    await expect.poll(moving).toEqual(still);
    await page.keyboard.press("Control+z");
    expect(await playing("#undo")).toContain("wind-back");
    await page.keyboard.press("Control+Shift+z");
    expect(await playing("#redo")).toContain("wind-on");

    // Menus unfold, the head of the ring's panel arrives, a held effect shows on its key what it does.
    await page.locator("#help-open").click();
    expect(await playing("#context")).toContain("unfold");
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 400);
    await expect(page.locator("#context")).toBeHidden();
    await page.keyboard.press("5");
    expect(await playing(".panel-head")).toEqual(expect.arrayContaining(["pop", "slide-in"]));
    await page.keyboard.down("KeyC");
    await expect.poll(() => playing('.pad-fx[data-fx="stotter"]')).toContain("stutter");
    await page.keyboard.up("KeyC");
    await expect.poll(() => playing('.pad-fx[data-fx="stotter"]')).not.toContain("stutter");

    // At rest nothing runs (but the ring that beckons to the start, a few times, until the Kreisel has played once).
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((motion) => motion.playState === "running" && !(motion instanceof CSSAnimation && motion.animationName === "beckon")).length))
      .toBe(0);

    // Whoever asked the system for less motion gets none: nothing hops on the wheel, and nothing plays on the page.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(status(page)).toContainText("Schläge");
    expect(await moving()).toEqual(still);
    const again = await where(page, 6, 1);
    await page.mouse.click(again.x, again.y);
    expect(await moving()).toEqual(still);
    await page.locator(".panel-ring .doing .button", { hasText: "Würfeln" }).click();
    expect(await moving()).toEqual(still);
    await page.locator("#help-open").click();
    expect(await page.evaluate(() => document.getAnimations().filter((motion) => Number(motion.effect?.getComputedTiming().activeDuration ?? 0) > 1).length)).toBe(0);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("zeigt beim ersten Besuch die ersten Schritte, wo sie passieren", async ({ page }) => {
    const problems = await open(page, "./", true);
    const tour = page.locator("#tour");
    const count = page.locator("#tour-count");
    await expect(tour).toBeVisible();
    await expect(count).toHaveText("1 von 7");
    await expect(page.locator("#tour-title")).toHaveText("Das ist dein Kreisel");
    /** The light lies around a part of the page, and the card is wholly in the window and not over that part's middle. */
    const lit = (selector: string): Promise<boolean> =>
      page.evaluate((query) => {
        const part = document.querySelector(query)!.getBoundingClientRect();
        const hole = document.querySelector(".tour-hole")!.getBoundingClientRect();
        const card = document.querySelector(".tour-card")!.getBoundingClientRect();
        const around = hole.left <= part.left && hole.top <= part.top && hole.right >= part.right && hole.bottom >= part.bottom && hole.width < part.width + 40;
        const inside = card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight;
        const x = part.left + part.width / 2;
        const y = part.top + part.height / 2;
        return around && inside && !(card.left <= x && card.right >= x && card.top <= y && card.bottom >= y);
      }, selector);
    await expect.poll(() => lit("#kreisel")).toBe(true);

    // Nothing is locked while it runs. What a step asks for can be tried at once, and then it goes on by itself.
    await page.keyboard.press("Space");
    await expect(count).toHaveText("2 von 7");
    const free = await where(page, 6, 1);
    await page.mouse.click(free.x, free.y);
    await expect(count).toHaveText("3 von 7");
    await expect.poll(() => lit("#tracks")).toBe(true);
    await page.keyboard.press("5");
    await expect(count).toHaveText("4 von 7");
    await expect.poll(() => lit("#panel")).toBe(true);
    // The other steps wait for "Weiter".
    const next = page.locator("#tour-next");
    await next.click();
    await expect(count).toHaveText("5 von 7");
    await expect.poll(() => lit("#fx")).toBe(true);
    await next.click();
    await expect.poll(() => lit("#scenes")).toBe(true);
    await next.click();
    await expect(count).toHaveText("7 von 7");
    await expect(next).toHaveText("Los geht’s");
    await next.click();
    await expect(tour).toBeHidden();
    await page.keyboard.press("Space");

    // It comes once. From the question mark in the bar it comes again, and Escape puts it away.
    await page.reload();
    await expect(status(page)).toContainText("Schläge");
    await page.waitForTimeout(1200);
    await expect(tour).toBeHidden();
    await fromBar(page, "help-open", /Tour/);
    await expect(tour).toBeVisible();
    await expect(count).toHaveText("1 von 7");
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
    await fromBar(page, "help-open", /Tour/);
    await page.locator("#tour-skip").click();
    await expect(tour).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("wirft Licht, solange er spielt, und geht auf die Bühne", async ({ page }) => {
    const problems = await open(page);
    const light = (): Promise<{ sparks: number; waves: number; glowing: boolean }> => page.evaluate(() => window.kreisel.light());
    const dark = { sparks: 0, waves: 0, glowing: false };
    /** How much is painted on the canvas of the glow under the wheel. */
    const glow = (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.getElementById("licht") as HTMLCanvasElement;
        const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let index = 3; index < data.length; index += 4) sum += data[index] ?? 0;
        return sum;
      });
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    // Until the Kreisel has played once, a ring around the hub beckons to the start.
    await expect(page.locator(".invite")).toBeVisible();

    await page.keyboard.press("Space");
    await expect.poll(async () => (await light()).glowing).toBe(true);
    await expect.poll(async () => (await light()).sparks, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await light()).waves, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(glow).toBeGreaterThan(0);
    await expect(page.locator(".invite")).toBeHidden();

    // Switched off with the lamp beside the wheel it is dark at once and stays so, also after a reload; switched on, it is back.
    const lights = page.locator("#lights-toggle");
    await expect(lights).toHaveAttribute("aria-pressed", "true");
    await lights.click();
    await expect(page.locator("#toast")).toContainText("Lichtspiel aus");
    await expect.poll(light).toEqual(dark);
    await page.waitForTimeout(700);
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("kreisel.licht"))).toBe("0");
    await expect(lights).toHaveAttribute("aria-pressed", "false");
    await lights.click();
    await expect.poll(async () => (await light()).glowing).toBe(true);

    // The stage: only the wheel, larger, in the dark. The tools and the held effects stay at hand.
    const root = page.locator("html");
    const wide = async (): Promise<number> => (await page.locator("#kreisel").boundingBox())!.width;
    const before = await wide();
    await page.keyboard.press("o");
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(page.locator(".side.left")).toBeHidden();
    await expect(page.locator("#panel")).toBeHidden();
    await expect(page.locator(".bar")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    await expect(page.locator("#fx")).toBeVisible();
    await expect.poll(wide).toBeGreaterThan(before * 1.15);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())).toBe("#0b0910");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    // The wheel still takes a hit there.
    const spot = await where(page, 6, 2);
    const hits = (): Promise<number> => page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[6]!.steps.filter((step) => step.on).length);
    const had = await hits();
    await page.mouse.click(spot.x, spot.y);
    expect(Math.abs((await hits()) - had)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator(".side.left")).toBeVisible();
    await expect.poll(wide).toBeLessThan(before * 1.05);
    // Its button in the corner beside the wheel leads there and back; a window that opens takes the Kreisel off it.
    const toggle = page.locator("#stage-toggle");
    await toggle.click();
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(root).toHaveAttribute("data-stage", "false");
    await toggle.click();
    await page.evaluate(() => window.kreisel.app.voice.open());
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator("#booth")).toBeVisible();
    await page.evaluate(() => {
      window.kreisel.app.voice.close();
      window.kreisel.app.togglePlay();
    });
    expect(await page.evaluate(() => window.kreisel.app.playing)).toBe(false);

    // Whoever asked the system for less motion never sees the light show.
    await expect.poll(light, { timeout: 4000 }).toEqual(dark);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.kreisel.app.togglePlay());
    await page.waitForTimeout(900);
    expect(await light()).toEqual(dark);
    expect(await glow()).toBe(0);
    await page.evaluate(() => window.kreisel.app.togglePlay());
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("zeigt am Handy die ersten Schritte im Fenster und geht auf die Bühne", async ({ page }) => {
    const problems = await open(page, "./", true);
    const tour = page.locator("#tour");
    const count = page.locator("#tour-count");
    await expect(tour).toBeVisible();
    /** The card is wholly in the window, and the part it speaks of is at least partly in view. */
    const inView = (): Promise<boolean> =>
      page.evaluate(() => {
        const card = document.querySelector(".tour-card")!.getBoundingClientRect();
        const hole = document.querySelector(".tour-hole")!.getBoundingClientRect();
        return card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight && hole.bottom > 0 && hole.top < innerHeight;
      });
    for (let step = 1; step <= 7; step += 1) {
      await expect(count).toHaveText(`${step} von 7`);
      await expect.poll(inView).toBe(true);
      await page.locator("#tour-next").tap();
    }
    await expect(tour).toBeHidden();
    // Glow or not, the page is never wider than the window.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

    // The stage: the button in the corner beside the wheel leads there and back.
    await page.evaluate(() => window.scrollTo(0, 0));
    const root = page.locator("html");
    const toggle = page.locator("#stage-toggle");
    await toggle.tap();
    await expect(root).toHaveAttribute("data-stage", "true");
    await expect(page.locator(".side.left")).toBeHidden();
    await expect(page.locator("#tools")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    await toggle.tap();
    await expect(root).toHaveAttribute("data-stage", "false");
    await expect(page.locator(".side.left")).toBeVisible();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

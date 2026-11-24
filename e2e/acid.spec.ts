import { expect, test } from "@playwright/test";
import { focus, onLaptop, onPhone, open, where } from "./helpers";

/*
 * The acid machine: a sound of its own for the bass and the melody, with a
 * filter on the pad, its own bite and decay, slides one can see, and the
 * filter ride.
 */

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("puts the acid machine on the bass: filter on the sound pad, bite, duration, wave", async ({ page }) => {
    const problems = await open(page);
    const track = (ring: number) => page.evaluate((index) => window.kreisel.app.project.tracks[index]!, ring);
    const group = page.locator("#acid");
    const machine = page.locator("#palette-machine");

    // The machine is one more sound under the palette's fifty, for the bass and the melody only.
    await focus(page, 5);
    await page.locator("#sound-pick").click();
    await expect(page.locator("#palette")).toBeVisible();
    await expect(machine).toBeHidden();
    await focus(page, 6);
    await expect(machine).toBeVisible();
    await focus(page, 4);
    await expect(machine).toBeVisible();
    await expect(machine).toHaveAttribute("aria-pressed", "false");
    await expect(group).toBeHidden();
    await expect(page.locator("#palette .chip")).toHaveCount(50);
    await machine.click();
    await expect(machine).toHaveAttribute("aria-pressed", "true");
    expect(await track(4)).toMatchObject({ sound: 53, acid: { bite: 0.6, decay: 0.35, square: false }, x: 0.45, y: 0.65 });
    await page.locator("#palette-done").click();

    // The ring's panel says what it plays; the pad is the filter, and under it is the machine's own group.
    await expect(page.locator("#sound-pick")).toContainText("Acid 303");
    await expect(page.locator("#sound-pick")).toContainText("Machine");
    await expect(group).toBeVisible();
    await expect(page.locator(".pad .axis.x")).toHaveText("Filter →");
    await expect(page.locator(".pad .axis.y")).toHaveText("Resonance ↑");
    // Everything is still in view on this screen, and the group's rows do not lie over each other.
    expect(await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      const mix = document.getElementById("drive-row")!.getBoundingClientRect();
      const acid = document.getElementById("acid")!.getBoundingClientRect();
      return panel.scrollHeight - panel.clientHeight <= 2 && mix.bottom <= panel.getBoundingClientRect().bottom && acid.height > 50;
    })).toBe(true);

    await page.locator("#acid-bite").fill("90");
    await page.locator("#acid-decay").fill("10");
    expect((await track(4)).acid).toEqual({ bite: 0.9, decay: 0.1, square: false });
    await page.locator("#acid-bite").click({ button: "right" });
    expect((await track(4)).acid?.bite).toBe(0.6);
    await group.getByRole("button", { name: "Square" }).click();
    expect((await track(4)).acid?.square).toBe(true);
    await expect(group.getByRole("button", { name: "Square" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "Saw" })).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Control+z");
    expect((await track(4)).acid?.square).toBe(false);

    // Another sound: the group goes, the pad is the sound's again, and the machine keeps its settings for when it comes back.
    await page.evaluate(() => window.kreisel.app.rings.setSound(4, 2));
    await expect(group).toBeHidden();
    await expect(page.locator(".pad .axis.x")).toHaveText("Brightness →");
    expect((await track(4)).acid).toEqual({ bite: 0.6, decay: 0.1, square: false });
    await page.evaluate(() => window.kreisel.app.acid.use());
    await expect(group).toBeVisible();
    expect((await track(4)).acid?.decay).toBe(0.1);

    // The techno Kreisel's bass has so many hits that the line telling of them takes two rows: the panel still holds everything.
    await page.evaluate(() => { window.plainTechno(); window.kreisel.app.select(4); });
    await expect(group).toBeVisible();
    await expect(page.locator(".panel-ring .info")).toContainText("11 hits");
    expect(await page.evaluate(() => {
      const panel = document.getElementById("panel")!;
      return panel.scrollHeight <= panel.clientHeight && document.getElementById("drive-row")!.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom;
    })).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("slides a note into the next and lays the filter ride", async ({ page }) => {
    const problems = await open(page);
    const steps = () => page.evaluate(() => window.kreisel.app.project.scenes[0]!.patterns[4]!.steps.slice(0, 16).map((step) => (step.on ? [step.pitch, step.len] : null)));
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.select(4);
      app.acid.use();
      app.rings.clear(4);
      app.rings.addNote(4, 2, { pitch: 0 }, "probe");
      app.rings.addNote(4, 5, { pitch: 7 }, "probe");
      app.endGesture();
    });
    await focus(page, 4);
    expect((await steps())[2]).toEqual([0, 1]);
    expect(await page.evaluate(() => window.kreisel.app.acid.tied(4, 2))).toBe(false);

    // The hit's menu ties it into the next: it is then as long as it takes to reach into it (three steps away, so four long).
    const hit = await where(page, 4, 2);
    await page.mouse.click(hit.x, hit.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu).toContainText("Into the next");
    const pull = menu.getByRole("menuitemradio", { name: /Hold the note into the next one/ });
    await expect(pull).toHaveAttribute("aria-checked", "false");
    await pull.click();
    expect((await steps())[2]).toEqual([0, 4]);
    expect(await page.evaluate(() => window.kreisel.app.acid.tied(4, 2))).toBe(true);
    await expect(pull).toHaveAttribute("aria-checked", "true");
    // Once more lets go of it: it ends where the next begins.
    await pull.click();
    expect((await steps())[2]).toEqual([0, 3]);
    expect(await page.evaluate(() => window.kreisel.app.acid.tied(4, 2))).toBe(false);
    await page.keyboard.press("Escape");
    // The last note has the first for its next one, round the ring.
    await page.evaluate(() => window.kreisel.app.acid.tie(4, 5));
    expect((await steps())[5]).toEqual([7, 14]);

    // The filter ride: a hill of sun over the ring, and a wind that carries it round once in sixteen bars.
    await page.locator("#acid-ride").click();
    await expect(page.locator("#toast")).toContainText("Filter ride");
    const sky = await page.evaluate(() => {
      const scene = window.kreisel.app.project.scenes[0]!;
      return { sun: scene.weather[1]![4]!.slice(0, 16), wind: scene.wind[1], others: scene.weather[1]!.filter((_, ring) => ring !== 4).every((line) => line.every((value) => value === 0)) };
    });
    expect(sky.sun[0]).toBe(0);
    expect(sky.sun[8]).toBeGreaterThanOrEqual(12);
    expect(Math.max(...sky.sun)).toBe(sky.sun[8]);
    expect([sky.wind, sky.others]).toEqual([4, true]);
    await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
    expect(await page.evaluate(() => window.kreisel.app.project.scenes[0]!.weather[1]![4]!.every((value) => value === 0))).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lets the machine be heard: filter, accent, glide, and room for the rumble", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page);
    /** The machine alone on the bass ring of the techno Kreisel, not driven and not pressed, with `setup` applied; rendered and measured. */
    const hear = (setup: string) => page.evaluate(async (code) => {
      const app = window.kreisel.app;
      window.plainTechno();
      app.setGlobal({ pressure: 0 });
      for (let ring = 0; ring < 7; ring += 1) app.rings.setTrack(ring, { mute: ring !== 4, drive: 0 });
      app.select(4);
      new Function("app", code)(app);
      return window.kreisel.whole();
    }, setup);
    const dB = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);

    const plain = await hear("");
    expect(plain.peak).toBeGreaterThan(0.05);
    expect(plain.peak).toBeLessThanOrEqual(0.99);
    // The pad is the filter: further right it is brighter.
    const shut = await hear("app.rings.setTrack(4, { x: 0.1 });");
    const wide = await hear("app.rings.setTrack(4, { x: 0.9 });");
    expect(wide.sharp).toBeGreaterThan(shut.sharp * 1.5);
    // And about as loud, wherever the filter stands: within some 2 dB in Chromium and 4 dB in Firefox, whose saw has less in its overtones.
    expect(Math.abs(dB(wide, shut))).toBeLessThan(5.5);
    // More bite opens the filter further at every note.
    const tame = await hear("app.acid.shape({ bite: 0 });");
    const biting = await hear("app.acid.shape({ bite: 1 });");
    expect(biting.sharp).toBeGreaterThan(tame.sharp * 1.2);
    // Accents are louder than plain notes: the same line with none is quieter.
    const flat = await hear("for (const step of app.project.scenes[0].patterns[4].steps) if (step.on) app.rings.setStep(4, app.project.scenes[0].patterns[4].steps.indexOf(step), { vel: 1 });");
    expect(dB(plain, flat)).toBeGreaterThan(0.3);
    // A square is another wave, and about as loud.
    const square = await hear("app.acid.shape({ square: true });");
    expect(Math.abs(dB(square, plain))).toBeLessThan(4);
    expect(Math.abs(square.sharp - plain.sharp)).toBeGreaterThan(1);

    // Where the ground shakes, the machine leaves the deep lows to it. (The kick is silent here, not muted: its Nachbeben counts.)
    const low = "for (let ring = 0; ring < 7; ring += 1) app.rings.setTrack(ring, { mute: ring !== 4 && ring !== 0 }); app.rings.setTrack(0, { level: 0 }); for (const step of app.project.scenes[0].patterns[4].steps) step.pitch = step.pitch === 14 ? 7 : step.pitch === 8 ? 1 : 0;";
    const thinned = await hear(low);
    const full = await hear(`${low} app.rumble.shape(-1);`);
    expect(full.deep).toBeGreaterThan(thinned.deep * 1.5);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("puts the acid machine on the melody on a phone, and everything fits the width", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => { window.kreisel.app.select(6); window.kreisel.app.acid.use(); });
    const group = page.locator("#acid");
    await group.scrollIntoViewIfNeeded();
    await expect(group).toBeVisible();
    await page.locator("#acid-bite").fill("80");
    await group.getByRole("button", { name: "Square" }).tap();
    expect(await page.evaluate(() => window.kreisel.app.project.tracks[6]!)).toMatchObject({ sound: 53, acid: { bite: 0.8, square: true } });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

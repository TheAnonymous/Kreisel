import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { heard, onLaptop, onPhone, open, soundOf, state, status, voiceOf, where } from "./helpers";

/*
 * Stimme: a ring that sings a typed line, a syllable a hit.
 */

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("gibt einem Ring eine Stimme", async ({ page }) => {
    const problems = await open(page);
    const booth = page.locator("#booth");
    const line = page.locator("#voice-text");
    const chips = page.locator("#voice-syllables .syllable");
    await page.keyboard.press("7");
    await page.locator("#voice-edit").click();
    await expect(booth).toBeVisible();
    await expect(page.locator("#booth-title")).toHaveText("Stimme: Melodie");
    await expect(status(page)).toContainText("Stimme Melodie:");
    // A ring without a voice gets a first line to sing, and sings from then on; the line is ready to be typed over.
    expect((await voiceOf(page, 6))!.text).not.toBe("");
    expect(await soundOf(page, 6)).toBe(6);
    await expect(page.locator(".track.selected .sound")).toHaveText("Stimme");
    await expect(line).toBeFocused();

    // The line is cut into syllables as it is typed; typing plays nothing.
    await page.keyboard.type("Kaffeepause jetzt");
    await expect(chips).toHaveText(["Kaf", "fee", "pau", "se", "jetzt"]);
    await expect(status(page)).toHaveText("Stimme Melodie: „Kaf·fee·pau·se jetzt“, 5 Silben");
    await expect(page.locator("#voice-pick")).toContainText("Stimme: Kaffeepause jetzt");
    expect(await page.evaluate(() => window.kreisel.app.playing)).toBe(false);
    // A hyphen cuts where it stands; what is no letter is not sung, and does not stay in the line.
    await line.fill("Kre-i-sel 123!");
    await expect(chips).toHaveText(["Kre", "i", "sel"]);
    await expect(line).toHaveValue("Kre-i-sel ");
    await line.fill("Kaffeepause jetzt");

    // Enter sings the line once: it is heard, and the syllable that is being sung lights up.
    await line.press("Enter");
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);
    await expect(page.locator("#voice-syllables .syllable.sung")).toHaveCount(1);
    await expect(page.locator("#voice-syllables .syllable.sung")).toHaveCount(0);
    // A click on a syllable sings that one.
    await chips.nth(2).click();
    await expect(chips.nth(2)).toHaveClass(/sung/);

    // The room in the mouth and the breath; dicing gives another line, as one step back.
    await page.locator("#voice-mouth").fill("90");
    await page.locator("#voice-breath").fill("60");
    expect(await voiceOf(page, 6)).toEqual({ text: "Kaffeepause jetzt", mouth: 0.9, breath: 0.6 });
    await page.locator("#booth-dice").click();
    await expect(line).not.toHaveValue("Kaffeepause jetzt");
    expect((await voiceOf(page, 6))!.text).not.toBe("Kaffeepause jetzt");
    await page.keyboard.press("Control+z");
    await expect(line).toHaveValue("Kaffeepause jetzt");

    // Escape puts the window away; the sound pad is now the field of the vowels.
    await page.keyboard.press("Escape");
    await expect(booth).toBeHidden();
    const letters = page.locator(".panel-ring .vowels i");
    await expect(letters).toHaveText(["i", "e", "a", "o", "u"]);
    await expect(letters.first()).toBeVisible();
    // In the ring's field the voice is one of its sounds: picked with a click, written further with the next.
    const pick = page.locator("#voice-pick");
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await page.locator(".panel-ring .chips .chip").nth(1).click();
    expect(await soundOf(page, 6)).toBe(1);
    await expect(letters.first()).toBeHidden();
    await pick.click();
    expect(await soundOf(page, 6)).toBe(6);
    await expect(booth).toBeHidden();
    await pick.click();
    await expect(booth).toBeVisible();
    await page.locator("#booth-done").click();
    await expect(booth).toBeHidden();

    // The ring sings, a syllable a hit, and the mouth in the hub forms the vowels.
    await page.evaluate(() => window.kreisel.app.rings.toggleSolo(6));
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.level()), { timeout: 8000 }).toBeGreaterThan(0.04);
    await expect.poll(() => page.evaluate(() => window.kreisel.app.voice.mouth() !== null)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.kreisel.app.engine.sung[6] ?? 0), { timeout: 8000 }).toBeGreaterThan(5);
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.voice.mouth()), { timeout: 4000 }).toBeNull();

    // The right button on another ring leads to its voice; a ring that has no line yet has none to take.
    const kick = await where(page, 0, 2);
    await page.mouse.click(kick.x, kick.y, { button: "right" });
    const menu = page.locator("#context");
    await expect(menu.getByRole("menuitemradio", { name: "Noch keine Zeile geschrieben" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Die Zeile schreiben, die dieser Ring singt" }).click();
    await expect(booth).toBeVisible();
    await expect(page.locator("#booth-title")).toHaveText("Stimme: Kick");
    expect(await soundOf(page, 0)).toBe(6);
    // Taken back, the voice is gone, and its window with it.
    await page.evaluate(() => window.kreisel.app.undo());
    await expect(booth).toBeHidden();
    expect(await voiceOf(page, 0)).toBeNull();
    expect(await soundOf(page, 0)).toBe(0);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lässt die Stimme hören: Silbe für Silbe, und ein a ist kein i", async ({ page }) => {
    const problems = await open(page);
    /**
     * Saves the scene with only the bass heard, singing `text` on two long notes a bar, and listens to the file:
     * how much of each of the first four notes lies around the first frequency, against around the second.
     */
    const listen = async (text: string, hz: readonly [number, number], shape: { mouth?: number; x?: number; y?: number } = {}): Promise<number[]> => {
      await page.evaluate(([line, mouth, x, y]) => {
        const app = window.kreisel.app;
        app.store.edit((project) => {
          project.bpm = 150;
          project.pump = 0;
          project.swing = 0;
          project.tracks.forEach((track, index) => {
            track.mute = index !== 4;
            track.hall = 0;
            track.echo = 0;
          });
          Object.assign(project.tracks[4]!, { x, y, sound: 6, voice: { text: line, mouth, breath: 0 } });
          const pattern = project.scenes[0]!.patterns[4]!;
          pattern.len = 16;
          pattern.steps.forEach((step, index) => Object.assign(step, { on: index === 0 || index === 8, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 6 }));
        });
        app.dismiss();
      }, [text, shape.mouth ?? 0.5, shape.x ?? 0.5, shape.y ?? 0.5] as const);
      await page.locator("#more").click();
      const rendered = page.waitForEvent("download");
      await page.locator("#menu").getByText("Als Opus speichern").click();
      const bytes = readFileSync(await (await rendered).path());
      return page.evaluate(async ([data, first, second]) => {
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(Uint8Array.from(data as number[]).buffer);
        await context.close();
        const samples = buffer.getChannelData(0);
        const rate = buffer.sampleRate;
        const at = (steps: number): number => Math.min(samples.length, Math.round((0.05 + steps * 0.1) * rate));
        // How much sound lies around a frequency in a stretch: a row of narrow listeners, 200 Hz to either side,
        // standing so close that no overtone slips through between two of them.
        const around = (middle: number, from: number, to: number): number => {
          let sum = 0;
          const stride = rate / (to - from);
          for (let frequency = middle - 200; frequency <= middle + 200; frequency += stride) {
            const turn = 2 * Math.cos((2 * Math.PI * frequency) / rate);
            let last = 0;
            let before = 0;
            for (let index = from; index < to; index += 1) {
              const next = (samples[index] ?? 0) + turn * last - before;
              before = last;
              last = next;
            }
            sum += last * last + before * before - turn * last * before;
          }
          return sum;
        };
        // The notes begin on steps 0, 8, 16 and 24 and are held for six steps: the four steps in their middle.
        return [0, 8, 16, 24].map((step) => around(first as number, at(step + 1), at(step + 5)) / (around(second as number, at(step + 1), at(step + 5)) + 1e-12));
      }, [[...bytes], hz[0], hz[1]] as const);
    };

    // An a rings around 1250 Hz, an i around 2250 Hz. Three syllables on two notes a bar: every note sings the
    // next one, and the line goes on where the bar before left off.
    const aai = await listen("a a i", [1250, 2250]);
    expect(aai[0]).toBeGreaterThan(3);
    expect(aai[1]).toBeGreaterThan(3);
    expect(aai[2]).toBeLessThan(1 / 3);
    expect(aai[3]).toBeGreaterThan(3);
    // The sound pad pulls every vowel to its place: an a with the point on the i is an i.
    const pulled = await listen("a", [1250, 2250], { x: 0.05, y: 0.95 });
    for (const note of pulled) expect(note).toBeLessThan(1 / 3);
    // A small mouth is brighter than a big one: the i's ring sits higher.
    const small = await listen("i", [2745, 1845], { mouth: 0 });
    const big = await listen("i", [2745, 1845], { mouth: 1 });
    expect(small[0]).toBeGreaterThan(big[0]! * 6);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("nimmt die Stimme im Link und in der Datei mit", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const problems = await open(page);
    // Only the kick is heard, and it sings.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.setGlobal({ bpm: 180 });
      for (let track = 1; track < 7; track += 1) app.rings.setTrack(track, { mute: true });
      app.select(0);
      app.voice.open();
      app.voice.shape({ text: "Bumm-tschak geht's", mouth: 0.8, breath: 0.3 });
      app.voice.close();
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
    expect(await voiceOf(other, 0)).toEqual({ text: "Bumm-tschak geht's", mouth: 0.8, breath: 0.3 });
    expect(await soundOf(other, 0)).toBe(6);
    await expect(other.locator(".track").filter({ hasText: "Kick" }).locator(".sound")).toHaveText("Stimme");

    // The saved file holds the voice.
    await other.locator("#more").click();
    const rendered = other.waitForEvent("download");
    await other.locator("#menu").getByText("Als Opus speichern").click();
    const file = await heard(other, await rendered);
    expect(file.peak).toBeGreaterThan(0.1);
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("gibt am Handy einem Ring eine Stimme: das Fenster passt, die Tastatur bleibt unten", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.kreisel.app.select(3));
    await page.locator("#voice-edit").tap();
    await expect(page.locator("#booth")).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    // The line waits to be tapped: no keyboard jumps up over the window.
    await expect(page.locator("#voice-text")).not.toBeFocused();
    await page.locator("#voice-text").fill("Oh ja");
    await expect(page.locator("#voice-syllables .syllable")).toHaveText(["Oh", "ja"]);
    expect((await page.locator("#mund").boundingBox())!.height).toBeGreaterThan(80);
    await page.locator("#voice-sing").tap();
    await expect.poll(() => page.evaluate(() => window.kreisel.level())).toBeGreaterThan(0.02);
    await page.locator("#voice-syllables .syllable").nth(1).tap();
    await page.locator("#booth-done").tap();
    await expect(page.locator("#booth")).toBeHidden();
    expect(await soundOf(page, 3)).toBe(6);
    expect(await voiceOf(page, 3)).toEqual({ text: "Oh ja", mouth: 0.5, breath: 0.15 });
    await expect(page.locator(".panel-ring .vowels i").first()).toBeVisible();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

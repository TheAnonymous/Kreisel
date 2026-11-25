import { expect, test, type Page } from "@playwright/test";
import type { Pedals } from "../src/model";
import { CHAINS } from "../src/pedals";
import { focus, onLaptop, onPhone, open, state, where } from "./helpers";

/*
 * A ring's pedals: the character of its Drive, the crusher, a phaser, flanger
 * or chorus whose sweep has its top on a step of the ring, and whether reverb
 * and echo come before the drive or after it. Each ring has five ready chains
 * that put these together. And beside the wheel stand the three effects of a
 * DJ's mixer, held like the six before them: Wash, Jet, Crush.
 *
 * What they do to the sound is measured on a ring by itself, rendered faster
 * than it plays.
 */

const NAMES = ["Kick", "Snare", "Hi-Hat", "Drum", "Bass", "Chords", "Melody"] as const;

const trackOf = (page: Page, ring: number) => page.evaluate((index) => window.kreisel.app.project.tracks[index]!, ring);
/** A ring's pedals; `null` while nothing on its board is on. */
const pedalsOf = (page: Page, ring: number): Promise<Pedals | null> => page.evaluate((index) => window.kreisel.app.project.tracks[index]!.pedals ?? null, ring);
/** Which of its chains the ring in focus wears; −1 for none of them. */
const worn = (page: Page): Promise<number> => page.evaluate(() => window.kreisel.app.pedals.worn);
const dB = (after: { loud: number }, before: { loud: number }): number => 20 * Math.log10(after.loud / before.loud);

/** Puts a ring in focus and turns its panel over to its pedals. */
async function turnOver(page: Page, ring: number): Promise<void> {
  await focus(page, ring);
  if (await page.locator("#pedals").isHidden()) await page.locator("#pedals-open").click();
  await expect(page.locator("#pedals-title")).toHaveText(`${NAMES[ring]}: pedals`);
}

/** One of a group's choices on the board, by its name. */
const choice = (page: Page, group: string, name: string) => page.locator(`#${group}`).getByRole("radio", { name, exact: true });

/** Which of a group's choices is taken, and where the Tab key stops in it: the same single place in both. */
const taken = (page: Page, group: string): Promise<{ checked: number[]; stops: number[] }> =>
  page.locator(`#${group} [role=radio]`).evaluateAll((nodes) => ({
    checked: nodes.flatMap((node, index) => (node.getAttribute("aria-checked") === "true" ? [index] : [])),
    stops: nodes.flatMap((node, index) => ((node as HTMLElement).tabIndex === 0 ? [index] : [])),
  }));

/** The chain as the board shows it: the pills for the eye, and the sentence for a screen reader. */
const chainOf = async (page: Page): Promise<{ pills: string[]; said: string | null }> => ({
  pills: await page.locator("#pedal-chain .station").allTextContents(),
  said: await page.locator("#pedal-chain .sr").textContent(),
});

/** What a ring is given before it is heard: its drive, its reverb and echo, and what is on its board. */
interface Wear {
  drive?: number;
  hall?: number;
  echo?: number;
  pedals?: Partial<Pedals>;
}

/**
 * One ring of the plain techno Kreisel by itself and not pressed, wearing `wear`: rendered faster than it plays and
 * measured. With `sixteenths`, also how loud each sixteenth of its two bars is; with `low`, the bass plays its line
 * an octave down.
 */
const hear = (page: Page, ring: number, wear: Wear = {}, also: { sixteenths?: boolean; low?: boolean } = {}) =>
  page.evaluate(async ([only, { pedals, ...mix }, { sixteenths, low }]) => {
    const app = window.kreisel.app;
    window.plainTechno();
    app.setGlobal({ pressure: 0 });
    for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== only });
    app.select(only);
    if (low) app.store.touch((project) => { for (const step of project.scenes[0]!.patterns[4]!.steps) step.pitch = step.pitch === 14 ? 7 : step.pitch === 8 ? 1 : 0; });
    app.rings.setTrack(only, mix);
    if (pedals) app.pedals.set(pedals);
    const whole = await window.kreisel.whole();
    return { ...whole, sixteenths: sixteenths ? (await window.kreisel.beats(4)).slice(0, 32).map((beat) => beat.loud) : [] };
  }, [ring, wear, also] as const);

/**
 * The hi-hat alone with the same closed hit on every step (its own pattern leaves the kick's steps out and opens on
 * the off-beats), wearing `pedals`: how sharp each sixteenth of `bars` bars is. Whatever differs from one sixteenth to
 * the next is then the sweep. With `twelve`, its ring has twelve steps and the rings are realigned every eight bars.
 */
const hats = (page: Page, pedals: Partial<Pedals> | null, bars = 4, twelve = false): Promise<number[]> =>
  page.evaluate(async ([board, count, short]) => {
    const app = window.kreisel.app;
    window.plainTechno();
    app.setGlobal({ pressure: 0 });
    // A scene is rendered twice through its chords: half as many chords as bars.
    app.chords.setBars(count / 2);
    for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== 2 });
    app.select(2);
    if (short) app.rings.resize(2, 12);
    app.store.touch((project) => {
      for (const step of project.scenes[0]!.patterns[2]!.steps.slice(0, 16)) Object.assign(step, { on: true, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 1 });
      if (short) project.align = true;
    });
    if (board) app.pedals.set(board);
    return (await window.kreisel.beats(4)).slice(0, count * 16).map((beat) => beat.sharp);
  }, [pedals, bars, twelve] as const);

/** The most two rows of numbers lie apart at any one place. */
const apart = (one: number[], other: number[]): number => Math.max(...one.map((value, index) => Math.abs(value - (other[index] ?? 0))));
/** A round of numbers turned on by `by` places. */
const turned = (round: number[], by: number): number[] => round.map((_, index) => round[(index - by + round.length) % round.length] ?? 0);
const spread = (row: number[]): number => Math.max(...row) - Math.min(...row);

test.describe("on a laptop", () => {
  test.skip(onPhone, "mouse and keyboard");

  test("turns a ring's panel over to its pedals by button and by key, on every ring but the kick", async ({ page }) => {
    const problems = await open(page);
    const opener = page.locator("#pedals-open");
    const board = page.locator("#pedals");
    const ringPanel = page.locator(".panel-ring");
    const title = page.locator("#pedals-title");
    const wheel = page.locator("#kreisel");
    const lit = /(^| )on( |$)/;

    // The kick is made hard by a chain of its own: it has no such button, and the key does nothing.
    await focus(page, 0);
    await expect(opener).toBeHidden();
    await page.keyboard.press("KeyY");
    await expect(board).toBeHidden();
    expect(await page.evaluate(() => window.kreisel.app.pedals.open)).toBe(false);
    // Every other ring has the button, in a row with its Drive.
    for (let ring = 1; ring < 7; ring += 1) {
      await page.evaluate((track) => window.kreisel.app.select(track), ring);
      await expect(opener).toBeVisible();
      expect(await page.evaluate(() => {
        const drive = document.getElementById("drive-row")!.getBoundingClientRect();
        const button = document.getElementById("pedals-open")!.getBoundingClientRect();
        const middle = (button.top + button.bottom) / 2;
        return middle > drive.top && middle < drive.bottom && button.left >= drive.right - 1;
      })).toBe(true);
    }

    // Its name is "Pedals" and nothing else. What the ring wears is its description, and its lamp is lit while the
    // ring is driven or has a pedal on: reverb and echo alone are no pedals.
    await page.evaluate(() => window.kreisel.app.rings.setTrack(6, { drive: 0, hall: 0, echo: 0 }));
    await expect(opener).toHaveAccessibleName("Pedals");
    await expect(opener).toHaveAccessibleDescription("Chain: nothing in its way.");
    await expect(opener).toHaveAttribute("aria-controls", "pedals");
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener).not.toHaveClass(lit);
    await page.evaluate(() => window.kreisel.app.rings.setTrack(6, { echo: 0.3 }));
    await expect(opener).toHaveAccessibleDescription("Chain: Echo.");
    await expect(opener).not.toHaveClass(lit);
    await page.evaluate(() => {
      window.kreisel.app.rings.setTrack(6, { drive: 0.5 });
      window.kreisel.app.pedals.set({ tone: 1 });
    });
    await expect(opener).toHaveAccessibleName("Pedals");
    await expect(opener).toHaveAccessibleDescription("Chain: Distortion, then Echo.");
    await expect(opener).toHaveClass(lit);

    // The button turns the panel over. The focus goes to the board's heading, not to a button: the space bar still starts and stops.
    await opener.click();
    await expect(board).toBeVisible();
    await expect(ringPanel).toBeHidden();
    await expect(title).toHaveText("Melody: pedals");
    await expect(title).toBeFocused();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await expect(board).toBeVisible();
    // Escape turns it back, and the focus is on the button it came from.
    await page.keyboard.press("Escape");
    await expect(board).toBeHidden();
    await expect(ringPanel).toBeVisible();
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener).toBeFocused();
    // So does the board's own button.
    await opener.click();
    await expect(title).toBeFocused();
    await expect(page.locator("#pedals-done")).toHaveText("‹ Ring");
    await page.locator("#pedals-done").click();
    await expect(board).toBeHidden();
    await expect(opener).toBeFocused();

    // The key between T and U does the same from the wheel, there and back, and the wheel has the focus again.
    await wheel.focus();
    await page.keyboard.press("KeyY");
    await expect(board).toBeVisible();
    await expect(title).toBeFocused();
    await page.keyboard.press("KeyY");
    await expect(board).toBeHidden();
    await expect(wheel).toBeFocused();
    await page.keyboard.press("KeyY");
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(board).toBeHidden();
    await expect(wheel).toBeFocused();

    // The board stays while another ring is picked, and shows that ring's pedals.
    await page.keyboard.press("KeyY");
    await page.keyboard.press("Digit5");
    await expect(board).toBeVisible();
    await expect(title).toHaveText("Bass: pedals");
    await page.keyboard.press("Digit3");
    await expect(title).toHaveText("Hi-Hat: pedals");
    // The kick has none: its own panel shows, and the focus is not left on something hidden. Back on another ring, the board is there again.
    await page.keyboard.press("Digit1");
    await expect(board).toBeHidden();
    await expect(ringPanel).toBeVisible();
    await expect(ringPanel.locator("h2")).toHaveText("Kick");
    await expect(wheel).toBeFocused();
    await page.keyboard.press("Digit5");
    await expect(board).toBeVisible();
    await expect(title).toHaveText("Bass: pedals");
    await page.keyboard.press("Escape");
    await expect(board).toBeHidden();

    // Opened by its button, the board has that button to give the focus back to. Where the button is gone with the
    // ring's panel (the kick, the piece, the weather are picked), the wheel gets it: never something hidden.
    for (const elsewhere of ["Digit1", "Digit8", "Digit9"]) {
      await page.keyboard.press("Digit5");
      await opener.click();
      await expect(title).toBeFocused();
      await page.keyboard.press(elsewhere);
      await expect(board).toBeHidden();
      expect(await page.evaluate(() => {
        const focused = document.activeElement;
        return focused !== null && focused !== document.body && focused.getClientRects().length > 0;
      })).toBe(true);
      await expect(wheel).toBeFocused();
      // (Behind the kick's panel the board is still open, and would be back with the next ring: away with it.)
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => window.kreisel.app.pedals.open)).toBe(false);
    }

    // While the piece's ring is in focus the key does nothing: no board lies in wait for the next ring that is picked.
    await page.evaluate(() => window.kreisel.app.piece.focus());
    await page.keyboard.press("KeyY");
    expect(await page.evaluate(() => window.kreisel.app.pedals.open)).toBe(false);
    await page.keyboard.press("Digit5");
    await expect(ringPanel).toBeVisible();
    await expect(board).toBeHidden();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("holds the whole board on this screen: the panel does not scroll, for any ring, with a phaser on", async ({ page }) => {
    const problems = await open(page);
    // On the factory Kreisel, and on the techno one, whose rings are all driven and have reverb or echo: their chains are longer.
    const scrolling: string[] = [];
    for (const kreisel of ["factory", "techno"]) {
      if (kreisel === "techno") await page.evaluate(() => window.plainTechno());
      await turnOver(page, 1);
      for (let ring = 1; ring < 7; ring += 1) {
        await page.evaluate((track) => {
          window.kreisel.app.select(track);
          window.kreisel.app.pedals.set({ mod: 1 });
        }, ring);
        // A phaser sweeps: all the rows of the modulation show.
        await expect(page.locator("#pedals-title")).toHaveText(`${NAMES[ring]}: pedals`);
        await expect(page.locator("#pedal-depth")).toBeVisible();
        await expect(page.locator("#pedal-crest-row")).toBeVisible();
        await expect(page.locator("#pedal-span-row")).toBeVisible();
        const over = await page.evaluate(() => {
          const panel = document.getElementById("panel")!;
          return panel.scrollHeight - panel.clientHeight;
        });
        if (over > 2) scrolling.push(`${kreisel} Kreisel, ${NAMES[ring]}: ${over} px too tall`);
      }
    }
    expect(scrolling).toEqual([]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("steps through the drive's characters with the arrow keys: each is one step back and travels with the Kreisel", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await turnOver(page, 4);
    const group = page.locator("#pedal-tones");
    const tones = group.getByRole("radio");

    // Five characters, from mild to harsh, as one group with one stop for the Tab key. A ring starts warm, as a Kreisel always drove.
    await expect(group).toHaveAttribute("role", "radiogroup");
    await expect(group).toHaveAccessibleName("Character of the drive");
    await expect(tones).toHaveText(["Warm", "Distortion", "Fuzz", "Clip", "Scream"]);
    expect(await taken(page, "pedal-tones")).toEqual({ checked: [0], stops: [0] });
    expect(await pedalsOf(page, 4)).toBeNull();

    // The arrow keys move the focus and take the choice at once: stepping through them is hearing them.
    await choice(page, "pedal-tones", "Warm").focus();
    for (const [tone, name] of [[1, "Distortion"], [2, "Fuzz"], [3, "Clip"], [4, "Scream"]] as const) {
      await page.keyboard.press("ArrowRight");
      await expect(choice(page, "pedal-tones", name)).toBeFocused();
      expect(await pedalsOf(page, 4)).toEqual({ tone, crush: 0, mod: 0, depth: 0.4, crest: 0, span: 2, first: 0 });
      expect(await taken(page, "pedal-tones")).toEqual({ checked: [tone], stops: [tone] });
      // The chain's line calls the drive by its character.
      expect((await chainOf(page)).pills).toEqual([name, "Echo"]);
    }
    await expect(page.locator("#pedal-chain .station.drive")).toHaveText("Scream");
    // Round the end it is warm again: nothing on the board is on, and the ring has no pedals.
    await page.keyboard.press("ArrowRight");
    await expect(choice(page, "pedal-tones", "Warm")).toBeFocused();
    expect(await pedalsOf(page, 4)).toBeNull();
    expect((await chainOf(page)).pills).toEqual(["Drive", "Echo"]);
    // Backwards, and with the arrows up and down as well. The pointer on the wheel is not moved by any of them.
    await page.keyboard.press("ArrowLeft");
    expect((await pedalsOf(page, 4))?.tone).toBe(4);
    await page.keyboard.press("ArrowUp");
    expect((await pedalsOf(page, 4))?.tone).toBe(3);
    await page.keyboard.press("ArrowDown");
    expect((await pedalsOf(page, 4))?.tone).toBe(4);
    expect(await page.evaluate(() => window.kreisel.app.keyCursor)).toBeNull();

    // Each choice is one step back.
    await page.keyboard.press("Control+z");
    expect((await pedalsOf(page, 4))?.tone).toBe(3);
    expect(await taken(page, "pedal-tones")).toEqual({ checked: [3], stops: [3] });
    await page.keyboard.press("Control+Shift+z");
    expect((await pedalsOf(page, 4))?.tone).toBe(4);
    // A click takes one as well.
    await choice(page, "pedal-tones", "Distortion").click();
    expect((await pedalsOf(page, 4))?.tone).toBe(1);
    expect(await taken(page, "pedal-tones")).toEqual({ checked: [1], stops: [1] });

    // The Kreisel carries the pedals as seven small numbers after everything else a ring has; a ring without pedals ends before.
    const packed = JSON.parse(await state(page)) as { t: (number | string)[][] };
    expect(packed.t[4]?.[12]).toBe("1.0.0.40.0.2.0");
    expect(packed.t[5]?.[12]).toBeUndefined();
    // And the browser keeps them: they are there again after a reload.
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    await expect(page.locator("#status")).toContainText("Melody");
    expect(await pedalsOf(page, 4)).toEqual({ tone: 1, crush: 0, mod: 0, depth: 0.4, crest: 0, span: 2, first: 0 });
    expect(await pedalsOf(page, 5)).toBeNull();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("gives each character a sound of its own, about as loud as the warm one", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    // The techno Kreisel's acid line by itself, driven a good half, with each character in turn.
    const wearing = (tone: number, low = false) => hear(page, 4, { drive: 0.6, pedals: { tone } }, { low });
    const warm = await wearing(0);
    const distortion = await wearing(1);
    const fuzz = await wearing(2);
    const clip = await wearing(3);
    const scream = await wearing(4);
    expect(warm.peak).toBeLessThanOrEqual(1);
    for (const [name, heard] of [["Distortion", distortion], ["Fuzz", fuzz], ["Clip", clip], ["Scream", scream]] as const) {
      // A character changes how the ring sounds, not how loud it is: within 1 dB of the warm one in Chromium, within 3 dB
      // in Firefox (whose warm drive is the louder one: the warm shaper is oversampled, and each browser makes its own of that).
      expect(Math.abs(dB(heard, warm)), name).toBeLessThan(4);
      expect(heard.peak, name).toBeLessThanOrEqual(1);
      // And it is another sound than the warm one (the least different is the fuzz in Chromium, by 9 %).
      expect(Math.abs(heard.sharp / warm.sharp - 1), name).toBeGreaterThan(0.03);
    }
    // Among themselves the characters are the same in every browser (their shapers are not oversampled): the clipper
    // is the densest and the dullest of the four, the scream the sharpest, by far sharper than the warm one too.
    for (const other of [distortion, fuzz, scream]) {
      expect(clip.crest).toBeLessThan(other.crest);
      expect(clip.sharp).toBeLessThan(other.sharp);
    }
    expect(scream.sharp).toBeGreaterThan(distortion.sharp * 1.05);
    expect(scream.sharp).toBeGreaterThan(warm.sharp * 1.2);

    // The lows, heard where the line has some: an octave down, its ground tone is at 49 Hz. The distortion gives the
    // lows back after it has clipped and keeps most of them (seven to nine tenths of what the warm drive has deep
    // down); the scream cuts them away (half of it is left).
    const deepWarm = await wearing(0, true);
    const deepDistortion = await wearing(1, true);
    const deepScream = await wearing(4, true);
    expect(deepWarm.deep).toBeGreaterThan(0.2);
    expect(deepDistortion.deep).toBeGreaterThan(deepWarm.deep * 0.6);
    expect(deepScream.deep).toBeLessThan(deepWarm.deep * 0.6);
    expect(deepScream.deep).toBeLessThan(deepDistortion.deep * 0.8);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("crushes a ring: the slider says how far in a word, and the sound loses its highs, not its level", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await turnOver(page, 2);
    const slider = page.locator("#pedal-crush");
    const word = page.locator("label", { has: slider }).locator("output");

    // From nothing to broken, in words: for whoever has the slider read out, and beside it for the eye (that one stays silent).
    await expect(slider).toHaveValue("0");
    await expect(slider).toHaveAttribute("aria-valuetext", "off");
    await expect(word).toHaveAttribute("aria-hidden", "true");
    for (const [value, said] of [[5, "light"], [20, "light"], [21, "grainy"], [45, "grainy"], [46, "8-bit"], [70, "8-bit"], [71, "crunchy"], [90, "crunchy"], [91, "broken"], [100, "broken"], [0, "off"]] as const) {
      await slider.fill(String(value));
      await expect(slider).toHaveAttribute("aria-valuetext", said);
      await expect(word).toHaveText(said);
      expect((await pedalsOf(page, 2))?.crush ?? 0).toBe(value / 100);
    }
    // The crusher stands behind the drive in the chain. The right button takes it out again, and the ring has no pedals.
    await slider.fill("50");
    expect(await chainOf(page)).toEqual({ pills: ["Drive", "Crush", "Reverb"], said: "Chain: Drive, then Crush, then Reverb." });
    await slider.click({ button: "right" });
    expect(await pedalsOf(page, 2)).toBeNull();
    await page.keyboard.press("Control+z");
    expect((await pedalsOf(page, 2))?.crush).toBe(0.5);

    // The hi-hat by itself, clean, half crushed and crushed all the way: far fewer samples a second leave far less
    // up high (about a third of its sharpness either way).
    const clean = await hear(page, 2);
    const half = await hear(page, 2, { pedals: { crush: 0.5 } });
    const full = await hear(page, 2, { pedals: { crush: 1 } });
    expect(half.sharp).toBeLessThan(clean.sharp * 0.6);
    expect(full.sharp).toBeLessThan(clean.sharp * 0.6);
    expect(full.bright).toBeLessThan(clean.bright * 0.5);
    // And about as loud as it was, also at the very end: there a hi-hat loses 3 dB in Chromium (little of it lies
    // below the crusher's rate), and gains 2 dB in Firefox, whose hi-hat is quieter to begin with.
    expect(Math.abs(dB(half, clean))).toBeLessThan(4);
    expect(Math.abs(dB(full, clean))).toBeLessThan(4);
    for (const heard of [clean, half, full]) expect(heard.peak).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("shows a modulation's own rows, and says and resets the step its sweep peaks on", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await turnOver(page, 2);
    const depth = page.locator("#pedal-depth");
    const peakRow = page.locator("#pedal-crest-row");
    const peak = page.locator("#pedal-crest");
    const spanRow = page.locator("#pedal-span-row");
    await expect(page.locator("#pedal-mods")).toHaveAccessibleName("Modulation");
    await expect(page.locator("#pedal-mods").getByRole("radio")).toHaveText(["Off", "Phaser", "Flanger", "Chorus"]);

    // Off: no depth, no peak, no rounds.
    expect(await taken(page, "pedal-mods")).toEqual({ checked: [0], stops: [0] });
    await expect(depth).toBeHidden();
    await expect(peakRow).toBeHidden();
    await expect(spanRow).toBeHidden();
    // A phaser sweeps: it has a depth, a peak on the ring, and a number of rounds a sweep takes.
    await choice(page, "pedal-mods", "Phaser").click();
    expect(await pedalsOf(page, 2)).toEqual({ tone: 0, crush: 0, mod: 1, depth: 0.4, crest: 0, span: 2, first: 0 });
    await expect(depth).toBeVisible();
    await expect(depth).toHaveValue("40");
    await expect(depth).toHaveAttribute("aria-valuetext", "40 %");
    await expect(peakRow).toBeVisible();
    await expect(spanRow).toBeVisible();
    expect((await chainOf(page)).pills).toEqual(["Drive", "Phaser", "Reverb"]);
    // A chorus sways by itself: only its depth.
    await choice(page, "pedal-mods", "Chorus").click();
    expect((await pedalsOf(page, 2))?.mod).toBe(3);
    await expect(depth).toBeVisible();
    await expect(peakRow).toBeHidden();
    await expect(spanRow).toBeHidden();
    await choice(page, "pedal-mods", "Flanger").click();
    await expect(peakRow).toBeVisible();
    await expect(spanRow).toBeVisible();
    await depth.fill("75");
    expect((await pedalsOf(page, 2))?.depth).toBe(0.75);

    // How long a sweep takes, in rounds of the ring: short on the chips, in words for a screen reader.
    const spans = page.locator("#pedal-spans");
    await expect(spans).toHaveAccessibleName("One sweep takes");
    await expect(spans.getByRole("radio")).toHaveText(["½", "1", "2", "4", "8"]);
    await expect(spanRow).toContainText("Sweep in");
    await expect(spanRow).toContainText("rounds");
    expect(await spans.getByRole("radio").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual(["half a round", "one round", "two rounds", "four rounds", "eight rounds"]);
    expect(await taken(page, "pedal-spans")).toEqual({ checked: [2], stops: [2] });
    await choice(page, "pedal-spans", "one round").click();
    expect((await pedalsOf(page, 2))?.span).toBe(1);
    await choice(page, "pedal-spans", "one round").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(choice(page, "pedal-spans", "half a round")).toBeFocused();
    expect((await pedalsOf(page, 2))?.span).toBe(0);
    expect(await taken(page, "pedal-spans")).toEqual({ checked: [0], stops: [0] });

    // The peak is a step of the ring: the slider goes round it once and says where it is. The right button puts it back on the first step.
    await expect(peak).toHaveAccessibleName("Sweep peak");
    await expect(peak).toHaveAttribute("max", "15");
    await expect(peak).toHaveAttribute("aria-valuetext", "step 1 of 16");
    await peak.fill("6");
    expect((await pedalsOf(page, 2))?.crest).toBe(6);
    await expect(peak).toHaveAttribute("aria-valuetext", "step 7 of 16");
    await expect(peakRow.locator("output")).toHaveText("step 7");
    await expect(peakRow.locator("output")).toHaveAttribute("aria-hidden", "true");
    await peak.click({ button: "right" });
    expect((await pedalsOf(page, 2))?.crest).toBe(0);
    await expect(peak).toHaveAttribute("aria-valuetext", "step 1 of 16");
    await expect(peak).toHaveValue("0");
    // One step back, and it is on step 7 again.
    await page.keyboard.press("Control+z");
    expect((await pedalsOf(page, 2))?.crest).toBe(6);
    // A ring of twelve steps has twelve places for it.
    await page.evaluate(() => {
      window.kreisel.app.select(3);
      window.kreisel.app.pedals.set({ mod: 1 });
    });
    await expect(peak).toHaveAttribute("max", "11");
    await expect(peak).toHaveAttribute("aria-valuetext", "step 1 of 12");

    // Off again: the rows go, and with nothing else on, so do the ring's pedals.
    await choice(page, "pedal-mods", "Off").click();
    await expect(depth).toBeHidden();
    await expect(peakRow).toBeHidden();
    expect(await pedalsOf(page, 3)).toBeNull();
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("has the pedals in the menu of a ring's step: open them, dice a chain, put the sweep's peak right there", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    const menu = page.locator("#context");
    const row = menu.getByRole("group", { name: "Pedals" });
    const toast = page.locator("#toast");

    // The kick has no pedals, and so no such row in its menu.
    await focus(page, 0);
    let spot = await where(page, 0, 2);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Kick · step 3");
    await expect(row).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // A step of the hi-hat's ring: open, and dice. Nothing sweeps there yet, so there is no peak to put anywhere.
    await focus(page, 2);
    spot = await where(page, 2, 4);
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(menu.locator("header")).toHaveText("Hi-Hat · step 5");
    await expect(row.locator("button")).toHaveText(["Open …", "Dice"]);
    await expect(row.getByRole("menuitem", { name: "Open this ring's pedals (Drive, then Reverb)" })).toHaveText("Open …");
    // The dice put one of the ring's chains on it and say which; the menu stays.
    expect(await worn(page)).toBe(-1);
    await row.getByRole("menuitem", { name: "Put another of this ring's chains on it" }).click();
    const diced = await worn(page);
    expect(diced).toBeGreaterThanOrEqual(0);
    await expect(toast).toContainText(`Hi-Hat: “${CHAINS[2]?.[diced]?.name}”.`);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // With a flanger on the ring, the step's menu offers to put the top of its sweep on that very step.
    await page.evaluate(() => window.kreisel.app.pedals.set({ mod: 2, depth: 0.5 }));
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(row.locator("button")).toHaveText(["Open …", "Dice", "Sweep peaks here"]);
    const here = row.getByRole("menuitemradio", { name: /^Put the top of this ring's sweep on step 5:/ });
    await expect(here).toHaveAttribute("aria-checked", "false");
    await here.click();
    expect((await pedalsOf(page, 2))?.crest).toBe(4);
    await expect(toast).toContainText("Hi-Hat: the sweep now peaks on step 5 of 16.");
    await expect(here).toHaveAttribute("aria-checked", "true");
    // One step back, and the menu says so.
    await page.keyboard.press("Control+z");
    expect((await pedalsOf(page, 2))?.crest).toBe(0);
    await expect(here).toHaveAttribute("aria-checked", "false");
    await here.click();
    expect((await pedalsOf(page, 2))?.crest).toBe(4);

    // "Open …" turns the panel over and puts the menu away; the board's slider stands where the menu put the peak.
    await row.getByRole("menuitem", { name: /^Open this ring's pedals \(/ }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#pedals")).toBeVisible();
    await expect(page.locator("#pedals-title")).toHaveText("Hi-Hat: pedals");
    await expect(page.locator("#pedal-crest")).toHaveAttribute("aria-valuetext", "step 5 of 16");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("sweeps a flanger and a phaser in time with their ring: the same in every round, and the top where the peak is put", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await open(page);
    /** One bar of four, counted from 1: sixteen numbers, the Hz of each sixteenth's sharpness. */
    const bar = (sharp: number[], number: number): number[] => sharp.slice((number - 1) * 16, number * 16);
    const sharpest = (row: number[]): number => row.indexOf(Math.max(...row));

    // Without a modulation every sixteenth is the same hit, and as sharp as the next (to the Hz, near 8900).
    const plain = await hats(page, null);
    expect(spread(bar(plain, 2))).toBeLessThan(20);

    for (const [name, mod] of [["flanger", 2], ["phaser", 1]] as const) {
      // A deep one that sweeps once every round: now the sixteenths lie up to 1000 Hz apart (2600 with the phaser),
      // and bar 3 is bar 2 again, to the Hz.
      const round = await hats(page, { mod, depth: 0.9, span: 1, crest: 0 });
      expect(spread(bar(round, 2)), name).toBeGreaterThan(300);
      expect(apart(bar(round, 2), bar(round, 3)), name).toBeLessThan(20);

      // The peak moved on by eight steps: the same sweep, half a bar later, and its sharpest sixteenth with it.
      const half = await hats(page, { mod, depth: 0.9, span: 1, crest: 8 });
      expect(apart(bar(half, 2), turned(bar(round, 2), 8)), name).toBeLessThan(20);
      expect(apart(bar(half, 2), bar(round, 2)), name).toBeGreaterThan(300);
      expect((sharpest(bar(half, 2)) - sharpest(bar(round, 2)) + 16) % 16, name).toBe(8);

      // A sweep that takes two rounds: bar 3 is not bar 2, but it is bar 1 again (but for the sixteenth the render begins with).
      const slow = await hats(page, { mod, depth: 0.9, span: 2, crest: 0 });
      expect(apart(bar(slow, 2), bar(slow, 3)), name).toBeGreaterThan(300);
      expect(apart(bar(slow, 1).slice(1), bar(slow, 3).slice(1)), name).toBeLessThan(20);
    }
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("keeps the sweep's top on its step when the rings are realigned every eight bars", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    // The hi-hat on a ring of twelve steps, ten bars of it. After eight bars (128 sixteenths) the ring has gone round
    // ten times and two thirds, and begins again with everything else.
    const sharp = await hats(page, { mod: 2, depth: 0.9, span: 1, crest: 3 }, 10, true);
    /** The twelve sixteenths of one round, from where it begins. */
    const round = (from: number): number[] => sharp.slice(from, from + 12);
    expect(spread(round(12))).toBeGreaterThan(300);
    expect(apart(round(108), round(12))).toBeLessThan(20);
    // The round that begins at the realignment sounds as every round before it, and so does the next: the sweep went
    // with the ring's runner. (Had it gone on counting the steps played, this round would begin where the sweep of
    // the ninth step is: eight steps on, which is four back.)
    expect(apart(round(128), round(12))).toBeLessThan(20);
    expect(apart(round(140), round(12))).toBeLessThan(20);
    expect(apart(round(128), turned(round(12), 4))).toBeGreaterThan(300);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("puts reverb and echo before the drive or after it, and the chain's line follows", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    // The chords of the techno Kreisel: driven, with reverb and echo.
    await turnOver(page, 5);
    const group = page.locator("#pedal-orders");
    await expect(group).toHaveAccessibleName("Order: where reverb and echo sit");
    await expect(group.getByRole("radio")).toHaveText(["Clean space", "Reverb into drive", "Echo into drive", "Both into drive"]);
    expect(await taken(page, "pedal-orders")).toEqual({ checked: [0], stops: [0] });
    expect(await chainOf(page)).toEqual({ pills: ["Drive", "Echo", "Reverb"], said: "Chain: Drive, then Echo, then Reverb." });

    await choice(page, "pedal-orders", "Reverb into drive").click();
    expect((await pedalsOf(page, 5))?.first).toBe(1);
    expect(await chainOf(page)).toEqual({ pills: ["Reverb", "Drive", "Echo"], said: "Chain: Reverb, then Drive, then Echo." });
    await choice(page, "pedal-orders", "Echo into drive").click();
    expect((await pedalsOf(page, 5))?.first).toBe(2);
    expect(await chainOf(page)).toEqual({ pills: ["Echo", "Drive", "Reverb"], said: "Chain: Echo, then Drive, then Reverb." });
    // The arrow keys go on through the group.
    await choice(page, "pedal-orders", "Echo into drive").focus();
    await page.keyboard.press("ArrowRight");
    await expect(choice(page, "pedal-orders", "Both into drive")).toBeFocused();
    expect((await pedalsOf(page, 5))?.first).toBe(3);
    expect(await taken(page, "pedal-orders")).toEqual({ checked: [3], stops: [3] });
    expect(await chainOf(page)).toEqual({ pills: ["Echo", "Reverb", "Drive"], said: "Chain: Echo, then Reverb, then Drive." });
    // The drive is the station everything else is before or after: it is the marked one, whatever its character.
    await expect(page.locator("#pedal-chain .station.drive")).toHaveText("Drive");
    await choice(page, "pedal-tones", "Clip").click();
    await expect(page.locator("#pedal-chain .station.drive")).toHaveText("Clip");
    expect((await chainOf(page)).said).toBe("Chain: Echo, then Reverb, then Clip.");
    // The pills are for the eye only: a screen reader gets the sentence.
    expect(await page.locator("#pedal-chain .station").evaluateAll((nodes) => nodes.every((node) => node.getAttribute("aria-hidden") === "true"))).toBe(true);
    await expect(page.locator("#pedal-chain")).not.toHaveAttribute("aria-label", /.*/);

    // One step back; and the button in the ring's panel says the same chain.
    await page.keyboard.press("Control+z");
    expect(await chainOf(page)).toEqual({ pills: ["Echo", "Reverb", "Drive"], said: "Chain: Echo, then Reverb, then Drive." });
    await expect(page.locator("#pedals-wearing")).toHaveText("Chain: Echo, then Reverb, then Drive.");
    // With nothing turned up, nothing stands in the ring's way.
    await page.evaluate(() => {
      window.kreisel.app.rings.setTrack(5, { hall: 0, echo: 0 });
      window.kreisel.app.pedals.strip();
    });
    expect(await chainOf(page)).toEqual({ pills: ["nothing in its way"], said: "Chain: nothing in its way." });
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("lets the drive work on a reverb or an echo that comes before it", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await open(page);
    // The clap by itself, driven a good half: two hits a bar, on the fifth and the thirteenth sixteenth, and room
    // between them. What is compared is how loud single sixteenths are: the hits, and what comes after them.
    const hits = [4, 12, 20, 28];
    const level = (loud: number[], at: number[]): number => Math.sqrt(at.reduce((sum, step) => sum + (loud[step] ?? 0) ** 2, 0) / at.length);
    const struck = (loud: number[]): number => level(loud, hits);
    /** The room between the hits: two and three sixteenths after each, when the clap itself is over. */
    const tail = (loud: number[]): number => level(loud, hits.flatMap((hit) => [hit + 2, hit + 3]));
    /** The echo's first repeat, a dotted eighth after each hit. */
    const repeat = (loud: number[]): number => level(loud, hits.map((hit) => hit + 3));
    const more = (after: number, before: number): number => 20 * Math.log10(after / before);
    const steps = { sixteenths: true };

    for (const [name, mix, first, after, least] of [["reverb", { hall: 0.4, echo: 0 }, 1, tail, 6], ["echo", { hall: 0, echo: 0.4 }, 2, repeat, 3]] as const) {
      const behind = await hear(page, 1, { drive: 0.6, ...mix }, steps);
      const before = await hear(page, 1, { drive: 0.6, ...mix, pedals: { first } }, steps);
      // Neither way clips, and the hits themselves are as loud either way.
      expect(behind.peak, name).toBeLessThanOrEqual(1);
      expect(before.peak, name).toBeLessThanOrEqual(1);
      expect(Math.abs(more(struck(before.sixteenths), struck(behind.sixteenths))), name).toBeLessThan(1.5);
      // What comes before the drive is driven with the ring: between the hits it is much louder than in a clean
      // space (the room by some 9 dB, the echo's first repeat by some 5.5 dB).
      expect(more(after(before.sixteenths), after(behind.sixteenths)), name).toBeGreaterThan(least);

      // And the drive has its part in that. Against the hits, what stands behind the drive is as loud whether the
      // ring is driven or not; what stands in front of it comes up with the drive (by a quarter to a third).
      const share = (heard: { sixteenths: number[] }): number => after(heard.sixteenths) / struck(heard.sixteenths);
      const liftBehind = share(behind) / share(await hear(page, 1, { drive: 0, ...mix }, steps));
      const liftBefore = share(before) / share(await hear(page, 1, { drive: 0, ...mix, pedals: { first } }, steps));
      expect(Math.abs(liftBehind - 1), name).toBeLessThan(0.15);
      expect(liftBefore, name).toBeGreaterThan(liftBehind * 1.15);
    }
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("puts one of a ring's five chains on it, by choice and by the dice, and takes everything off again", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await turnOver(page, 4);
    const chips = page.locator("#pedals .pedal-chains button");
    const none = page.locator("#pedal-none");
    const toast = page.locator("#toast");

    // Each ring has five chains of its own, and "None" after them.
    await expect(page.getByRole("group", { name: "Chains" }).getByRole("button")).toHaveCount(6);
    await expect(chips).toHaveText(["Acid classic", "Hard acid", "Acid wash", "Dub acid", "Phased acid", "None"]);
    for (let ring = 1; ring < 7; ring += 1) {
      await page.evaluate((track) => window.kreisel.app.select(track), ring);
      const names = (CHAINS[ring] ?? []).map((chain) => chain.name);
      expect(names).toHaveLength(5);
      await expect(chips).toHaveText([...names, "None"]);
    }
    await page.evaluate(() => window.kreisel.app.select(4));

    // A chain sets the ring's drive, its reverb and echo, and its pedals, and says what the ring now passes.
    const before = await state(page);
    const classic = chips.filter({ hasText: "Acid classic" });
    await expect(classic).toHaveAttribute("aria-pressed", "false");
    await expect(classic).toHaveAttribute("title", /\(Distortion, then Echo, then Reverb\)$/);
    await classic.click();
    expect(await trackOf(page, 4)).toMatchObject({ drive: 0.5, hall: 0.08, echo: 0.2, pedals: { tone: 1, crush: 0, mod: 0, depth: 0.4, crest: 0, span: 2, first: 0 } });
    await expect(toast).toContainText("Bass: “Acid classic”. Distortion, then Echo, then Reverb.");
    expect(await page.evaluate(() => window.kreisel.app.pedals.chain)).toBe("Distortion, then Echo, then Reverb");
    await expect(classic).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#pedals .pedal-chains button[aria-pressed="true"]')).toHaveCount(1);
    expect(await chainOf(page)).toEqual({ pills: ["Distortion", "Echo", "Reverb"], said: "Chain: Distortion, then Echo, then Reverb." });
    await expect(page.locator("#pedal-drive")).toHaveValue("50");
    expect(await taken(page, "pedal-tones")).toEqual({ checked: [1], stops: [1] });
    // It is one step back, by the key and by the message's own button.
    await page.keyboard.press("Control+z");
    expect(await state(page)).toBe(before);
    await expect(classic).toHaveAttribute("aria-pressed", "false");
    await classic.click();
    await toast.getByRole("button", { name: "Undo" }).click();
    expect(await state(page)).toBe(before);
    // Moving one of its controls away, the ring wears the chain no longer.
    await classic.click();
    await page.locator("#pedal-drive").fill("60");
    await expect(classic).toHaveAttribute("aria-pressed", "false");
    await page.locator("#pedal-drive").fill("50");
    await expect(classic).toHaveAttribute("aria-pressed", "true");

    // The dice put on another one each time, never the one the ring wears.
    let last = await worn(page);
    expect(last).toBe(0);
    for (let throws = 0; throws < 6; throws += 1) {
      await page.locator("#pedals-dice").click();
      const now = await worn(page);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).not.toBe(last);
      await expect(chips.nth(now)).toHaveAttribute("aria-pressed", "true");
      await expect(toast).toContainText(`Bass: “${CHAINS[4]?.[now]?.name}”.`);
      last = now;
    }
    // The right button on the ring's own button dices too, and leaves the panel as it is.
    await page.keyboard.press("Escape");
    await expect(page.locator("#pedals")).toBeHidden();
    for (let throws = 0; throws < 4; throws += 1) {
      await page.locator("#pedals-open").click({ button: "right" });
      const now = await worn(page);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).not.toBe(last);
      await expect(toast).toContainText(`Bass: “${CHAINS[4]?.[now]?.name}”.`);
      last = now;
    }
    await expect(page.locator("#pedals")).toBeHidden();
    await expect(page.locator("#context")).toBeHidden();

    // "None" takes everything off: no drive, no pedals. Reverb and echo stay where they are, and do not keep "None" from being the one taken.
    await page.evaluate(() => window.kreisel.app.pedals.wear(0));
    await page.keyboard.press("KeyY");
    await expect(none).toHaveAttribute("aria-pressed", "false");
    await none.click();
    expect(await trackOf(page, 4)).toMatchObject({ drive: 0, hall: 0.08, echo: 0.2 });
    expect(await pedalsOf(page, 4)).toBeNull();
    await expect(toast).toContainText("Bass: no pedals.");
    await expect(none).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#pedals .pedal-chains button[aria-pressed="true"]')).toHaveCount(1);
    expect(await chainOf(page)).toEqual({ pills: ["Echo", "Reverb"], said: "Chain: Echo, then Reverb." });
    expect(await worn(page)).toBe(-1);
    await page.keyboard.press("Control+z");
    expect(await worn(page)).toBe(0);
    await expect(none).toHaveAttribute("aria-pressed", "false");
    // A drive alone is something worn, too.
    await none.click();
    await page.locator("#pedal-drive").fill("10");
    await expect(none).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("renders every chain of every ring without clipping, about as loud as the ring is clean", async ({ page }) => {
    test.setTimeout(300_000);
    const problems = await open(page);
    // Each ring of the plain techno Kreisel by itself and not pressed: clean (no drive, no pedals), then with each of its five chains.
    const rows = await page.evaluate(async () => {
      const app = window.kreisel.app;
      const heard: { ring: number; chain: number; passes: string; dB: number; peak: number; loud: number }[] = [];
      for (let ring = 1; ring < 7; ring += 1) {
        const alone = (): void => {
          window.plainTechno();
          app.setGlobal({ pressure: 0 });
          for (let track = 0; track < 7; track += 1) app.rings.setTrack(track, { mute: track !== ring });
          app.select(ring);
          // The melody's ring is empty on the techno Kreisel: a few notes for it.
          if (ring === 6) {
            app.store.touch((project) => {
              for (const [at, pitch] of [[0, 0], [3, 4], [6, 7], [10, 4], [12, 2]] as const) Object.assign(project.scenes[0]!.patterns[6]!.steps[at]!, { on: true, pitch });
            });
          }
        };
        alone();
        app.pedals.strip();
        const clean = await window.kreisel.whole();
        heard.push({ ring, chain: -1, passes: app.pedals.chain, dB: 0, peak: clean.peak, loud: clean.loud });
        for (let chain = 0; chain < 5; chain += 1) {
          alone();
          app.pedals.wear(chain);
          const worn = await window.kreisel.whole();
          heard.push({ ring, chain, passes: app.pedals.chain, dB: 20 * Math.log10(worn.loud / clean.loud), peak: worn.peak, loud: worn.loud });
        }
      }
      return heard;
    });
    expect(rows).toHaveLength(36);
    for (const row of rows) {
      const name = row.chain < 0 ? `${NAMES[row.ring]}, clean` : `${NAMES[row.ring]}, “${CHAINS[row.ring]?.[row.chain]?.name}”`;
      expect(row.loud, `${name} is heard`).toBeGreaterThan(0.003);
      expect(row.peak, `${name} does not clip`).toBeLessThanOrEqual(1);
      // (The loudest against its clean ring is the melody's "Screech", by 4 dB.)
      expect(Math.abs(row.dB), `${name} is about as loud as the ring is clean`).toBeLessThan(6);
    }
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("holds Wash, Jet and Crush beside the wheel: nine effects, by key, latched, and let go when the Kreisel stops", async ({ page }) => {
    test.setTimeout(60_000);
    const problems = await open(page);
    const pads = page.locator("#fx .pad-fx");
    const pad = (name: string) => page.locator(`#fx [data-fx="${name}"]`);
    const fx = () => page.evaluate(() => ({ ...window.kreisel.app.engine.fx }));
    const level = (): Promise<number> => page.evaluate(() => window.kreisel.level());
    /** Every pad is inside the window, big enough to hit, and under the one before it. */
    const fit = () => page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#fx .pad-fx")].map((node) => node.getBoundingClientRect());
      return boxes.every((box, index) => box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && box.height >= 24 && box.width >= 24 && (index === 0 || box.top >= (boxes[index - 1]?.bottom ?? 0)));
    });

    // Three more after the six there were, all on the page: also in a window that is lower.
    await expect(pads).toHaveCount(9);
    expect(await pads.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.fx))).toEqual(["dumpf", "duenn", "stotter", "wurf", "pause", "aufbau", "wash", "jet", "crush"]);
    await expect(pads.locator(".name")).toHaveText(["Dull", "Thin", "Stutter", "Echo", "Pause", "Build-up", "Wash", "Jet", "Crush"]);
    expect(await fit()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 600 });
    expect(await fit()).toBe(true);
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.keyboard.press("Space");
    await expect.poll(level, { timeout: 5000 }).toBeGreaterThan(0.05);
    for (const [code, name] of [["Semicolon", "wash"], ["Quote", "jet"], ["BracketLeft", "crush"]] as const) {
      // Its key holds the effect for as long as it is down.
      await page.keyboard.down(code);
      await expect(pad(name)).toHaveClass(/held/);
      expect((await fx())[name]).toBe(true);
      await page.keyboard.up(code);
      await expect(pad(name)).not.toHaveClass(/held/);
      expect((await fx())[name]).toBe(false);
      // With Shift it latches, and the same key lets it go.
      await page.keyboard.press(`Shift+${code}`);
      await expect(pad(name)).toHaveClass(/latched/);
      await expect(pad(name)).toHaveAttribute("aria-pressed", "true");
      expect((await fx())[name]).toBe(true);
      await page.keyboard.press(code);
      await expect(pad(name)).not.toHaveClass(/latched/);
      await expect(pad(name)).toHaveAttribute("aria-pressed", "false");
      expect((await fx())[name]).toBe(false);
    }

    // On a pad that has the focus, Enter holds while it is down and Shift+Enter latches: nobody has to hold a key. Enter, or Shift+Enter again, lets a latched one go.
    const wash = pad("wash");
    await wash.focus();
    await page.keyboard.down("Enter");
    await expect(wash).toHaveClass(/held/);
    await expect(wash).not.toHaveClass(/latched/);
    expect((await fx()).wash).toBe(true);
    await page.keyboard.up("Enter");
    await expect(wash).not.toHaveClass(/held/);
    await expect(wash).toHaveAttribute("aria-pressed", "false");
    expect((await fx()).wash).toBe(false);
    await page.keyboard.press("Shift+Enter");
    await expect(wash).toHaveClass(/latched/);
    await expect(wash).toHaveAttribute("aria-pressed", "true");
    expect((await fx()).wash).toBe(true);
    await page.keyboard.press("Enter");
    await expect(wash).not.toHaveClass(/latched/);
    await expect(wash).toHaveAttribute("aria-pressed", "false");
    expect((await fx()).wash).toBe(false);
    await page.keyboard.press("Shift+Enter");
    await expect(wash).toHaveClass(/latched/);
    await page.keyboard.press("Shift+Enter");
    await expect(wash).not.toHaveClass(/latched/);
    expect((await fx()).wash).toBe(false);
    // A click that no pointer and no key made (a screen reader, a switch) cannot hold: it latches, and the next one lets go.
    const jet = pad("jet");
    await page.evaluate(() => document.querySelector<HTMLElement>('#fx [data-fx="jet"]')!.click());
    await expect(jet).toHaveClass(/latched/);
    await expect(jet).toHaveAttribute("aria-pressed", "true");
    expect((await fx()).jet).toBe(true);
    await page.evaluate(() => document.querySelector<HTMLElement>('#fx [data-fx="jet"]')!.click());
    await expect(jet).not.toHaveClass(/latched/);
    await expect(jet).toHaveAttribute("aria-pressed", "false");
    expect((await fx()).jet).toBe(false);

    // All three latched together: the Kreisel is still there, and nothing clips.
    for (const code of ["Semicolon", "Quote", "BracketLeft"]) await page.keyboard.press(`Shift+${code}`);
    await expect(page.locator(".pad-fx.latched")).toHaveCount(3);
    expect(await fx()).toMatchObject({ wash: true, jet: true, crush: true });
    // (Looked at for three seconds, once the wash has had a moment to swell.)
    await page.waitForTimeout(1000);
    const levels = await page.evaluate(async () => {
      const seen: number[] = [];
      for (let look = 0; look < 40; look += 1) {
        seen.push(window.kreisel.level());
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      return seen;
    });
    expect(Math.min(...levels)).toBeGreaterThan(0.02);
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.99);

    // Stopping the Kreisel lets every effect go.
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".pad-fx.latched")).toHaveCount(0);
    await expect(page.locator(".pad-fx.held")).toHaveCount(0);
    expect(await fx()).toEqual({ dumpf: false, duenn: false, stotter: false, wurf: false, pause: false, aufbau: false, wash: false, jet: false, crush: false });
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("says every slider's value, has one stop for the Tab key in each group, and nothing on the board is too small to hit", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await turnOver(page, 4);
    // A flanger, so that every row of the board shows.
    await choice(page, "pedal-mods", "Flanger").click();

    // Every slider of the panel says its value: a percentage, or its own words.
    const silent = await page.locator("#panel input[type=range]").evaluateAll((nodes) =>
      nodes.filter((node) => !node.getAttribute("aria-valuetext")).map((node) => `${node.closest(".panel-box")?.className.replace("panel-box ", "")}: ${node.id || node.closest("label, .line")?.querySelector(".label")?.textContent}`));
    expect(silent).toEqual([]);
    await expect(page.locator("#pedal-drive")).toHaveAttribute("aria-valuetext", "40 %");
    await expect(page.locator("#pedal-crush")).toHaveAttribute("aria-valuetext", "off");
    await expect(page.locator("#pedal-depth")).toHaveAttribute("aria-valuetext", "40 %");
    await expect(page.locator("#pedal-crest")).toHaveAttribute("aria-valuetext", "step 1 of 16");
    await page.locator("#pedal-drive").fill("60");
    await expect(page.locator("#pedal-drive")).toHaveAttribute("aria-valuetext", "60 %");
    // What stands beside a slider for the eye is not said a second time.
    expect(await page.locator("#pedals output").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-hidden")))).toEqual(["true", "true"]);

    // Each group of choices is one stop for the Tab key, and it is the choice that is taken.
    for (const group of ["pedal-tones", "pedal-mods", "pedal-spans", "pedal-orders"]) {
      await expect(page.locator(`#${group}`)).toHaveAttribute("role", "radiogroup");
      const { checked, stops } = await taken(page, group);
      expect(checked).toHaveLength(1);
      expect(stops).toEqual(checked);
    }
    await choice(page, "pedal-tones", "Fuzz").click();
    expect(await taken(page, "pedal-tones")).toEqual({ checked: [2], stops: [2] });
    // So the Tab key goes from the drive to its character and on to the crusher, past the other four.
    await page.locator("#pedal-drive").focus();
    await page.keyboard.press("Tab");
    await expect(choice(page, "pedal-tones", "Fuzz")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#pedal-crush")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(choice(page, "pedal-mods", "Flanger")).toBeFocused();

    // Nothing to press on the board is smaller than 24 px either way.
    const buttons = await page.locator("#pedals button").evaluateAll((nodes) =>
      nodes.filter((node) => node.getClientRects().length > 0).map((node) => {
        const box = node.getBoundingClientRect();
        return { name: node.textContent, width: Math.round(box.width), height: Math.round(box.height) };
      }));
    // Dice and "‹ Ring", five chains and "None", and the choices: five, four, five and four.
    expect(buttons).toHaveLength(26);
    expect(buttons.filter((box) => box.width < 24 || box.height < 24)).toEqual([]);

    // The sliders of the ring's own panel say their values the same way.
    await page.keyboard.press("Escape");
    await expect(page.locator("#drive-row input")).toHaveAttribute("aria-valuetext", "60 %");
    await expect(page.locator(".panel-ring .line", { hasText: "Echo" }).locator("input")).toHaveAttribute("aria-valuetext", "12 %");
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.skip(onLaptop, "Finger");

  test("has the pedals in the ring's panel on a phone, by tap, and the nine effects in two rows", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => window.plainTechno());
    await page.evaluate(() => window.kreisel.app.select(4));
    const opener = page.locator("#pedals-open");
    const board = page.locator("#pedals");
    const tap = (group: string, name: string) => choice(page, group, name).tap();

    // The button is in the ring's panel, further down the page; a tap turns the panel over where it is.
    await opener.scrollIntoViewIfNeeded();
    await opener.tap();
    await expect(board).toBeVisible();
    await expect(page.locator(".panel-ring")).toBeHidden();
    await expect(page.locator("#pedals-title")).toHaveText("Bass: pedals");

    // Every control works by a tap.
    await tap("pedal-tones", "Fuzz");
    await tap("pedal-mods", "Flanger");
    await expect(page.locator("#pedal-crest-row")).toBeVisible();
    await tap("pedal-spans", "four rounds");
    await page.locator("#pedal-crest").fill("5");
    await page.locator("#pedal-crush").fill("50");
    await page.locator("#pedal-depth").fill("70");
    await tap("pedal-orders", "Echo into drive");
    expect(await pedalsOf(page, 4)).toEqual({ tone: 2, crush: 0.5, mod: 2, depth: 0.7, crest: 5, span: 3, first: 2 });
    expect((await chainOf(page)).pills).toEqual(["Echo", "Fuzz", "Crush", "Flanger"]);
    // With everything showing, nothing on the board is wider than the window or too small for a finger.
    expect(await page.evaluate(() => [...document.querySelectorAll("#pedals button, #pedals input, #pedals .station")].filter((node) => node.getClientRects().length > 0).every((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth && (!(node instanceof HTMLButtonElement) || (box.width >= 24 && box.height >= 24));
    }))).toBe(true);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

    // A chain, the dice, and none.
    await board.getByRole("button", { name: "Hard acid" }).tap();
    expect(await worn(page)).toBe(1);
    await expect(page.locator("#toast")).toContainText("Bass: “Hard acid”. Clip, then Echo.");
    await page.locator("#pedals-dice").tap();
    expect(await worn(page)).not.toBe(1);
    expect(await worn(page)).toBeGreaterThanOrEqual(0);
    await page.locator("#pedal-none").tap();
    expect(await pedalsOf(page, 4)).toBeNull();
    await expect(page.locator("#pedal-none")).toHaveAttribute("aria-pressed", "true");
    // And back to the ring.
    await page.locator("#pedals-done").tap();
    await expect(board).toBeHidden();
    await expect(page.locator(".panel-ring")).toBeVisible();

    // The nine effects lie in two rows, five and four, inside the window's width.
    await expect(page.locator("#fx .pad-fx")).toHaveCount(9);
    const rows = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#fx .pad-fx")].map((node) => node.getBoundingClientRect());
      const tops = [...new Set(boxes.map((box) => Math.round(box.top)))];
      return { counts: tops.map((top) => boxes.filter((box) => Math.round(box.top) === top).length), inside: boxes.every((box) => box.left >= 0 && box.right <= window.innerWidth && box.height >= 24) };
    });
    expect(rows).toEqual({ counts: [5, 4], inside: true });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

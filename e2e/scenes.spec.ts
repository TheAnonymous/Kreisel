import { expect, test, type Locator, type Page } from "@playwright/test";
import { onLaptop, onPhone, open } from "./helpers";

/*
 * Scenes and the row ("Folge"): every scene is a small wheel, a switch says
 * what plays (the scene, the row or the piece), and the row lies under the
 * wheel, one tile a round: laid with "+" or by carrying a scene there.
 */

const order = (page: Page): Promise<number[]> => page.evaluate(() => window.kreisel.app.project.order);
const plays = (page: Page, name: string): Locator => page.locator("#plays").getByRole("radio", { name });
const rounds = (page: Page): Locator => page.locator("#row .round:not(.add)");
const scene = (page: Page, name: string): Locator => page.locator(".scene", { hasText: name });
const middle = async (node: Locator): Promise<{ x: number; y: number; left: number; right: number }> => {
  const box = (await node.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, left: box.x, right: box.x + box.width };
};

/** Picks a thing up with the mouse and carries it to a point, in small moves as a hand makes them; lets go there unless told to hold. */
async function carry(page: Page, from: Locator, to: { x: number; y: number }, letGo = true): Promise<void> {
  const start = await middle(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y - 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (letGo) await page.mouse.up();
}

/** Short rounds: every scene one bar long, and fast. */
const hurry = (page: Page, bpm: number): Promise<void> =>
  page.evaluate((tempo) => {
    const app = window.kreisel.app;
    app.store.edit((project) => {
      project.bpm = tempo;
      for (const one of project.scenes) if (one) one.chords = [0];
    });
  }, bpm);

test.describe("am Laptop", () => {
  test.skip(onPhone, "Maus und Tastatur");

  test("zeigt Szenen als kleine Räder und schaltet um, was spielt", async ({ page }) => {
    const problems = await open(page);

    // A filled scene shows its hits, an empty one a plus.
    await expect(page.locator(".scene")).toHaveCount(8);
    await expect(scene(page, "A")).toHaveClass(/filled/);
    await expect(scene(page, "A")).toHaveClass(/current/);
    expect(await scene(page, "A").locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set<string>();
      for (let at = 0; at < pixels.length; at += 4) if (pixels[at + 3]! > 200) colours.add(`${pixels[at]! >> 5},${pixels[at + 1]! >> 5},${pixels[at + 2]! >> 5}`);
      return colours.size;
    })).toBeGreaterThan(3);
    await expect(scene(page, "B")).not.toHaveClass(/filled/);
    expect(await scene(page, "B").evaluate((node) => getComputedStyle(node, "::before").content)).toBe('"+"');
    await expect(scene(page, "B").locator("canvas")).toBeHidden();

    // One switch for what plays; the old tick and its "je 2×" are gone.
    await expect(page.locator("#chain, #repeats")).toHaveCount(0);
    await expect(plays(page, "Szene")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#row")).toBeHidden();
    const wheel = await page.locator("#kreisel").boundingBox();

    // A new scene is a new part: it joins the row at its end.
    await scene(page, "B").click();
    await expect(page.locator("#toast")).toContainText("Kopie von A");
    expect(await order(page)).toEqual([0, 1]);
    await page.evaluate(() => window.kreisel.app.dismiss());

    // The row lies under the wheel, and the wheel stays where it was.
    await plays(page, "Folge").click();
    await expect(plays(page, "Folge")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#row")).toBeVisible();
    await expect(rounds(page)).toHaveText(["A", "B"]);
    await expect(page.locator("#row .row-sum")).toHaveText(/^2 Runden · \d:\d\d$/);
    expect(await page.locator("#kreisel").boundingBox()).toEqual(wheel);
    const band = (await page.locator("#row").boundingBox())!;
    expect(band.y).toBeGreaterThanOrEqual(wheel!.y + wheel!.height);
    expect(band.y + band.height).toBeLessThanOrEqual((await page.locator("#status").boundingBox())!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => window.kreisel.app.project.chain)).toBe(true);

    // The piece is the third way; its own switches go along, and the row is kept as it was laid.
    await plays(page, "Stück").click();
    expect(await page.evaluate(() => window.kreisel.app.project.piece.on)).toBe(true);
    await expect(page.locator(".piece-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#row")).toBeHidden();
    await page.locator(".piece-toggle").click();
    await expect(plays(page, "Folge")).toHaveAttribute("aria-checked", "true");
    await expect(rounds(page)).toHaveText(["A", "B"]);
    await plays(page, "Szene").click();
    expect(await page.evaluate(() => [window.kreisel.app.project.chain, window.kreisel.app.project.piece.on])).toEqual([false, false]);

    // Laid from a scene's menu while the row is not to be seen, the Kreisel says where it went.
    await scene(page, "A").click({ button: "right" });
    await page.locator("#context").getByRole("menuitem", { name: "In die Folge legen" }).click();
    expect(await order(page)).toEqual([0, 1, 0]);
    await expect(page.locator("#toast")).toContainText("als 3. Runde in der Folge");

    // It is kept with the Kreisel.
    await plays(page, "Folge").click();
    await page.evaluate(() => window.kreisel.app.store.save());
    await page.reload();
    await expect(rounds(page)).toHaveText(["A", "B", "A"]);
    await expect(plays(page, "Folge")).toHaveAttribute("aria-checked", "true");
    expect(problems).toEqual([]);
  });

  test("legt die Folge: mit Plus, durch Ziehen, per Rechtsklick und mit Entf", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    await scene(page, "B").click();
    await scene(page, "C").click();
    await page.evaluate(() => window.kreisel.app.dismiss());
    await plays(page, "Folge").click();
    expect(await order(page)).toEqual([0, 1, 2]);

    // Plus: the scene on the table once more, at the end.
    await page.locator("#row .round.add").click();
    expect(await order(page)).toEqual([0, 1, 2, 2]);
    await expect(page.locator("#row .row-sum")).toContainText("4 Runden");

    // A scene carried into the row lands where it is let go: here between the second and the third round.
    const second = await middle(rounds(page).nth(1));
    await carry(page, scene(page, "A"), { x: second.right + 3, y: second.y }, false);
    await expect(page.locator(".carried")).toBeVisible();
    await expect(page.locator("#row .gap")).toBeVisible();
    await page.mouse.up();
    expect(await order(page)).toEqual([0, 1, 0, 2, 2]);
    await expect(page.locator(".carried, #row .gap")).toHaveCount(0);
    // Letting go was not a click: the scene on the table is the one it was.
    await expect(page.locator(".scene.current")).toHaveText("C");

    // Carried somewhere else, or put down with Escape, nothing happens.
    const away = await middle(page.locator("#kreisel"));
    await carry(page, scene(page, "B"), away);
    await carry(page, scene(page, "B"), { x: second.x, y: second.y }, false);
    await page.keyboard.press("Escape");
    await expect(page.locator(".carried")).toHaveCount(0);
    await page.mouse.up();
    expect(await order(page)).toEqual([0, 1, 0, 2, 2]);
    await expect(page.locator(".scene.current")).toHaveText("C");

    // A round carried along the row takes another place: the first goes to the end, the last comes back to the front.
    let last = await middle(rounds(page).nth(4));
    await carry(page, rounds(page).nth(0), { x: last.right + 2, y: last.y });
    expect(await order(page)).toEqual([1, 0, 2, 2, 0]);
    const first = await middle(rounds(page).nth(0));
    await carry(page, rounds(page).nth(4), { x: first.left + 2, y: first.y });
    expect(await order(page)).toEqual([0, 1, 0, 2, 2]);
    await expect(rounds(page)).toHaveText(["A", "B", "A", "C", "C"]);

    // The right button on a round: once more, another scene, out.
    await rounds(page).nth(1).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Folge: 2. Runde, Szene B");
    await menu.getByRole("menuitem", { name: "Noch einmal" }).click();
    expect(await order(page)).toEqual([0, 1, 1, 0, 2, 2]);
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "C" }).click();
    expect(await order(page)).toEqual([0, 2, 1, 0, 2, 2]);
    await page.keyboard.press("Escape");
    await rounds(page).nth(1).click({ button: "right" });
    await expect(menu.locator("header")).toHaveText("Folge: 2. Runde, Szene C");
    await menu.getByRole("menuitem", { name: "Herausnehmen" }).click();
    expect(await order(page)).toEqual([0, 1, 0, 2, 2]);
    await expect(menu).toBeHidden();

    // Delete on a round takes the round out, and no hit off the wheel.
    const hits = await page.evaluate(() => JSON.stringify(window.kreisel.app.project.scenes));
    await rounds(page).nth(4).focus();
    await page.keyboard.press("Delete");
    expect(await order(page)).toEqual([0, 1, 0, 2]);
    expect(await page.evaluate(() => JSON.stringify(window.kreisel.app.project.scenes))).toBe(hits);
    // The keyboard stays in the row, on the round that moved up.
    await expect(page.locator("#row .round:focus")).toHaveAttribute("data-round", "3");
    // A step back brings it back.
    await page.keyboard.press("Control+z");
    expect(await order(page)).toEqual([0, 1, 0, 2, 2]);

    // A scene carried onto an empty one is copied there: a new part, at the end of the row.
    await carry(page, scene(page, "A"), await middle(scene(page, "F")));
    await expect(page.locator("#toast")).toContainText("Szene F ist eine Kopie von A");
    await expect(page.locator(".scene.current")).toHaveText("F");
    expect(await order(page)).toEqual([0, 1, 0, 2, 2, 5]);
    expect(await page.evaluate(() => JSON.stringify(window.kreisel.app.project.scenes[5]) === JSON.stringify(window.kreisel.app.project.scenes[0]))).toBe(true);

    // A scene that is cleared takes its rounds along.
    await scene(page, "C").click({ modifiers: ["Shift"] });
    expect(await order(page)).toEqual([0, 1, 0, 5]);
    await expect(rounds(page)).toHaveText(["A", "B", "A", "F"]);
    // The page is one screen and cannot be rolled, not even by the browser itself (it once rolled up under this very click).
    expect(await page.evaluate(() => {
      const frame = document.getElementById("app")!;
      frame.scrollTop = 50;
      return [frame.scrollTop, document.scrollingElement!.scrollTop];
    })).toEqual([0, 0]);
    expect(problems).toEqual([]);
  });

  test("spielt die Folge Runde für Runde und springt, wohin man klickt", async ({ page }) => {
    const problems = await open(page);
    await scene(page, "B").click();
    await page.evaluate(() => {
      const app = window.kreisel.app;
      app.dismiss();
      app.scenes.pick(0);
      app.scenes.lay(0, 1);
    });
    await hurry(page, 200);
    await plays(page, "Folge").click();
    expect(await order(page)).toEqual([0, 0, 1]);
    const now = page.locator("#row .round.now");

    // From the start: A, A once more (a round of its own), then B, and round again.
    await page.keyboard.press("Space");
    await expect(now).toHaveAttribute("data-round", "0");
    await expect(now).toHaveAttribute("data-round", "1", { timeout: 6000 });
    await expect(page.locator(".scene.current")).toHaveText("A");
    await expect.poll(() => now.evaluate((tile: HTMLElement) => Number(tile.style.getPropertyValue("--done")))).toBeGreaterThan(0);
    await expect(now).toHaveAttribute("data-round", "2", { timeout: 6000 });
    await expect(page.locator(".scene.current")).toHaveText("B");
    await expect(page.locator(".scene.sounding")).toHaveText("B");
    await expect(now).toHaveAttribute("data-round", "0", { timeout: 6000 });

    // A click on a round goes there at the next bar line.
    await page.evaluate(() => window.kreisel.app.setGlobal({ bpm: 80 }));
    await expect(now).toHaveAttribute("data-round", "1", { timeout: 9000 });
    await rounds(page).nth(0).click();
    await expect(rounds(page).nth(0)).toHaveClass(/queued/);
    await expect(now).toHaveAttribute("data-round", "0", { timeout: 9000 });
    await expect(page.locator("#row .round.queued")).toHaveCount(0);

    // The row is changed under the round that plays: the mark stays with its round.
    await page.evaluate(() => window.kreisel.app.scenes.lay(1, 0));
    await expect(now).toHaveAttribute("data-round", "1");
    await expect(now).toHaveText("A");
    await page.evaluate(() => window.kreisel.app.scenes.moveRound(1, 3));
    await expect(now).toHaveAttribute("data-round", "3");
    expect(await order(page)).toEqual([1, 0, 1, 0]);
    await page.waitForTimeout(400);
    await expect(now).toHaveAttribute("data-round", "3");
    await page.keyboard.press("Space");
    await expect(now).toHaveCount(0);
    await expect(page.locator(".scene.sounding")).toHaveCount(0);

    // While it stands, a click puts the round's scene on the table and the row begins there.
    await rounds(page).nth(2).click();
    await expect(page.locator(".scene.current")).toHaveText("B");
    await expect(now).toHaveAttribute("data-round", "2");
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.engine.heard?.round ?? null)).toBe(2);
    await page.keyboard.press("Space");
    // Another scene picked by hand, and the row begins with that scene's first round instead.
    await rounds(page).nth(2).click();
    await expect(now).toHaveAttribute("data-round", "2");
    await scene(page, "A").click();
    await expect(now).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.engine.heard?.round ?? null)).toBe(1);
    await page.keyboard.press("Space");

    // "Von hier spielen" starts it at that round.
    await rounds(page).nth(1).click({ button: "right" });
    await page.locator("#context").getByRole("menuitem", { name: "Von hier spielen" }).click();
    await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.kreisel.app.engine.heard?.round ?? null)).toBe(1);
    await page.keyboard.press("Space");
    expect(problems).toEqual([]);
  });
});

test.describe("am Handy", () => {
  test.skip(onLaptop, "Finger");

  test("legt die Folge mit dem Finger", async ({ page }) => {
    const problems = await open(page);
    const menu = page.locator("#context");
    await scene(page, "B").tap();
    await page.evaluate(() => window.kreisel.app.dismiss());
    await plays(page, "Folge").tap();
    await expect(page.locator("#row")).toBeVisible();
    await expect(rounds(page)).toHaveText(["A", "B"]);

    // The row lies right under the wheel, and the page stays as wide as the phone.
    const wheel = (await page.locator("#kreisel").boundingBox())!;
    const band = (await page.locator("#row").boundingBox())!;
    expect(band.y).toBeGreaterThanOrEqual(wheel.y + wheel.height - 1);
    expect(band.y).toBeLessThan((await page.locator("#tools").boundingBox())!.y);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);

    // Plus lays the scene on the table at the end; a tap on a round puts its scene on the table.
    await page.locator("#row .round.add").tap();
    expect(await order(page)).toEqual([0, 1, 1]);
    await rounds(page).nth(0).tap();
    await expect(page.locator(".scene.current")).toHaveText("A");
    await expect(page.locator("#row .round.now")).toHaveAttribute("data-round", "0");

    // A finger that rests on a round opens its menu.
    const tile = (await rounds(page).nth(0).boundingBox())!;
    const finger = { pointerId: 11, pointerType: "touch", isPrimary: true, button: 0, clientX: tile.x + tile.width / 2, clientY: tile.y + tile.height / 2, bubbles: true };
    await rounds(page).nth(0).dispatchEvent("pointerdown", finger);
    await page.waitForTimeout(800);
    await rounds(page).nth(0).dispatchEvent("pointerup", finger);
    await expect(menu.locator("header")).toHaveText("Folge: 1. Runde, Szene A");
    // A finger does not carry: the menu moves the round instead.
    await expect(menu.getByRole("menuitem", { name: "Eine Runde früher" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Eine Runde später" }).tap();
    expect(await order(page)).toEqual([1, 0, 1]);
    await rounds(page).nth(1).dispatchEvent("pointerdown", finger);
    await page.waitForTimeout(800);
    await rounds(page).nth(1).dispatchEvent("pointerup", finger);
    await expect(menu.locator("header")).toHaveText("Folge: 2. Runde, Szene A");
    await menu.getByRole("menuitem", { name: "Herausnehmen" }).tap();
    expect(await order(page)).toEqual([1, 1]);

    // A long row is pushed along sideways; the page does not grow wider with it.
    await page.evaluate(() => {
      const app = window.kreisel.app;
      for (let count = 0; count < 20; count += 1) app.scenes.lay(1);
    });
    await expect(rounds(page)).toHaveCount(22);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator("#row .rounds").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(problems).toEqual([]);
  });
});

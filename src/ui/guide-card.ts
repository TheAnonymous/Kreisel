import type { App } from "../app/app";
import { CHAPTERS, type Chapter, type Mark } from "../app/lessons";
import { button, byId, el } from "./dom";
import { reachable } from "./pedal-board";
import type { Panels } from "./panels";

/*
 * The guide's card: where the guide (src/app/guide.ts) is read and answered.
 * It has a place of its own (under the wheel on a laptop, along the foot of
 * the window elsewhere), so it never lies on what it talks about, and its
 * buttons stay where they are from task to task.
 *
 * It is a named part of the page, not a window: the focus passes through it
 * freely and nothing under it is locked. It takes the focus only for a
 * keyboard, and only when the visitor asked for it or pressed one of its
 * buttons; a task that is done on the page leaves the focus where it was.
 * F6 goes to the card and back. What it says is written once to an announcer
 * of its own, so a screen reader speaks every step once.
 */

/** Room around a marked part of the page, in pixels. */
const HALO = 5;
/** A step's words are announced a moment after it comes: what the page itself has to say about the change is spoken first. */
const ANNOUNCE_AFTER = 450;
/** What was announced is taken off the page again after a while: whoever reads the page line by line does not find an old message there. */
const FORGET_AFTER = 12_000;
/** A first visit: the guide comes a moment after the page, when the wheel has dealt its hits. */
const ARRIVE_AFTER = 700;
const LAPTOP = "(min-width: 1100px) and (min-height: 540px)";

export class GuideCard {
  private readonly card = byId("tour");
  private readonly title = byId("tour-title");
  private readonly count = byId("tour-count");
  private readonly text = byId("tour-text");
  private readonly hint = byId("tour-hint");
  private readonly keys = byId("tour-keys");
  private readonly list = byId("tour-list");
  private readonly showIt = byId<HTMLButtonElement>("tour-show");
  private readonly back = byId<HTMLButtonElement>("tour-back");
  private readonly next = byId<HTMLButtonElement>("tour-next");
  private readonly keep = byId<HTMLButtonElement>("tour-keep");
  private readonly mine = byId<HTMLButtonElement>("tour-mine");
  private readonly closer = byId<HTMLButtonElement>("tour-skip");
  private readonly announcer = byId("tour-said");
  private readonly mark = byId("tour-mark");
  private readonly room = byId("tour-room");
  private signature = "";
  private spoken = 0;
  private cheered = 0;
  private speaking: ReturnType<typeof setTimeout> | null = null;
  private forgetting: ReturnType<typeof setTimeout> | null = null;
  private again = 0;
  /** Where the focus was when the visitor came to the card: it goes back there when the card is put away, and at F6. */
  private cameFrom: Element | null = null;
  /** The task whose place was last brought into view (once a task, where the page scrolls). */
  private broughtUp = "";
  /** What the visitor last used: the card takes the focus for a keyboard, never for a mouse or a finger (a click there is over when it is done, and the keys go back to the wheel). */
  private byKeys = false;
  /** What stands under the sentence where lessons are picked: the lesson to go on with, in words. */
  private offer = "";

  /** `cheer` lets the wheel answer a task that was done; `point` lets it show the mark on a ring once more. */
  constructor(private readonly panels: Panels, private readonly app: App, private readonly cheer: () => void, private readonly point: () => void) {}

  build(): void {
    const { app, card } = this;
    const guide = app.guide;
    guide.keyName = (code) => this.panels.keyLabel(code);
    const coarse = window.matchMedia("(pointer: coarse)");
    guide.touch = coarse.matches;
    coarse.addEventListener("change", () => guide.setTouch(coarse.matches));
    document.addEventListener("keydown", (event) => {
      this.byKeys = true;
      // F6 goes to the guide's card and back to where the focus was: the one key the guide has, and no character.
      if (event.key !== "F6" || event.ctrlKey || event.metaKey || event.altKey || guide.view === "off") return;
      event.preventDefault();
      const focused = document.activeElement;
      if (card.contains(focused)) {
        [this.cameFrom, byId("kreisel")].find(reachable)?.focus();
      } else {
        this.cameFrom = focused === document.body ? null : focused;
        this.stops().find(reachable)?.focus();
      }
    }, true);
    document.addEventListener("pointerdown", () => { this.byKeys = false; }, true);
    this.showIt.addEventListener("click", () => guide.show());
    this.back.addEventListener("click", () => guide.back());
    this.next.addEventListener("click", () => guide.next());
    this.keep.addEventListener("click", () => guide.settle(true));
    this.mine.addEventListener("click", () => guide.settle(false));
    this.closer.addEventListener("click", () => guide.close());
    // The place a task names is a button in its sentence: it puts the focus there and shows the mark once more.
    this.text.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".guide-goto")) this.goTo(guide.mark);
    });
    const again = (): void => {
      if (guide.view !== "off") this.place();
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, { passive: true, capture: true });
    window.matchMedia(LAPTOP).addEventListener("change", again);
    // A first visit: the first steps lie ready. Not over a window that a link opened.
    setTimeout(() => {
      if (!app.paint.isOpen && !app.body.isOpen && !app.voice.isOpen) guide.arrive();
    }, ARRIVE_AFTER);
  }

  /** Puts the guide away if it is up, and says whether it was. */
  end(): boolean {
    if (this.app.guide.view === "off") return false;
    this.app.guide.close();
    return true;
  }

  /** Where the focus can land on the card, in the order of preference: the task's place, what goes on, what is to be decided, a lesson, the way out. */
  private stops(): (HTMLElement | null)[] {
    return [this.text.querySelector<HTMLElement>(".guide-goto"), this.keep, this.list.querySelector<HTMLElement>(".chip.primary"), this.list.querySelector<HTMLElement>(".chip"), this.next, this.closer];
  }

  /** The words of a task as the card shows them: the place's name as a button, a key as a key. */
  private rich(text: string): Node[] {
    return text.split(/(\[[^\]]+\]|\{key:\w+\})/).filter((part) => part !== "").map((part) => {
      if (part.startsWith("[")) {
        const go = button("guide-goto", part.slice(1, -1), "Shows where this is, and puts the keyboard's focus there");
        go.setAttribute("aria-description", "Shows where this is, and puts the keyboard's focus there");
        return go;
      }
      const key = /^\{key:(\w+)\}$/.exec(part)?.[1];
      return key ? el("kbd", "", this.panels.keyLabel(key)) : document.createTextNode(part);
    });
  }

  /** Shows the place a task names once more (its mark moves again) and puts the focus there. Nothing about that place is changed for it. */
  private goTo(mark: Mark | null): void {
    if (!mark) return;
    const { app } = this;
    // The mark moves again: for a mouse, that is what "where?" looks like.
    this.mark.style.animation = "none";
    void this.mark.offsetWidth;
    this.mark.style.animation = "";
    this.point();
    if (mark.kind === "hub") {
      // The play button in the wheel's middle is the same as "Start" in the bar, which is a button a key can press.
      if (this.byKeys) byId("play").focus();
      return;
    }
    if (mark.kind === "ring") {
      app.select(mark.track);
      if (this.byKeys) {
        app.keyCursor = mark.steps?.find((step) => !this.onStep(mark.track, step)) ?? app.keyCursor ?? 0;
        byId("kreisel").focus();
      }
      app.notify();
      return;
    }
    const target = document.querySelector<HTMLElement>(mark.selector);
    if (!target) return;
    const able = "button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex='-1'])";
    const first = (mark.focus ? document.querySelector<HTMLElement>(mark.focus) : null) ?? (target.matches(able) ? target : target.querySelector<HTMLElement>(able));
    (first ?? target).scrollIntoView({ block: "nearest" });
    if (this.byKeys) first?.focus();
  }

  private onStep(track: number, step: number): boolean {
    const pattern = this.app.project.scenes[this.app.project.scene]?.patterns[track];
    return pattern?.steps[step]?.on === true;
  }

  sync(): void {
    const { app, card } = this;
    const guide = app.guide;
    const view = guide.view;
    const focused = document.activeElement;
    const within = card.contains(focused);
    const lending = guide.chapter?.lends !== undefined && app.store.lending;
    const signature = [view, guide.chapter?.id ?? "", guide.index, guide.done, guide.revisited, guide.touch, guide.skipped, [...guide.finished].join(","), guide.left ? `${guide.left.id}.${guide.left.index}` : "", lending, guide.heard("dice-all"), guide.hint, guide.starts].join("|");
    if (signature !== this.signature) {
      this.signature = signature;
      this.write(lending);
    }
    card.hidden = view === "off";
    this.place();

    // What the guide has to say is said once, a moment after it happened.
    if (guide.saidCount !== this.spoken) {
      this.spoken = guide.saidCount;
      if (this.speaking !== null) clearTimeout(this.speaking);
      const said = guide.said;
      this.speaking = setTimeout(() => {
        // The same words twice in a row would not be spoken a second time: a blank between them makes them new.
        this.announcer.textContent = this.announcer.textContent === said ? `${said} ` : said;
        if (this.forgetting !== null) clearTimeout(this.forgetting);
        this.forgetting = setTimeout(() => { this.announcer.textContent = ""; }, FORGET_AFTER);
      }, ANNOUNCE_AFTER);
    }
    // A task that was done by doing: the wheel answers.
    if (guide.cheers !== this.cheered) {
      this.cheered = guide.cheers;
      this.cheer();
    }

    if (view === "off") {
      // Put away with the keyboard's focus on it: the focus goes back where the visitor came from, or to where the
      // guide is found again. (A mouse that clicked the × wants nothing focused: the space bar is start and stop.)
      if (within && this.byKeys) [this.cameFrom, byId("help-open"), byId("kreisel")].find(reachable)?.focus();
      else if (within && focused instanceof HTMLElement) focused.blur();
      // What a lesson had built is offered once more in the page's message: with the keyboard, that offer is where
      // the focus goes (the message is drawn after the card, so in the next frame).
      if (guide.offered && this.byKeys) requestAnimationFrame(() => byId("toast").querySelector<HTMLElement>(".button:not(.icon)")?.focus());
      guide.offered = false;
      this.cameFrom = null;
      guide.asked = false;
      return;
    }
    if (guide.asked) {
      // The visitor asked for the guide or pressed one of its buttons. With the keyboard, the focus is on the card
      // then: on the button that was pressed if it is still there, otherwise on the task's place in its sentence (or
      // what there is to decide). With a mouse or a finger the focus is left alone: a click is over when it is done,
      // and the keys belong to the wheel again.
      guide.asked = false;
      if (this.byKeys) {
        if (!within) this.cameFrom = focused === document.body ? null : focused;
        (within && reachable(focused) ? focused : this.stops().find(reachable))?.focus();
      }
    } else if (within && !reachable(focused)) {
      // What had the focus is gone from the card: it stays on the card.
      this.stops().find(reachable)?.focus();
    }
  }

  /** A lesson as one of the chips where lessons are picked. */
  private chip(one: Chapter, recommended: boolean): HTMLButtonElement {
    const guide = this.app.guide;
    const done = guide.finished.has(one.id);
    const left = guide.left?.id === one.id && guide.left.index > 0 ? guide.left.index : 0;
    const chip = button(`chip${done ? " finished" : ""}${recommended ? " primary" : ""}`, "");
    chip.append(el("span", "name", one.name));
    if (left > 0) chip.append(el("span", "where", `continue at ${left + 1}`));
    // What the lesson is for: in view for a finger (which has no pointer to rest on a chip), under the chips otherwise.
    chip.append(el("span", "promise", one.promise));
    chip.setAttribute("aria-label", `${one.name}: ${one.promise}${done ? ". Done" : ""}${left > 0 ? `. Continue at step ${left + 1}` : ""}`);
    chip.dataset.lesson = one.id;
    chip.addEventListener("click", () => guide.start(one.id, left > 0));
    const tell = (): void => { this.keys.textContent = `${one.name}: ${one.promise}.`; };
    const untell = (): void => { this.keys.textContent = this.offer; };
    chip.addEventListener("pointerenter", tell);
    chip.addEventListener("focus", tell);
    chip.addEventListener("pointerleave", untell);
    chip.addEventListener("blur", untell);
    return chip;
  }

  /** Writes the card anew for what the guide shows now. */
  private write(lending: boolean): void {
    const guide = this.app.guide;
    const { view, chapter } = guide;
    const task = guide.task;
    const tasks = guide.tasks;
    const onTask = view === "task";
    this.card.classList.toggle("done", (onTask && guide.done) || (view === "end" && !guide.skipped));
    this.card.classList.toggle("listing", view === "list");
    this.title.textContent = view === "list" ? "Lessons" : (chapter?.name ?? "Guide");
    // A task gone back to that holds already is shown once more, to be read: its sentence, as done.
    const read = guide.done && guide.revisited;
    const step = `Step ${guide.index + 1} of ${tasks.length}`;
    this.count.textContent = onTask ? (read ? `${step} · done` : guide.done ? "Done" : step) : view === "end" ? (guide.skipped ? "" : "Done") : "";

    // The lessons: on the list, and at the end of one (what could come next), once nothing is left to decide there.
    const picking = view === "list" || (view === "end" && !lending);
    const next = picking ? guide.upNext : null;
    this.offer = next ? `Next: ${next.name}. ${next.promise}.` : picking ? "All seven lessons are done. Each can be done again." : "";
    this.list.hidden = !picking;
    this.list.replaceChildren(...(picking ? CHAPTERS.filter((one) => view === "list" || one.id !== chapter?.id || guide.skipped).map((one) => this.chip(one, one.id === next?.id)) : []));

    const hint = guide.hint;
    this.hint.hidden = hint === "";
    this.hint.textContent = hint;
    if (onTask && task) {
      this.text.replaceChildren(...(guide.done && !read ? [document.createTextNode(task.after ?? "Done.")] : this.rich(guide.line)));
      // Under the sentence: a hint if something is in the way, and the keyboard's way (a task read again: what it left).
      this.keys.replaceChildren(...(read ? [document.createTextNode(task.after ?? "")] : guide.done ? [] : this.rich(guide.keys)));
    } else {
      this.text.textContent = view === "end" ? guide.ending : view === "list" ? "Pick a lesson. Each takes a minute or two and is done by doing." : "";
      this.keys.textContent = this.offer;
    }

    // The buttons of a task stay where they are from task to task; a task that was done keeps them too.
    this.showIt.hidden = !onTask;
    this.showIt.setAttribute("aria-disabled", String(guide.done));
    // Where showing a task starts the Kreisel, the button says so before it is pressed.
    this.showIt.title = guide.starts ? "Does this once for you. The Kreisel starts playing." : "Does this once for you";
    if (guide.starts) this.showIt.setAttribute("aria-label", "Show me: the Kreisel starts playing");
    else this.showIt.removeAttribute("aria-label");
    this.back.hidden = !onTask || guide.index === 0;
    this.next.hidden = !onTask;
    // "Skip" while the task is still to do (it never has to be done to go on), "Next" once it was.
    const last = guide.index >= tasks.length - 1;
    this.next.textContent = guide.done ? (last ? "Finish" : "Next") : "Skip";
    this.next.title = guide.done ? "Go on now" : "Go on without doing this";
    this.keep.hidden = !(view === "end" && lending);
    this.mine.hidden = this.keep.hidden;
  }

  /** Tells the page how tall the card is and how far up from the window's foot it reaches (its room under the wheel, and what keeps clear of it, go by that). */
  private tall(height: number, foot: number): void {
    const root = document.documentElement;
    for (const [name, value] of [["--guide-height", `${height}px`], ["--guide-foot", `${Math.max(0, Math.round(foot))}px`]] as const) {
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    }
  }

  /** Puts the card and the mark where they belong, now and once more in the next frame (by then the page has taken in what just changed). Only ever places: the focus is not touched here. */
  private place(): void {
    this.put();
    cancelAnimationFrame(this.again);
    this.again = requestAnimationFrame(() => {
      if (this.app.guide.view !== "off") this.put();
    });
  }

  private put(): void {
    const { app, card, mark, room } = this;
    const guide = app.guide;
    const root = document.documentElement;
    if (guide.view === "off") {
      room.hidden = true;
      mark.hidden = true;
      delete root.dataset.guide;
      root.style.removeProperty("--guide-height");
      root.style.removeProperty("--guide-foot");
      return;
    }
    // Under the wheel on a laptop; along the foot of the window where the page scrolls, and on the stage.
    const docked = window.matchMedia(LAPTOP).matches && !app.stage;
    card.classList.toggle("sheet", !docked);
    root.dataset.guide = docked ? "docked" : "sheet";
    room.hidden = !docked;
    if (docked) {
      const column = room.parentElement?.getBoundingClientRect();
      if (column) {
        card.style.left = `${column.left}px`;
        card.style.width = `${column.width}px`;
      }
      root.style.setProperty("--guide-height", `${card.offsetHeight}px`);
      card.style.top = `${room.getBoundingClientRect().top}px`;
    } else {
      card.style.left = "";
      card.style.width = "";
      card.style.top = "";
    }
    this.tall(card.offsetHeight, window.innerHeight - card.getBoundingClientRect().top);

    const where = guide.mark;
    const target = where?.kind === "node" ? document.querySelector<HTMLElement>(where.selector) : where ? byId("kreisel") : null;
    // Where the page scrolls, the place a task names is brought into view once, above the card.
    // (Once for each place: a task may name a second one when its first half was done, and a place that is not on the
    // page yet is brought up when it comes.)
    const name = `${guide.chapter?.id ?? ""}.${guide.index}.${where?.kind === "node" ? where.selector : (where?.kind ?? "")}`;
    if (!docked && target && target.getClientRects().length > 0 && name !== this.broughtUp) {
      this.broughtUp = name;
      const box = target.getBoundingClientRect();
      const free = window.innerHeight - card.offsetHeight - 16;
      // A part of the page: its upper end, or all of it where it fits. The wheel: its middle in the middle of the
      // room above the card (the play button is there, and a wheel taller than that room shows as much as it can).
      const middle = where?.kind === "node" ? box.top + Math.min(box.height, free) / 2 : box.top + box.height / 2;
      if (box.top < 0 || box.bottom > free) window.scrollBy({ top: middle - free / 2, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    // A part of the page is marked by a ring around it; a ring of the wheel is marked by the wheel itself.
    const box = where?.kind === "node" && target && target.getClientRects().length > 0 ? target.getBoundingClientRect() : null;
    mark.hidden = box === null;
    if (box) {
      mark.style.left = `${box.left - HALO}px`;
      mark.style.top = `${box.top - HALO}px`;
      mark.style.width = `${box.width + HALO * 2}px`;
      mark.style.height = `${box.height + HALO * 2}px`;
    }
  }
}

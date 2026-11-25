import type { Project } from "../model";
import type { App, Deed, DeedSeen } from "./app";
import { CHAPTERS, plain, QUIET, tasksFor, type Chapter, type Mark, type Notes, type Task } from "./lessons";

/*
 * The guide: a card under the wheel that asks for one small thing at a time
 * and notices when it was done. It replaces the tour that showed seven parts
 * of the page in the dark: nothing is dimmed or locked here, the page is
 * played while the guide is up, and a task is over when what it asks for has
 * happened, by whatever hand.
 *
 * It never takes the focus by itself and never starts sound. On a first
 * visit the first lesson lies ready with its first task ("press play"); the
 * other lessons are started by whoever wants them. Where a lesson was left
 * and which were finished is kept in the browser.
 */

/** What the card shows: nothing, a task, the end of a lesson, or the list of lessons. */
export type GuideView = "off" | "task" | "end" | "list";

/** Kept in the browser: "1" once the first steps were put away or done (they come by themselves only before that). */
const SEEN = "kreisel.hinweis";
/** Kept in the browser: which lessons were finished and where one was left. */
const KEPT = "kreisel.lektionen";
/**
 * How long a task stays after it was done: at least as long as it says (so that what was made is heard), and long
 * enough to read what the card says then (a second and a half, and three tenths of a second a word). Shorter where it was done
 * already when it came. "Back" brings a task up again for whoever wants to read it once more.
 */
const LINGER = 1500;
const ALREADY = 900;
const READING = 1500;
const A_WORD = 300;
/** How often a task is asked whether it was done while nothing on the Kreisel changes (some are done by time passing: a round heard, a key let go). */
const TICK = 200;
/** For how long "Show me" is at work on a task at most: asked again within that time, it does nothing twice. */
const SHOWING = 3000;
/** For how long what "Show me" said is still unspoken (the card's announcer waits a little less than half a second). */
const UNSPOKEN = 400;

export class GuideDesk {
  view: GuideView = "off";
  chapter: Chapter | null = null;
  /** Which of the lesson's tasks is up, counted from 0 among those this visitor can do. */
  index = 0;
  /** The task that is up was done: it stays for a moment, then the next one comes. */
  done = false;
  /** What is said for whoever does not see the card, and how many things were said so far (each is said once). */
  said = "";
  saidCount = 0;
  /** How many tasks were done by doing: whoever draws the wheel answers each with a little cheer. */
  cheers = 0;
  /** The guide was just asked for by a control of the page: whoever shows the card puts the focus on it, once. */
  asked = false;
  /** The visitor uses a finger: the words say "tap", and what only a mouse or a key can do is left out. */
  touch = false;
  /** The lessons that were finished, and the one that was left in the middle. */
  readonly finished = new Set<string>();
  left: { id: string; index: number; did: number } | null = null;
  /** What a key is called on this keyboard (set by whoever knows the keyboard). */
  keyName: (code: string) => string = (code) => code.replace(/^Key|^Digit/, "");
  /** How many tasks of the lesson that is up were done (by doing, or shown): a lesson that was only skipped through is not finished. */
  did = 0;
  /** The lesson that just ended was only skipped through: its end says so instead of praising. */
  skipped = false;
  /** The guide was just put away with an offer in the page's message (what a lesson had built can be kept): whoever shows the card puts the keyboard's focus on that offer, once. */
  offered = false;
  /**
   * The task that is up was gone back to and holds already (it asks for play, and it plays): it is shown once more to
   * be read, as done, and stays until the visitor goes on. Nothing is ticked or cheered a second time.
   */
  revisited = false;
  /** The hint that was last said (a near miss is said once, not at every look). */
  private hinted = "";
  /** The lesson that had the table has given it back at its end (kept or not): its end card may stay. */
  private settled = false;
  /** Counts the tasks that came up: what "Show me" set going for one task does not reach into the next. */
  private serial = 0;
  /** What "Show me" says it did, while it is doing it: a task that is done in the same breath says both. */
  private showing = "";
  /** When "Show me" was last asked for, and for which task: asked twice in a row, it does its work once. */
  private shownAt = -Infinity;
  private shownFor = -1;
  /** Which recordings the browser kept when a lesson took the table (`null` until that is known): what the lesson resampled on its copy goes with the copy. */
  private keptBefore: readonly string[] | null = null;
  private loan = 0;
  private notes: Notes = {};
  private deeds: DeedSeen[] = [];
  private ticking: ReturnType<typeof setInterval> | null = null;
  private moving: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: App) {
    try {
      const kept = JSON.parse(localStorage.getItem(KEPT) ?? "null") as { done?: unknown; at?: unknown } | null;
      const known = (id: unknown): id is string => typeof id === "string" && CHAPTERS.some((chapter) => chapter.id === id);
      if (Array.isArray(kept?.done)) for (const id of kept.done) if (known(id)) this.finished.add(id);
      const at = kept?.at;
      if (Array.isArray(at) && known(at[0]) && typeof at[1] === "number" && Number.isInteger(at[1]) && at[1] >= 0) {
        this.left = { id: at[0], index: at[1], did: typeof at[2] === "number" && Number.isInteger(at[2]) && at[2] >= 0 ? at[2] : 0 };
      }
    } catch {
      // Nothing kept, or nothing readable: the guide starts from the beginning.
    }
  }

  // ---- reading ----------------------------------------------------------------

  get tasks(): readonly Task[] {
    return this.chapter ? tasksFor(this.chapter, this.touch) : [];
  }

  /** The task that is up. */
  get task(): Task | null {
    return this.view === "task" ? (this.tasks[this.index] ?? null) : null;
  }

  /** Where the task that is up happens: marked on the page until it was done. */
  get mark(): Mark | null {
    const task = this.task;
    return task && (!this.done || this.revisited) ? task.mark(this.app) : null;
  }

  /** "Show me" would start the Kreisel now (the task that is up needs it to play, and it stands): the button says so. */
  get starts(): boolean {
    const task = this.task;
    return task?.starts === true && !this.done && !this.app.playing;
  }

  /** The task's sentence for this visitor's hand (with its place still in brackets and its keys as tokens), and the keyboard's way. */
  get line(): string {
    const task = this.task;
    return task ? ((this.touch ? task.touch : undefined) ?? task.line) : "";
  }

  get keys(): string {
    return this.touch ? "" : (this.task?.keys ?? "");
  }

  /**
   * What the card adds while a task is up and something is in its way: the visitor did something close to it but not
   * it (a hit in the wrong ring), or the task is about sound and nothing plays. Empty while all is well.
   */
  get hint(): string {
    const task = this.task;
    if (!task || this.done) return "";
    const miss = task.miss?.(this.app, this.notes) ?? null;
    if (miss !== null) return miss;
    return task.quiet && !this.app.playing ? (this.touch ? QUIET.touch : QUIET.mouse) : "";
  }

  /** The lesson to go on with: the first that was not finished yet (other than the one that is up). `null` when all were. */
  get upNext(): Chapter | null {
    return CHAPTERS.find((chapter) => !this.finished.has(chapter.id) && chapter.id !== this.chapter?.id) ?? null;
  }

  /** Where the guide is found again, in the words of this visitor's page (a phone has no question mark in its bar). */
  get where(): string {
    return this.touch ? "in the menu behind the three dots" : "under the question mark at the top";
  }

  /** Whether a deed of this kind was seen since the task came up. */
  heard(what: Deed["what"]): boolean {
    return this.deeds.some((deed) => deed.what === what);
  }

  /**
   * `run`, for later, as long as the task that is up now is still up then. "Show me" writes with this: a guide that
   * was put away, or went on, writes nothing more into the Kreisel.
   */
  whileUp(run: () => void): () => void {
    const serial = this.serial;
    return () => {
      if (this.view === "task" && this.serial === serial && !this.done) run();
    };
  }

  /** The visitor's hand changed (a finger instead of a mouse, or back): the words change, and so may the tasks there are. */
  setTouch(touch: boolean): void {
    if (touch === this.touch) return;
    this.touch = touch;
    if (this.view === "task") this.bring(Math.min(this.index, this.tasks.length - 1), "");
    else this.app.notify();
  }

  /** Whether the first steps still come by themselves: nobody has put them away or done them in this browser. */
  get fresh(): boolean {
    try {
      return localStorage.getItem(SEEN) !== "1";
    } catch {
      return true;
    }
  }

  // ---- coming and going ----------------------------------------------------------

  /** A first visit: the first steps lie ready under the wheel. Nothing takes the focus and nothing sounds. */
  arrive(): void {
    if (!this.fresh || this.view !== "off") return;
    const first = CHAPTERS[0];
    if (first) this.begin(first, this.left?.id === first.id ? this.left.index : 0, this.left?.id === first.id ? this.left.did : 0, "A guide lies under the wheel: F6 goes to it, Escape puts it away. ");
  }

  /**
   * The guide was asked for: the list of lessons comes up, and the focus goes to the card. A lesson that is up is
   * left where it is and can be gone on with from the list; only one that has the table (its own Kreisel is on it)
   * stays up, so that what was built is not swept away by a look at the list.
   */
  open(): void {
    this.asked = true;
    const lending = this.chapter?.lends !== undefined && this.app.store.lending;
    if (this.view !== "list" && !lending) {
      this.leave();
      this.view = "list";
      this.chapter = null;
      this.say(`Lessons. ${CHAPTERS.length} to pick from; each takes a minute or two.`);
    }
    this.app.notify();
  }

  /** Starts a lesson because the visitor picked it: from its beginning, or where it was left. */
  start(id: string, resume = false): void {
    const chapter = CHAPTERS.find((one) => one.id === id);
    if (!chapter) return;
    this.asked = true;
    const left = resume && this.left?.id === id ? this.left : null;
    this.begin(chapter, left?.index ?? 0, left?.did ?? 0);
  }

  /**
   * Puts the guide away. A lesson that had the table gives it back (what it had built is offered once more in the
   * page's message, which stays until it is answered); where a lesson on the visitor's own Kreisel was left is kept.
   * The page's message says where the guide is found again. Put away `quietly`, nothing is offered and the page's
   * message is left alone: the page has just said something of its own (a link was opened), and only the guide's
   * announcer says that the guide is closed.
   */
  close(quietly = false): void {
    if (this.view === "off") return;
    // Whatever the lesson had built on a table of its own (also at its end, before "Keep it" was answered).
    const made = this.leave();
    this.view = "off";
    this.chapter = null;
    this.seen();
    this.keep();
    // Always said where it waits: nobody should have to look for it. Said once: by the page's message, or (where
    // the page has just said something of its own) by the guide's announcer.
    if (quietly) this.say(`The guide is closed. You find it again ${this.where}.`);
    else if (made) {
      // What was being built in a lesson that had the table is not thrown away without a word: it can be had back,
      // and that offer does not leave by itself (there is no other way to it afterwards).
      this.offered = true;
      this.app.say(`Your own Kreisel is back. The guide waits ${this.where}.`, {
        label: "Keep what I built",
        // Said what happened, with the way back: a press by mistake (the space bar, out of habit) is one press undone.
        run: () => {
          this.app.store.replace(made);
          this.app.say("What you built is on the table. The Kreisel you had is one step back.", this.app.takeBack);
        },
      }, true);
    } else this.app.say(`The guide waits ${this.where}.`);
    this.app.notify();
  }

  /** The end of a lesson that brought its own Kreisel: what was made stays on the table (the visitor's own is one step back), or the visitor's own comes back. */
  settle(keep: boolean): void {
    if (!this.app.store.lending) return;
    this.settled = true;
    this.asked = true;
    this.app.store.giveBack(keep);
    if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
    // Given back for good: what the lesson resampled on its copy is not left lying among the kept recordings.
    if (!keep && this.keptBefore) void this.app.sample.forgetSince(this.keptBefore);
    this.app.say(keep ? "It is yours now. The Kreisel you had before is one step back." : "Your own Kreisel is back on the table, as it was.", keep ? this.app.takeBack : undefined);
    this.app.notify();
  }

  // ---- through a lesson -----------------------------------------------------------

  /** The next task, because the visitor asked for it (a task need not be done to go on). */
  next(): void {
    if (this.view !== "task") return;
    this.asked = true;
    this.forward();
  }

  /** The task before. */
  back(): void {
    if (this.view !== "task" || this.index === 0) return;
    this.asked = true;
    this.bring(this.index - 1, "", true);
  }

  /** "Show me": the task is done once for the visitor, who sees and hears what it is. */
  show(): void {
    const task = this.task;
    if (!task || this.done) return;
    this.asked = true;
    // Asked twice in a row (a double click, or impatience while it is being done): it is done once.
    const now = performance.now();
    if (this.shownFor === this.serial && now - this.shownAt < SHOWING) {
      this.app.notify();
      return;
    }
    this.shownFor = this.serial;
    this.shownAt = now;
    // What was done for the visitor is said; where the task is found done in the same breath, "Done" is said with it.
    this.showing = task.shown;
    task.show(this.app);
    if (!this.done) this.say(task.shown);
    this.app.notify();
  }

  /** A deed was reported (dice rolled, a step taken back, a link copied): a task may have asked for just that. */
  note(deed: Deed): void {
    if (this.view !== "task") return;
    this.deeds.push("track" in deed ? { what: deed.what, track: deed.track } : { what: deed.what });
    this.check();
  }

  /** The Kreisel has changed, or a moment has passed: the task that is up is asked whether it was done. */
  check(): void {
    // The lesson had the table and has it no longer (the visitor opened a link or started anew): the guide steps aside.
    if (this.view !== "off" && this.view !== "list" && this.chapter?.lends && !this.app.store.lending && !this.settled) {
      this.close(true);
      return;
    }
    const task = this.task;
    if (!task || this.done) return;
    if (task.done(this.app, this.notes, this.deeds)) {
      this.complete(task, LINGER);
      return;
    }
    // A near miss is answered once, in words (the card shows it for as long as it holds).
    const hint = task.miss?.(this.app, this.notes) ?? "";
    if (hint !== this.hinted) {
      this.hinted = hint;
      if (hint !== "") {
        this.say(hint);
        this.app.notify();
      }
    }
  }

  private complete(task: Task, least: number): void {
    this.done = true;
    this.did += 1;
    this.cheers += 1;
    this.stop();
    const after = task.after ?? "";
    // (What "Show me" did is said along if it has not been spoken yet: the announcer speaks half a second late.)
    const shown = this.showing !== "" && performance.now() - this.shownAt < UNSPOKEN ? this.showing : "";
    this.showing = "";
    this.say(`${shown} Done. ${after}`.trim());
    const reading = READING + A_WORD * after.split(/\s+/).filter(Boolean).length;
    this.moving = setTimeout(() => this.forward(), least === ALREADY ? ALREADY : Math.max(task.linger ?? least, reading));
    this.app.notify();
  }

  private forward(): void {
    this.stop();
    if (this.index >= this.tasks.length - 1) this.finish();
    else this.bring(this.index + 1, "");
  }

  private begin(chapter: Chapter, index: number, did = 0, lead = ""): void {
    this.leave();
    // A look back at an old turn of a round ends: a lesson is done on the Kreisel of now.
    this.app.relay.look(null);
    this.chapter = chapter;
    this.settled = false;
    this.did = did;
    this.skipped = false;
    this.view = "task";
    this.keptBefore = null;
    this.loan += 1;
    if (chapter.lends) {
      // Its own Kreisel comes onto the table; the visitor's is set aside whole and comes back afterwards.
      this.app.store.lend(chapter.lends(this.app));
      if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
      const loan = this.loan;
      void this.app.sample.keptIds().then((ids) => {
        if (this.loan === loan) this.keptBefore = ids;
      });
    }
    const tasks = tasksFor(chapter, this.touch);
    this.bring(Math.min(Math.max(0, index), tasks.length - 1), `${lead}${chapter.name}. `);
  }

  private bring(index: number, lead: string, again = false): void {
    this.stop();
    this.serial += 1;
    this.index = index;
    this.done = false;
    this.revisited = false;
    this.notes = {};
    this.deeds = [];
    this.hinted = "";
    this.showing = "";
    const task = this.tasks[index];
    if (!task) return;
    task.begin?.(this.app, this.notes);
    // Where a lesson on the visitor's own Kreisel was left is kept; one on a table of its own begins anew each time
    // (and leaves alone what is kept of another).
    if (this.chapter && !this.chapter.lends) this.left = { id: this.chapter.id, index, did: this.did };
    this.keep();
    // One message a step: the count, the sentence, and the keyboard's way or (where it holds) that nothing plays
    // yet. Not both: it is spoken over music.
    const quiet = task.quiet && !this.app.playing ? ` ${this.touch ? QUIET.touch : QUIET.mouse}` : "";
    const keys = quiet === "" && this.keys ? ` ${plain(this.keys, this.keyName)}` : "";
    this.say(`${lead}Step ${index + 1} of ${this.tasks.length}. ${plain(this.line, this.keyName)}${keys}${quiet}`);
    // A task that asks for what is so already (a Kreisel that plays is asked to play) is ticked and passed. Gone back
    // to, it is not passed again: it stays to be read, as done, until the visitor goes on.
    if (!task.done(this.app, this.notes, this.deeds)) this.ticking = setInterval(() => this.check(), TICK);
    else if (again) {
      this.done = true;
      this.revisited = true;
      this.say(`Step ${index + 1} of ${this.tasks.length}, done already. ${plain(this.line, this.keyName)}`);
    } else this.complete(task, ALREADY);
    this.app.notify();
  }

  private finish(): void {
    const chapter = this.chapter;
    if (!chapter) return;
    // A lesson is finished when something of it was done. Skipped through, it stays open: nothing was tried yet.
    this.skipped = this.did === 0;
    if (!this.skipped) this.finished.add(chapter.id);
    if (this.left?.id === chapter.id) this.left = null;
    if (chapter.id === CHAPTERS[0]?.id) this.seen();
    this.keep();
    this.view = "end";
    this.say(this.ending);
    this.app.notify();
  }

  /** What the card says at the end of the lesson that is up. */
  get ending(): string {
    const chapter = this.chapter;
    if (!chapter) return "";
    if (this.skipped) return `You skipped through “${chapter.name}”. It waits with the other lessons whenever you want to try it.`;
    const keep = chapter.lends && this.app.store.lending ? " Keep what you made, or go back to the Kreisel you had?" : "";
    return `${chapter.end}${keep}`;
  }

  /**
   * Leaves whatever is up: timers stop, and a lesson that had the table gives it back. Gives what the lesson had
   * built (its Kreisel), or `null` if no lesson had the table.
   */
  private leave(): Project | null {
    this.stop();
    this.done = false;
    this.revisited = false;
    this.serial += 1;
    if (this.chapter?.lends === undefined || !this.app.store.lending) return null;
    const made = this.app.store.giveBack();
    if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
    return made;
  }

  private stop(): void {
    if (this.ticking !== null) clearInterval(this.ticking);
    if (this.moving !== null) clearTimeout(this.moving);
    this.ticking = null;
    this.moving = null;
  }

  private say(text: string): void {
    this.said = text;
    this.saidCount += 1;
  }

  private seen(): void {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // Not kept: the first steps come again next time.
    }
  }

  private keep(): void {
    try {
      localStorage.setItem(KEPT, JSON.stringify({ done: [...this.finished], at: this.left ? [this.left.id, this.left.index, this.left.did] : null }));
    } catch {
      // Not kept: it holds for this visit.
    }
  }
}

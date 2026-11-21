import { BAR, clone, currentScene, SCENE_COUNT, SCENE_NAMES, wrap, type Project } from "../model";
import { layRound, MAX_ROUNDS, moveRound, removeRound, roundOnceLaid, roundOnceMoved, roundOnceRemoved, withoutScene } from "../order";
import type { App } from "./app";

/** What plays: the scene on the table round and round, the row, or the piece. */
export type Plays = "scene" | "row" | "piece";

/*
 * The eight scenes: picking, copying and clearing them. And the row
 * ("Folge") they are laid into: which scene plays when, round by round.
 */
export class SceneDesk {
  /** The round the row begins with at the next start: the one picked last while the Kreisel stood. */
  private begin: number | null = null;

  constructor(private readonly app: App) {}

  /** Changes the project, and says whether it could (while looking back at an old turn nothing can be changed). */
  private change(change: (project: Project) => void): boolean {
    if (this.app.store.locked) {
      this.app.store.refused();
      return false;
    }
    this.app.store.edit(change);
    return true;
  }

  get plays(): Plays {
    const project = this.app.project;
    return project.piece.on ? "piece" : project.chain ? "row" : "scene";
  }

  /** Says what plays. The piece and the row are left as they are laid; only which of them is heard changes. */
  setPlays(what: Plays): void {
    if (what === this.plays) return;
    const taken = this.change((project) => {
      project.piece.on = what === "piece";
      if (what !== "piece") project.chain = what === "row";
    });
    if (!taken) return;
    // The row answers by coming up under the wheel; the piece has nothing new to show, so it says what it does.
    if (what === "piece") this.app.say("Der Kreisel spielt jetzt nach dem Stück-Ring: außen ist viel los, innen wenig. Mal die Spannung in den Ring.");
  }

  /**
   * The round picked to begin with, as long as it still holds: its scene is the one on the table. Another scene
   * picked by hand, or another Kreisel on the table, and the row begins where that scene has its first round.
   */
  private get beginning(): number | null {
    const project = this.app.project;
    return this.begin !== null && project.order[this.begin] === project.scene ? this.begin : null;
  }

  /** The round that is marked in the row: the one that sounds, or, while the Kreisel stands, the one picked to begin with. */
  get round(): number | null {
    if (this.plays !== "row") return null;
    return this.app.playing ? this.app.engine.round : this.beginning;
  }

  /** How far the round that sounds has come: 0 at its start, 1 at its end. */
  roundDone(): number {
    const engine = this.app.engine;
    const steps = engine.roundCursor();
    const scene = engine.heard ? this.app.project.scenes[engine.heard.scene] : null;
    if (steps === null || !scene) return 0;
    return Math.max(0, Math.min(1, steps / (scene.chords.length * BAR)));
  }

  /** The scene that is heard right now; `null` while the Kreisel stands. */
  get sounding(): number | null {
    return this.app.playing ? (this.app.engine.heard?.scene ?? null) : null;
  }

  /** Where the row begins at the next start (for the engine). */
  startRound(): number | null {
    return this.plays === "row" ? this.beginning : null;
  }

  /** The round the Kreisel will jump to at the next bar line. */
  get queuedRound(): number | null {
    return this.app.engine.queuedRound;
  }

  /** One more round of `scene` in the row, before round `at` (at the end by default). */
  lay(scene: number, at?: number): void {
    const project = this.app.project;
    if (!project.scenes[scene]) return;
    if (project.order.length >= MAX_ROUNDS) {
      this.app.say(`Mehr als ${MAX_ROUNDS} Runden passen nicht in die Folge.`);
      return;
    }
    if (!this.change((draft) => { draft.order = layRound(draft.order, scene, at); })) return;
    if (at !== undefined) {
      // Whoever is in the middle of the row stays with its round.
      if (this.begin !== null) this.begin = roundOnceLaid(this.begin, at);
      this.app.engine.followRow((round) => roundOnceLaid(round, at));
    }
    // Laid from the scene's menu while the row is not on the page: say where it went.
    if (this.plays !== "row") this.app.say(`Szene ${SCENE_NAMES[scene]} liegt jetzt als ${this.app.project.order.length}. Runde in der Folge. Stell unter den Szenen auf „Folge“, dann spielt sie.`);
  }

  /** Round `round` once more, right after it. */
  repeatRound(round: number): void {
    const scene = this.app.project.order[round];
    if (scene !== undefined) this.lay(scene, round + 1);
  }

  /** Takes round `round` out of the row. The last one stays. */
  removeRound(round: number): void {
    const order = this.app.project.order;
    if (order.length <= 1 || order[round] === undefined) return;
    if (!this.change((draft) => { draft.order = removeRound(draft.order, round); })) return;
    const left = order.length - 1;
    if (this.begin !== null) this.begin = this.begin === round ? null : roundOnceRemoved(this.begin, round, left);
    // A jump to the round that is gone is off.
    if (this.app.engine.queuedRound === round) this.app.engine.queueRound(null);
    this.app.engine.followRow((at) => roundOnceRemoved(at, round, left));
  }

  /** Puts round `from` where round `to` is. */
  moveRound(from: number, to: number): void {
    const order = this.app.project.order;
    if (order[from] === undefined || from === to) return;
    if (!this.change((draft) => { draft.order = moveRound(draft.order, from, to); })) return;
    if (this.begin !== null) this.begin = roundOnceMoved(this.begin, from, to);
    this.app.engine.followRow((round) => roundOnceMoved(round, from, to));
  }

  /** Lets round `round` play another scene. */
  setRound(round: number, scene: number): void {
    const project = this.app.project;
    if (project.order[round] === undefined || project.order[round] === scene || !project.scenes[scene]) return;
    this.change((draft) => { draft.order[round] = scene; });
  }

  /**
   * Goes to round `round`: while the Kreisel plays, at the next bar line; while it stands, the round's scene comes on
   * the table and the row will begin there.
   */
  goTo(round: number): void {
    const scene = this.app.project.order[round];
    if (scene === undefined || !this.app.project.scenes[scene]) return;
    if (this.app.playing && this.plays === "row") {
      this.app.engine.queueRound(round);
      return;
    }
    this.begin = round;
    const old = this.app.relay.oldTurn;
    // Looking back, it is the old turn's table the scene comes onto.
    if (old) old.scene = scene;
    else if (this.app.project.scene !== scene) this.app.store.touch((project) => { project.scene = scene; });
    this.app.notify();
  }

  /** Plays the row from round `round`: starts the Kreisel there if it stands. */
  playFrom(round: number): void {
    if (this.plays !== "row") this.setPlays("row");
    this.goTo(round);
    if (!this.app.playing) this.app.togglePlay();
  }

  /** A filled scene comes up at the next bar; an empty one becomes a copy of the one on the table. */
  pick(index: number): void {
    if (index < 0 || index >= SCENE_COUNT) return;
    if (this.app.relay.oldTurn) {
      // Looking back: move through the old turn's scenes, nothing more.
      if (!this.app.relay.oldTurn.scenes[index]) return;
      if (this.app.playing && !this.app.relay.oldTurn.piece.on) this.app.engine.queueScene(index);
      else this.app.relay.oldTurn.scene = index;
      this.app.notify();
      return;
    }
    if (!this.app.project.scenes[index]) {
      const from = SCENE_NAMES[this.app.project.scene];
      // A new scene is a new part: it joins the row at its end (and can be taken out there again).
      this.app.store.edit((project) => {
        project.scenes[index] = clone(currentScene(project));
        project.order = layRound(project.order, index);
      });
      this.app.say(`Szene ${SCENE_NAMES[index]} ist eine Kopie von ${from}. Jetzt kannst du sie verändern.`);
    }
    if (this.app.playing && !this.app.project.piece.on) {
      this.app.engine.queueScene(index);
      this.app.notify();
    } else if (this.app.project.scene !== index) {
      // While a piece plays, the piece decides which scene sounds; this only puts a scene on the table (to change it, or to lay it on the piece).
      this.app.store.touch((project) => { project.scene = index; });
    }
  }

  /** Goes on to the next scene that is filled, forward (1) or back (−1); empty ones are passed over. */
  pickNext(direction: -1 | 1): void {
    for (let offset = 1; offset < SCENE_COUNT; offset += 1) {
      const index = wrap(this.app.project.scene + direction * offset, SCENE_COUNT);
      if (this.app.project.scenes[index]) {
        this.pick(index);
        return;
      }
    }
  }

  /** The first scene that is still empty, or −1. */
  free(): number {
    return this.app.project.scenes.findIndex((scene) => scene === null);
  }

  /** A copy of scene `index` in the first empty scene, put on the table. */
  copy(index: number): void {
    const free = this.free();
    const scene = this.app.project.scenes[index];
    if (free < 0 || !scene) return;
    this.app.store.edit((project) => {
      project.scenes[free] = clone(scene);
      project.order = layRound(project.order, free);
    });
    this.pick(free);
    this.app.say(`Szene ${SCENE_NAMES[free]} ist eine Kopie von ${SCENE_NAMES[index]}.`);
  }

  /** A copy of scene `from` in the empty scene `to`: a new part to change, at the end of the row. */
  copyTo(from: number, to: number): void {
    const scene = this.app.project.scenes[from];
    if (!scene || this.app.project.scenes[to] !== null || to < 0 || to >= SCENE_COUNT) return;
    const taken = this.change((project) => {
      project.scenes[to] = clone(scene);
      project.order = layRound(project.order, to);
    });
    if (!taken) return;
    this.pick(to);
    this.app.say(`Szene ${SCENE_NAMES[to]} ist eine Kopie von ${SCENE_NAMES[from]}.`);
  }

  clear(index: number): void {
    const filled = this.app.project.scenes.filter((scene) => scene !== null).length;
    if (!this.app.project.scenes[index] || filled <= 1) return;
    this.app.store.edit((project) => {
      project.scenes[index] = null;
      if (project.scene === index) project.scene = project.scenes.findIndex((scene) => scene !== null);
      // The piece cannot play a scene that is gone: its bars fall to the scene now on the table.
      project.piece.scenes = project.piece.scenes.map((scene) => (scene === index ? project.scene : scene));
      // Nor can the row: its rounds of that scene go.
      project.order = withoutScene(project.order, index, project.scene);
    });
    this.begin = null;
    if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
    this.app.say(`Szene ${SCENE_NAMES[index]} geleert.`, this.app.takeBack);
  }
}

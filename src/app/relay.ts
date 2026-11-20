import { packState, unpack } from "../codec";
import { clamp, MAX_NAME, MAX_TURNS, trackInfo, type Project, type Relay } from "../model";
import { changedRings, ringsWithContent } from "../relay";
import { readName, writeName } from "./prefs";
import type { App } from "./app";

/*
 * Reihum: a Kreisel that goes from hand to hand, turn by turn.
 */
export class RelayDesk {
  /** The name this person plays under (kept in this browser), and the rule a new round would start with. */
  name = readName();
  rule = 0;
  /** The turn being looked back at, and the Kreisel as it was then; `null` for the Kreisel as it is now. */
  lookBack: number | null = null;
  oldTurn: Project | null = null;
  /** Counts the project's changes: what was worked out about the turn in progress holds until the next one. */
  private stamp = 0;
  private turnMemo: { stamp: number; mine: number[]; heard: number[]; taken: number[] } | null = null;

  constructor(private readonly app: App) {}

  /** The project has changed: what was worked out about the turn in progress no longer holds. */
  changed(): void {
    this.stamp += 1;
  }

  /** The turns the Kreisel on the table has been through (also while looking back at one of them). */
  get round(): Relay | null {
    return this.app.store.project.relay;
  }

  /** What the turn in progress has touched, what the turn before it touched, and which rings were taken by then. */
  private turnState(): { mine: number[]; heard: number[]; taken: number[] } {
    const turns = this.round?.turns ?? [];
    const last = turns[turns.length - 1];
    if (!last) return { mine: [], heard: [], taken: [] };
    if (this.turnMemo?.stamp !== this.stamp) {
      this.turnMemo = {
        stamp: this.stamp,
        mine: changedRings(last.state, packState(this.app.store.project)),
        heard: changedRings(turns[turns.length - 2]?.state ?? null, last.state),
        taken: ringsWithContent(last.state),
      };
    }
    return this.turnMemo;
  }

  /** The rings touched in the turn in progress. */
  get turnRings(): number[] {
    return this.turnState().mine;
  }

  /** Stille Post, not yet revealed: a ring someone built earlier, other than the one just before, is out of sight and hearing. */
  veiled(track: number): boolean {
    const relay = this.round;
    if (!relay || relay.rule !== 2 || relay.open || relay.turns.length === 0 || this.oldTurn) return false;
    const { mine, heard, taken } = this.turnState();
    return taken.includes(track) && !heard.includes(track) && !mine.includes(track);
  }

  refuse(track: number): boolean {
    if (!this.veiled(track)) return false;
    this.app.say("Stille Post: Dieser Ring ist verdeckt, da hat schon jemand gebaut. Nimm einen, der noch leer ist.");
    return true;
  }

  setName(name: string): void {
    this.name = name.slice(0, MAX_NAME);
    writeName(this.name);
  }

  /** The rule of a round that has not begun; once the first turn is finished, the round keeps its rule. */
  setRule(rule: number): void {
    this.rule = clamp(rule, 0, 2);
    this.app.notify();
  }

  /**
   * Finishes the turn: the Kreisel as it is now joins the turns, and the link with all of them is copied.
   * Returns whether the turn counted (a rule may say no).
   */
  async finishTurn(): Promise<boolean> {
    if (this.oldTurn) {
      this.app.say("Geh erst zurück zu jetzt: Ein Rückblick ist kein Zug.");
      return false;
    }
    const name = this.name.trim();
    if (!name) {
      this.app.say("Trag erst deinen Namen ein, damit die anderen wissen, von wem der Zug ist.");
      return false;
    }
    const relay = this.round;
    const rule = relay ? relay.rule : this.rule;
    const state = packState(this.app.store.project);
    const last = relay?.turns[relay.turns.length - 1]?.state ?? null;
    const touched = last === null ? ringsWithContent(state) : changedRings(last, state);
    const names = touched.map((ring) => trackInfo(ring).name).join(", ");
    if (last !== null && JSON.stringify(last) === JSON.stringify(state)) {
      this.app.say("Du hast noch nichts verändert. Bau erst etwas, dann ist es ein Zug.");
      return false;
    }
    if (rule >= 1 && last !== null && touched.length > 1) {
      this.app.say(`Die Regel sagt: ein Ring pro Zug. Du hast ${touched.length} angefasst (${names}). Nimm mit Strg+Z etwas zurück.`);
      return false;
    }
    if (rule === 2 && touched.length !== 1) {
      this.app.say(touched.length === 0 ? "Stille Post: Bau erst deinen Ring." : `Stille Post beginnt mit einem einzigen Ring, hier spielen ${touched.length} (${names}). Fang mit einem leeren Kreisel an.`);
      return false;
    }
    this.app.store.edit((project) => {
      project.relay ??= { rule, open: false, turns: [] };
      project.relay.turns.push({ name, state });
      if (project.relay.turns.length > MAX_TURNS) project.relay.turns.shift();
    });
    const count = this.round?.turns.length ?? 1;
    const copied = (await this.app.files.copyLink()) === "copied";
    this.app.say(copied ? `Zug ${count} ist abgeschlossen und der Link kopiert. Schick ihn an die nächste Person.` : `Zug ${count} ist abgeschlossen. Der Link steht in der Adresszeile: von dort kopieren und weiterschicken.`);
    return true;
  }

  /** Stille Post is over: everyone sees and hears everything. */
  reveal(): void {
    if (!this.round || this.round.open) return;
    this.app.store.edit((project) => {
      if (project.relay) project.relay.open = true;
    });
    this.app.say("Aufgedeckt! Jetzt hören alle alles.");
  }

  /** Forgets the turns; the Kreisel stays as it is. */
  end(): void {
    if (!this.round) return;
    this.look(null);
    this.app.store.edit((project) => { project.relay = null; });
    this.app.say("Reihum ist beendet, die Züge sind vergessen.", this.app.takeBack);
  }

  /** Looks back at the Kreisel as it was after turn `index`, or returns to now (`null`). Nothing can be changed while looking back. */
  look(index: number | null): void {
    const relay = this.round;
    const turn = index === null ? null : relay?.turns[index];
    if (index !== null && relay?.rule === 2 && !relay.open) {
      this.app.say("Stille Post: Zurückhören geht erst nach dem Aufdecken.");
      return;
    }
    if (!turn) {
      if (this.oldTurn === null) return;
      this.oldTurn = null;
      this.lookBack = null;
    } else {
      try {
        this.oldTurn = unpack(turn.state, true);
      } catch {
        return;
      }
      this.lookBack = index;
      this.app.workshop = null;
    }
    this.app.store.locked = this.oldTurn !== null;
    this.changed();
    this.app.engine.sync();
    if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
    this.app.notify();
  }

  /** Goes on building from an old turn: the Kreisel becomes what it was then, and the later turns are dropped. */
  continueFrom(index: number): void {
    const relay = this.round;
    const turn = relay?.turns[index];
    if (!relay || !turn) return;
    this.look(null);
    let project: Project;
    try {
      project = unpack(turn.state, true);
    } catch {
      return;
    }
    project.relay = { rule: relay.rule, open: relay.open, turns: relay.turns.slice(0, index + 1) };
    this.app.store.replace(project);
    if (this.app.playing) this.app.engine.queueScene(project.scene);
    this.app.say(`Du baust von Zug ${index + 1} weiter. Die späteren Züge sind abgezweigt.`, this.app.takeBack);
  }
}

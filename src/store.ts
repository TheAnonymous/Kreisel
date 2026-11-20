import { deserialize, serialize } from "./codec";
import { technoProject, type Project } from "./model";

/*
 * The project on the table, with undo. Every edit goes through `edit`, which
 * keeps the state before it; edits with the same key in quick succession (a
 * slider being dragged) count as one step back.
 */

/** Where the browser keeps the Kreisel on the table. */
export const STORAGE_KEY = "kreisel.projekt.v1";
const BACKUP_KEY = "kreisel.vorher.v1";
const HISTORY = 200;
const COALESCE_MS = 900;

export class Store {
  project: Project;
  private past: string[] = [];
  private future: string[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** While locked (looking back at an old turn), nothing can be changed; `refused` hears every attempt. */
  locked = false;
  refused: () => void = () => undefined;

  constructor(project?: Project) {
    this.project = project ?? Store.load() ?? technoProject();
  }

  static load(): Project | null {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      return text ? deserialize(text) : null;
    } catch {
      return null;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes the project; edits with the same `key` less than `within` ms apart are one undo step. */
  edit(change: (project: Project) => void, key?: string, within = COALESCE_MS): void {
    if (this.locked) {
      this.refused();
      return;
    }
    const now = Date.now();
    const sameGesture = key !== undefined && key === this.lastKey && now - this.lastAt < within;
    if (!sameGesture) this.remember();
    this.lastKey = key ?? null;
    this.lastAt = now;
    change(this.project);
    this.changed();
  }

  /** A change that is not worth an undo step: which scene is on the table. */
  touch(change: (project: Project) => void): void {
    change(this.project);
    this.changed();
  }

  /** Ends a gesture, so the next edit with the same key is its own undo step. */
  settle(): void {
    this.lastKey = null;
  }

  /** Takes back a gesture that is still going on (a touch that turned out to be a long press), as if it had not begun. */
  cancel(key: string): void {
    if (this.locked || key !== this.lastKey) return;
    const previous = this.past.pop();
    if (previous !== undefined) this.restore(previous);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    if (this.locked) {
      this.refused();
      return false;
    }
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(serialize(this.project));
    this.restore(previous);
    return true;
  }

  redo(): boolean {
    if (this.locked) {
      this.refused();
      return false;
    }
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(serialize(this.project));
    this.restore(next);
    return true;
  }

  /** Puts another project on the table (a shared link, a fresh start); undo brings the old one back. */
  replace(project: Project): void {
    this.remember();
    this.lastKey = null;
    this.project = project;
    this.changed();
  }

  /** Keeps the current project aside before a shared one replaces it, even across reloads. */
  backup(): void {
    try {
      localStorage.setItem(BACKUP_KEY, serialize(this.project));
    } catch {
      // No storage: undo still has it for this visit.
    }
  }

  private remember(): void {
    this.past.push(serialize(this.project));
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }

  private restore(text: string): void {
    // The snapshot also says which scene was on the table, so the undone change is in view.
    this.project = deserialize(text);
    this.lastKey = null;
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  save(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, serialize(this.project));
    } catch {
      // Private mode or a full disk: the Kreisel still plays, it just is not kept.
    }
  }
}

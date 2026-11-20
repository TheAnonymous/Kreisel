import { clone, currentScene, SCENE_COUNT, SCENE_NAMES } from "../model";
import type { App } from "./app";

/*
 * The eight scenes: picking, copying and clearing them.
 */
export class SceneDesk {
  constructor(private readonly app: App) {}

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
      this.app.store.edit((project) => { project.scenes[index] = clone(currentScene(project)); });
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

  /** The first scene that is still empty, or −1. */
  free(): number {
    return this.app.project.scenes.findIndex((scene) => scene === null);
  }

  /** A copy of scene `index` in the first empty scene, put on the table. */
  copy(index: number): void {
    const free = this.free();
    const scene = this.app.project.scenes[index];
    if (free < 0 || !scene) return;
    this.app.store.edit((project) => { project.scenes[free] = clone(scene); });
    this.pick(free);
    this.app.say(`Szene ${SCENE_NAMES[free]} ist eine Kopie von ${SCENE_NAMES[index]}.`);
  }

  clear(index: number): void {
    const filled = this.app.project.scenes.filter((scene) => scene !== null).length;
    if (!this.app.project.scenes[index] || filled <= 1) return;
    this.app.store.edit((project) => {
      project.scenes[index] = null;
      if (project.scene === index) project.scene = project.scenes.findIndex((scene) => scene !== null);
      // The piece cannot play a scene that is gone: its bars fall to the scene now on the table.
      project.piece.scenes = project.piece.scenes.map((scene) => (scene === index ? project.scene : scene));
    });
    if (this.app.playing) this.app.engine.queueScene(this.app.project.scene);
    this.app.say(`Szene ${SCENE_NAMES[index]} geleert.`, this.app.takeBack);
  }
}

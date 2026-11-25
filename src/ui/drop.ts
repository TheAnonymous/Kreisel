import type { App } from "../app/app";
import { BUNDLE_ENDING } from "../bundle";
import { trackInfo } from "../model";
import { soundLike } from "../sample-files";
import { byId } from "./dom";

/*
 * Sound files that are dropped on the page or pasted into it. Both are
 * shortcuts for "Load a file" in the sampler: the sound goes to the ring in
 * focus, and the ring's panel turns over to the sampler so that what happened
 * is in view. A Kreisel's own file (the Kreisel with its recordings) comes in
 * the same way.
 */

const wanted = (file: File): boolean => soundLike(file.name, file.type) || file.name.toLowerCase().endsWith(BUNDLE_ENDING);

function take(app: App, files: readonly File[]): boolean {
  const sounds = files.filter(wanted);
  const [file] = sounds;
  if (!file) return false;
  // It goes to a ring: the one last in focus, also while the piece or the weather is.
  if (app.focus !== "ring") app.select(app.selected);
  if (!app.sample.open) app.sample.toggle();
  // A ring takes one recording: of several files the first is taken, and that is said.
  void app.sample.bring(file, file.name, sounds.length > 1 ? `the first of ${sounds.length} files` : "");
  return true;
}

export function bindDrop(app: App): void {
  const root = document.documentElement;
  // Entering a child counts as entering again: only when every entry has been left is the drag gone.
  let inside = 0;
  const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const over = (): void => {
    inside = 0;
    delete root.dataset.dropping;
    delete byId("stage").dataset.drop;
  };
  window.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    inside += 1;
    root.dataset.dropping = "true";
    // The hint over the wheel names the ring the sound will go to (the one last in focus).
    byId("stage").dataset.drop = `Drop the sound: it goes to ${trackInfo(app.selected).name}`;
  });
  window.addEventListener("dragleave", (event) => {
    if (!carriesFiles(event)) return;
    inside -= 1;
    if (inside <= 0) over();
  });
  window.addEventListener("dragover", (event) => {
    if (!carriesFiles(event)) return;
    // Without this the browser would open the file instead of handing it over.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    over();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!take(app, files)) app.say(files.length > 0 ? `“${files[0]?.name ?? "This"}” is not a sound file. The sampler takes WAV, AIFF, MP3, Ogg, Opus, FLAC and M4A.` : "Nothing was dropped.");
  });
  window.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0 && take(app, files)) event.preventDefault();
  });
}

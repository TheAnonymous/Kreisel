import { TRACK_COUNT, trackInfo, type Scene } from "../model";
import { activeSteps } from "../patterns";

/*
 * A scene as a small wheel: every ring's hits where they lie, in the ring's
 * colour. Enough to tell a full scene from a bare one, and one scene from
 * another, without going there.
 */

/** Draws `scene` into `canvas`, which is `size` CSS pixels wide and high. */
export function drawScene(canvas: HTMLCanvasElement, scene: Scene, size: number): void {
  const pixels = Math.round(size * Math.min(3, window.devicePixelRatio || 1));
  if (canvas.width !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, pixels, pixels);
  const middle = pixels / 2;
  context.lineWidth = pixels * 0.04;
  for (let track = 0; track < TRACK_COUNT; track += 1) {
    const pattern = scene.patterns[track];
    if (!pattern) continue;
    // The kick is the innermost ring, the melody the outermost, as on the wheel itself.
    const radius = pixels * (0.11 + 0.056 * track);
    context.strokeStyle = "rgba(128, 128, 128, 0.22)";
    context.beginPath();
    context.arc(middle, middle, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = trackInfo(track).color;
    const width = (Math.PI * 2) / pattern.len;
    for (const step of activeSteps(pattern)) {
      const from = step * width - Math.PI / 2;
      context.beginPath();
      context.arc(middle, middle, radius, from, from + width * 0.7);
      context.stroke();
    }
  }
}

/** What of a scene its small wheel shows: where this is the same, so is the picture. */
export function sceneLooks(scene: Scene | null | undefined): string {
  return scene ? scene.patterns.map((pattern) => `${pattern.len}:${activeSteps(pattern).join(".")}`).join("|") : "";
}

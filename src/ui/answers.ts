/*
 * The little motions a node plays once, when something was done or has changed: a tin toy on a paper table, so
 * things hop into place and click, quickly. What goes with a state or with something appearing is in the style
 * sheet (under "motion"); what the wheel does is drawn on its canvas (ring.ts, motion.ts).
 */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SNAP = "cubic-bezier(0.2, 0.9, 0.3, 1)";
const MOTIONS = {
  /** Something clicks in: a chosen scene or sound, a switched sign. */
  pop: { frames: [{ transform: "scale(0.55)" }, { transform: "scale(1)" }], duration: 240, easing: SPRING },
  /** Dice. */
  tumble: { frames: [{ transform: "rotate(0deg)" }, { transform: "translateY(-4px) rotate(200deg)", offset: 0.45 }, { transform: "rotate(360deg)" }], duration: 420, easing: SNAP },
  /** The arrows of undo and redo wind back and on. */
  "wind-back": { frames: [{ transform: "rotate(0deg)" }, { transform: "rotate(-55deg)", offset: 0.35 }, { transform: "rotate(0deg)" }], duration: 300, easing: SNAP },
  "wind-on": { frames: [{ transform: "rotate(0deg)" }, { transform: "rotate(55deg)", offset: 0.35 }, { transform: "rotate(0deg)" }], duration: 300, easing: SNAP },
  /** A number that counts on. */
  tick: { frames: [{ opacity: 0.2, transform: "translateY(-5px)" }, { opacity: 1, transform: "translateY(0)" }], duration: 180, easing: SNAP },
  /** A tool that was taken up. */
  wiggle: { frames: [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(-14deg) scale(1.12)", offset: 0.3 }, { transform: "rotate(9deg) scale(1)", offset: 0.65 }, { transform: "rotate(0deg) scale(1)" }], duration: 300, easing: SNAP },
  /** A name that arrives. */
  "slide-in": { frames: [{ opacity: 0, transform: "translateX(-7px)" }, { opacity: 1, transform: "translateX(0)" }], duration: 240, easing: SNAP },
  /** The frame around what the keyboard is on lands there. */
  land: { frames: [{ outlineOffset: "8px" }, { outlineOffset: "2px" }], duration: 160, easing: SNAP },
} as const satisfies Record<string, { frames: Keyframe[]; duration: number; easing: string }>;
export type Motion = keyof typeof MOTIONS;
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Plays a motion on a node once, from its start even if it is still playing. Not for someone who asked for less motion. */
export function playMotion(node: Element | null, motion: Motion, delay = 0): void {
  if (!node || calm.matches) return;
  for (const running of node.getAnimations()) if (running.id === motion) running.cancel();
  const { frames, duration, easing } = MOTIONS[motion];
  node.animate([...frames], { id: motion, duration, easing, delay, fill: delay > 0 ? "backwards" : "none" });
}

/** A button answers that what it stands for was done: it lights up in a colour and fades back. */
export function flash(node: Element | null, color: string): void {
  if (!node || calm.matches) return;
  for (const running of node.getAnimations()) if (running.id === "flash") running.cancel();
  node.animate([{ backgroundColor: color }, { backgroundColor: getComputedStyle(node).backgroundColor }], { id: "flash", duration: 400, easing: "ease-out" });
}

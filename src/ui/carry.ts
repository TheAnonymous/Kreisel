/*
 * Carrying a thing across the page with the mouse: a scene into the row, a
 * round to another place in it. The thing is picked up once the pointer has
 * moved a little with the button down, a picture of it follows the pointer,
 * and whoever asked for it says where it may land. A finger does not carry:
 * on glass a press that rests is the menu, and a move is the page.
 */

export interface Carry<T> {
  /** What a press here picks up, or `null` for nothing. */
  take(): T | null;
  /** The picture that follows the pointer. */
  picture(carried: T): HTMLElement;
  /** Called as it is carried about: shows where it would land, and says whether it can land there. */
  over(carried: T, x: number, y: number): boolean;
  /** It was let go at this point. */
  drop(carried: T, x: number, y: number): void;
  /** Carrying is over, landed or not: puts away what `over` showed. */
  end(): void;
}

/** How far the pointer moves before a press becomes a carry. */
const SLACK = 6;

export function carryable<T>(node: HTMLElement, carry: Carry<T>): void {
  node.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || down.pointerType === "touch") return;
    let carried: T | null = null;
    let picture: HTMLElement | null = null;

    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key, true);
      picture?.remove();
      picture = null;
      if (carried !== null) carry.end();
      carried = null;
      delete document.documentElement.dataset.carrying;
    };
    const move = (event: PointerEvent): void => {
      if (carried === null) {
        if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < SLACK) return;
        carried = carry.take();
        if (carried === null) {
          stop();
          return;
        }
        picture = carry.picture(carried);
        picture.classList.add("carried");
        picture.setAttribute("aria-hidden", "true");
        picture.tabIndex = -1;
        document.body.append(picture);
        document.documentElement.dataset.carrying = "true";
      }
      if (picture) {
        picture.style.left = `${event.clientX}px`;
        picture.style.top = `${event.clientY}px`;
        picture.classList.toggle("lands", carry.over(carried, event.clientX, event.clientY));
      }
    };
    const up = (event: PointerEvent): void => {
      const had = carried;
      stop();
      if (had === null) return;
      // The click that comes with letting go is not a click on whatever lies there.
      const swallow = (click: MouseEvent): void => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      carry.drop(had, event.clientX, event.clientY);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || carried === null) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key, true);
  });
  // The browser's own dragging of pictures and text stays out of it.
  node.addEventListener("dragstart", (event) => event.preventDefault());
}

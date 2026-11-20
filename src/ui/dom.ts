/*
 * Small things every part of the page is built with: finding and making
 * nodes, and keeping a drag with the node it began on.
 */

export function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(className: string, label: string, title = ""): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  if (title) node.title = title;
  return node;
}

/** A button that shows a drawing instead of words; `label` says what it is to whoever cannot see it. */
export function iconButton(className: string, icon: string, label: string, title = label): HTMLButtonElement {
  const node = button(className, "", title);
  node.innerHTML = icon;
  node.setAttribute("aria-label", label);
  return node;
}

/** Keeps a drag with the element it began on, where the browser knows the pointer. */
export function capture(node: HTMLElement, event: PointerEvent): void {
  try {
    node.setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser no longer tracks: the gesture still works while it stays over the element.
  }
}

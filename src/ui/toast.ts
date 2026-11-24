import type { App } from "../app/app";
import { byId, el, button } from "./dom";

/*
 * The message at the foot of the page: what the app has just said, and what it offers with it.
 */
export class ToastView {

  constructor(private readonly app: App) {}

  sync(): void {
    const app = this.app;
    const node = byId("toast");
    if (app.files.exporting !== null) {
      node.hidden = false;
      node.replaceChildren(el("span", "", `Calculating Opus … ${Math.round(app.files.exporting * 100)} %`));
      node.dataset.text = "export";
      return;
    }
    const toast = app.toast;
    if (!toast) {
      node.hidden = true;
      node.dataset.text = "";
      return;
    }
    if (node.dataset.text === toast.text && !node.hidden) return;
    node.dataset.text = toast.text;
    const close = button("button icon small", "×");
    close.setAttribute("aria-label", "Close message");
    close.addEventListener("click", () => app.dismiss());
    const children: Node[] = [el("span", "", toast.text)];
    if (toast.action) {
      const action = toast.action;
      const act = button("button small", action.label);
      act.addEventListener("click", () => {
        action.run();
        app.dismiss();
      });
      children.push(act);
    }
    node.replaceChildren(...children, close);
    node.hidden = false;
  }
}

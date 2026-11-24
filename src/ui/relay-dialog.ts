import type { App } from "../app/app";
import { trackInfo } from "../model";
import { RULES, turnColor } from "../relay";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/*
 * The window of Reihum: the name, the rule, the turns so far, and the button that finishes a turn.
 */
export class RelayDialog {
  private readonly ruleInputs: HTMLInputElement[] = [];
  private turnsSignature = "";

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** Reihum: the window with the turns, and the bar shown while looking back. (It is opened from "Share".) */
  build(): void {
    const app = this.app;
    const dialog = byId<HTMLDialogElement>("reihum");
    const name = byId<HTMLInputElement>("relay-name");
    name.addEventListener("input", () => app.relay.setName(name.value));
    const rules = byId("relay-rules");
    RULES.forEach((rule, index) => {
      const label = el("label", "check");
      const input = el("input");
      input.type = "radio";
      input.name = "relay-rule";
      input.value = String(index);
      input.addEventListener("change", () => app.relay.setRule(index));
      label.append(input, el("span", "", rule.name));
      rules.append(label);
      this.ruleInputs.push(input);
    });
    const message = byId("relay-message");
    byId("relay-send").addEventListener("click", () => {
      void app.relay.finishTurn().then((done) => {
        if (done) {
          dialog.close();
          return;
        }
        // Why the turn did not count is said here, in the window, not on the page behind it.
        message.textContent = app.toast?.text ?? "";
        message.hidden = message.textContent === "";
        app.dismiss();
      });
    });
    dialog.addEventListener("input", () => { message.hidden = true; });
    byId("relay-reveal").addEventListener("click", () => {
      app.relay.reveal();
      dialog.close();
    });
    byId("relay-end").addEventListener("click", () => {
      app.relay.end();
      dialog.close();
    });
  }

  show(): void {
    const dialog = byId<HTMLDialogElement>("reihum");
    byId<HTMLInputElement>("relay-name").value = this.app.relay.name;
    byId("relay-message").hidden = true;
    this.turnsSignature = "";
    // Open first: the window's contents are only kept up to date while it is open.
    if (!dialog.open) dialog.showModal();
    this.sync();
  }

  /** The round on the bar's "Share", the window, the look-back bar, and the cloth over veiled rings. */
  sync(): void {
    const app = this.app;
    const relay = app.relay.round;
    const turns = relay?.turns ?? [];
    const veils = relay !== null && relay.rule === 2 && !relay.open && turns.length > 0;
    // While a round is going, "Share" says so: whose turn it is must not hide in a menu.
    const share = byId("share");
    const label = turns.length > 0 ? `Pass around · ${turns.length + 1}` : "Share";
    const name = share.querySelector(".label");
    if (name && name.textContent !== label) name.textContent = label;
    share.setAttribute("aria-label", turns.length > 0 ? `Share. Pass around: turn ${turns.length + 1} is yours` : "Share");
    share.dataset.round = String(turns.length > 0);

    const bar = byId("lookback");
    const looked = app.relay.lookBack;
    bar.hidden = looked === null;
    if (looked !== null && bar.dataset.turn !== String(looked)) {
      bar.dataset.turn = String(looked);
      const now = button("button small", "Back to now");
      now.addEventListener("click", () => app.relay.look(null));
      const from = button("button small", "Build on from here", "The Kreisel becomes again what it was after this turn; the later turns fall away");
      from.addEventListener("click", () => app.relay.continueFrom(looked));
      bar.replaceChildren(el("span", "", `Looking back: turn ${looked + 1} by ${turns[looked]?.name ?? ""}`), now, from);
    }
    if (looked === null) bar.dataset.turn = "";

    this.panels.trackRows.forEach((row, track) => {
      const veiled = app.relay.veiled(track);
      row.classList.toggle("veiled", veiled);
      if (veiled) row.querySelector(".sound")!.textContent = "covered";
      for (const node of row.querySelectorAll<HTMLButtonElement>(".mute, .roll")) node.disabled = veiled;
    });
    const veiled = !app.piece.focused && app.relay.veiled(app.selected);
    this.panels.veilBox.hidden = !veiled;
    if (veiled) {
      this.panels.ringBox.hidden = true;
      this.panels.veilBox.style.setProperty("--c", trackInfo(app.selected).color);
      this.panels.veilBox.querySelector("h2")!.textContent = trackInfo(app.selected).name;
    }

    if (!byId<HTMLDialogElement>("reihum").open) return;
    const rule = relay ? relay.rule : app.relay.rule;
    byId("relay-rules").hidden = turns.length > 0;
    this.ruleInputs.forEach((input, index) => { input.checked = index === rule; });
    byId("relay-rule").textContent = turns.length > 0
      ? `Rule of this round: ${RULES[rule]?.name ?? ""}. ${RULES[rule]?.hint ?? ""}${relay?.rule === 2 && relay.open ? " (Revealed.)" : ""}`
      : (RULES[rule]?.hint ?? "");
    byId("relay-turns-title").hidden = turns.length === 0;

    const signature = `${veils}|${turns.map((turn) => turn.name).join("|")}`;
    if (signature !== this.turnsSignature) {
      this.turnsSignature = signature;
      byId("relay-turns").replaceChildren(...turns.map((turn, index) => {
        const item = el("li", "turn");
        item.style.setProperty("--c", relay ? turnColor(relay, index) : "currentColor");
        const hear = button("button small", "Listen", veils ? "Only after the reveal" : `Hear the Kreisel as it was after turn ${index + 1}`);
        hear.disabled = veils;
        hear.addEventListener("click", () => {
          app.relay.look(index);
          byId<HTMLDialogElement>("reihum").close();
        });
        const from = button("button small", "On from here", veils ? "Only after the reveal" : "Build on anew from this turn; the later turns fall away");
        from.disabled = veils;
        from.addEventListener("click", () => {
          app.relay.continueFrom(index);
          byId<HTMLDialogElement>("reihum").close();
        });
        item.append(el("span", "dot"), el("span", "name", `Turn ${index + 1} · ${turn.name}`), hear, from);
        return item;
      }));
    }
    const touched = turns.length > 0 ? app.relay.turnRings.map((ring) => trackInfo(ring).name) : [];
    byId("relay-now").textContent = turns.length === 0
      ? "No turn yet. The first turn is the Kreisel as it is now."
      : touched.length > 0 ? `Your turn (no. ${turns.length + 1}): touched ${touched.join(", ")}.` : `Your turn (no. ${turns.length + 1}): nothing changed on the rings yet.`;
    byId("relay-reveal").hidden = !veils;
    byId("relay-end").hidden = relay === null;
  }
}

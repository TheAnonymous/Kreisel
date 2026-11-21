import type { App } from "../app/app";
import { button, el } from "./dom";
import type { Panels } from "./panels";

/*
 * The acid machine in a ring's panel: under the sound pad, which is its
 * filter (how far open from left to right, how much it rings from bottom to
 * top), a group of its own. How hard and how long the envelope bites, the
 * wave, and the filter ride.
 */
export class AcidPanel {
  private readonly group = el("div", "group acid");
  private readonly waves: HTMLButtonElement[] = [];

  constructor(private readonly panels: Panels, private readonly app: App) {}

  build(): HTMLElement {
    const app = this.app;
    const amounts = el("div", "lines");
    const amount = (label: string, field: "bite" | "decay", hint: string): void => {
      const line = el("label", "line");
      line.title = hint;
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = `acid-${field}`;
      this.panels.slider(input, () => app.acid.current?.[field] ?? 0, (value) => app.acid.shape({ [field]: value }, field), () => app.acid.reset(field));
      line.append(el("span", "label", label), input);
      amounts.append(line);
    };
    amount("Biss", "bite", "Wie weit jeder Ton den Filter aufreißt");
    amount("Dauer", "decay", "Wie langsam der Filter wieder zufällt; ein betonter Ton fällt immer schnell");
    const more = el("div", "line");
    more.setAttribute("role", "group");
    more.setAttribute("aria-label", "Welle und Filterfahrt");
    more.append(el("span", "label", "Welle"));
    for (const [index, name, hint] of [[0, "Säge", "Sägezahn: hell und schnarrend"], [1, "Rechteck", "Rechteck: hohl und hölzern"]] as const) {
      const chip = button("chip tiny", name, hint);
      chip.addEventListener("click", () => app.acid.shape({ square: index === 1 }));
      this.waves.push(chip);
      more.append(chip);
    }
    const ride = button("button small", "Filterfahrt", "Legt Sonne über den Ring, die mit dem Wind wandert: Der Filter öffnet und schließt sich von selbst");
    ride.id = "acid-ride";
    ride.addEventListener("click", () => app.acid.ride());
    more.append(ride);
    this.group.id = "acid";
    this.group.hidden = true;
    this.group.append(amounts, more);
    return this.group;
  }

  sync(): void {
    const acid = this.app.acid.on ? this.app.acid.current : null;
    this.group.hidden = acid === null;
    if (!acid) return;
    this.waves.forEach((chip, index) => chip.setAttribute("aria-pressed", String((index === 1) === acid.square)));
  }
}

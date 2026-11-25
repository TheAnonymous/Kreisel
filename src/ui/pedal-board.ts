import type { App } from "../app/app";
import { patternOf, trackInfo, trackOf } from "../model";
import { chainsFor, crestText, crushWord, describeChain, MODS, ORDERS, SPAN_NAMES, SPAN_SAYS, SPAN_SHORT, stations, sweeps, TONES, toneStation } from "../pedals";
import { button, byId, el } from "./dom";
import { onContext } from "./menu";
import type { Panels } from "./panels";

/**
 * A group of choices of which one is taken. It is one stop for the Tab key; the arrow keys go through it and take
 * what they land on, so stepping through the choices is hearing them.
 */
export function choices(holder: HTMLElement, label: string, options: readonly { name: string; hint: string; says?: string }[], pick: (index: number) => void): HTMLButtonElement[] {
  holder.setAttribute("role", "radiogroup");
  holder.setAttribute("aria-label", label);
  const nodes = options.map((option, index) => {
    const node = button("chip", option.name, option.hint);
    node.setAttribute("role", "radio");
    if (option.says) node.setAttribute("aria-label", option.says);
    node.addEventListener("click", () => pick(index));
    node.addEventListener("keydown", (event) => {
      const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (by === 0) return;
      // The arrows are the group's own here: the pointer on the wheel stays where it is.
      event.preventDefault();
      event.stopPropagation();
      const next = (index + by + options.length) % options.length;
      nodes[next]?.focus();
      pick(next);
    });
    holder.append(node);
    return node;
  });
  return nodes;
}

/** Marks which of a group's choices is taken: it is the one the Tab key stops at. */
export function take(nodes: readonly HTMLButtonElement[], chosen: number): void {
  nodes.forEach((node, index) => {
    node.setAttribute("aria-checked", String(index === chosen));
    node.tabIndex = index === chosen ? 0 : -1;
  });
}

/** Whether a node can take the focus right now: it is on the page and not inside anything hidden. */
export const reachable = (node: Element | null): node is HTMLElement => node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;

/*
 * The pedalboard: the second side of a ring's panel. A button in the ring's
 * Drive row turns the panel over, and the wheel stays in view beside it (the
 * mark of a sweep's top sits on the ring). From top to bottom: the chain as
 * a line of stations in the order the sound passes them, the ring's ready
 * chains, and the pedals themselves: the drive and its character, the
 * crusher, the modulation, the order.
 *
 * Every choice is a group the arrow keys go through, every amount a slider
 * that says its value in words. Nothing here needs a right click, a long
 * press or a drag: those are shortcuts for what a button or a slider does.
 */
export class PedalBoard {
  readonly box = el("div", "panel-box panel-pedals");
  /** The button in the ring's panel that turns it over, and what the ring wears, in words, for whoever asks. */
  readonly opener = button("button small pedals-open", "Pedals", "");
  private readonly wearing = el("span", "sr");
  private readonly name = el("h2");
  private readonly back = button("button small done", "‹ Ring", "Back to the ring (Esc)");
  private readonly chain = el("p", "pedal-chain");
  private readonly presets: HTMLButtonElement[] = [];
  private readonly none = button("chip", "None", "Take everything off: no drive, no pedals. Reverb and echo stay as they are");
  private tones: HTMLButtonElement[] = [];
  private mods: HTMLButtonElement[] = [];
  private spans: HTMLButtonElement[] = [];
  private orders: HTMLButtonElement[] = [];
  private readonly crushWord = el("output");
  private readonly crest = el("input");
  private readonly crestWord = el("output");
  private readonly sweepRows: HTMLElement[] = [];
  private readonly depthRow = el("label", "line");
  /** The ring whose chains the board shows, whether it was showing at all, and where the focus was before it came. */
  private shown = -1;
  private showing = false;
  private cameFrom: Element | null = null;

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** The button for the ring's Drive row, and beside it (unseen) what the ring wears. */
  buildOpener(): HTMLElement[] {
    const { app, opener, wearing } = this;
    opener.id = "pedals-open";
    opener.setAttribute("aria-expanded", "false");
    opener.setAttribute("aria-controls", "pedals");
    wearing.id = "pedals-wearing";
    opener.setAttribute("aria-describedby", wearing.id);
    opener.addEventListener("click", () => app.pedals.toggle());
    onContext(opener, () => app.pedals.dice());
    return [opener, wearing];
  }

  build(): HTMLElement {
    const { app, box } = this;
    box.id = "pedals";
    box.hidden = true;
    box.setAttribute("role", "group");
    const head = el("header", "panel-head");
    this.name.id = "pedals-title";
    // The heading takes the focus when the panel is turned over: whoever came by keyboard hears where they are, and the space bar still starts and stops.
    this.name.tabIndex = -1;
    box.setAttribute("aria-labelledby", this.name.id);
    const dice = button("button small", "Dice", "Put another of this ring's chains on it");
    dice.id = "pedals-dice";
    dice.addEventListener("click", () => app.pedals.dice());
    this.back.id = "pedals-done";
    this.back.addEventListener("click", () => app.pedals.close());
    head.append(el("span", "dot"), this.name, dice, this.back);

    this.chain.id = "pedal-chain";

    const chainsName = el("h3", "", "Chains");
    chainsName.id = "pedal-chains-name";
    const chains = el("div", "pedal-chains");
    chains.setAttribute("role", "group");
    chains.setAttribute("aria-labelledby", chainsName.id);
    for (let index = 0; index < 5; index += 1) {
      const chip = button("chip", "");
      chip.addEventListener("click", () => app.pedals.wear(index));
      chains.append(chip);
      this.presets.push(chip);
    }
    this.none.id = "pedal-none";
    this.none.addEventListener("click", () => app.pedals.strip());
    chains.append(this.none);

    const slide = (id: string, label: string, hint: string, row: HTMLElement = el("label", "line")): { row: HTMLElement; input: HTMLInputElement } => {
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = id;
      row.title = hint;
      row.append(el("span", "label", label), input);
      return { row, input };
    };
    /** A value shown beside its slider: the slider says the same itself, so this is for the eye only. */
    const shown = (output: HTMLOutputElement): HTMLOutputElement => {
      output.setAttribute("aria-hidden", "true");
      return output;
    };

    const drive = slide("pedal-drive", "Drive", "Pushes the ring into distortion. Sparks from the weather come on top.");
    this.panels.slider(drive.input, () => trackOf(app.project, app.selected).drive, (value) => app.rings.setTrack(app.selected, { drive: value }, "drive"), () => app.rings.resetTrack(app.selected, "drive"));
    const tones = el("div", "pedal-choice tones");
    tones.id = "pedal-tones";
    this.tones = choices(tones, "Character of the drive", TONES, (tone) => app.pedals.set({ tone }));

    const crush = slide("pedal-crush", "Crush", "Fewer levels and fewer samples a second: from a light grain to broken");
    this.panels.slider(crush.input, () => app.pedals.current.crush, (value) => app.pedals.set({ crush: value }, "crush"), () => app.pedals.reset("crush"), crushWord);
    crush.row.append(shown(this.crushWord));

    const modName = el("h3", "", "Modulation");
    modName.id = "pedal-mod-name";
    const mods = el("div", "pedal-choice mods");
    mods.id = "pedal-mods";
    this.mods = choices(mods, "Modulation", MODS, (mod) => app.pedals.set({ mod }));
    const depth = slide("pedal-depth", "Depth", "How deep the modulation goes", this.depthRow);
    this.panels.slider(depth.input, () => app.pedals.current.depth, (value) => app.pedals.set({ depth: value }, "depth"), () => app.pedals.reset("depth"));

    // Where the sweep has its top: a step of the ring. The slider goes round the ring once; the mark on the wheel goes with it.
    const peak = el("label", "line");
    peak.id = "pedal-crest-row";
    peak.title = "The step of the ring on which the sweep is at its top: it is in time, and the same in every round. A mark on the ring shows it · right click resets";
    const crest = this.crest;
    crest.type = "range";
    crest.min = "0";
    crest.step = "1";
    crest.id = "pedal-crest";
    crest.setAttribute("aria-label", "Sweep peak");
    crest.addEventListener("input", () => app.pedals.set({ crest: Number(crest.value) }, "crest"));
    crest.addEventListener("change", () => app.store.settle());
    crest.addEventListener("pointerdown", (event) => {
      if (event.button !== 2) return;
      app.pedals.reset("crest");
      app.store.settle();
    });
    crest.addEventListener("contextmenu", (event) => event.preventDefault());
    peak.append(el("span", "label", "Peak"), crest, shown(this.crestWord));
    const often = el("div", "line");
    often.id = "pedal-span-row";
    const spans = el("div", "pedal-choice spans");
    spans.id = "pedal-spans";
    this.spans = choices(spans, "One sweep takes", SPAN_SHORT.map((name, index) => ({ name, hint: `One sweep ${SPAN_NAMES[index] ?? ""}`, says: SPAN_SAYS[index] ?? name })), (span) => app.pedals.set({ span }));
    often.append(el("span", "label", "Sweep in"), spans, el("span", "after", "rounds"));
    this.sweepRows.push(peak, often);

    const orderName = el("h3", "", "Order");
    const orders = el("div", "pedal-choice orders");
    orders.id = "pedal-orders";
    this.orders = choices(orders, "Order: where reverb and echo sit", ORDERS, (first) => app.pedals.set({ first }));

    const group = (...parts: HTMLElement[]): HTMLElement => {
      const holder = el("div", "group");
      holder.append(...parts);
      return holder;
    };
    // Depth, peak and rounds belong to the modulation: a screen reader says so when it comes to them.
    const modulation = group(modName, mods, this.depthRow, peak, often);
    modulation.setAttribute("role", "group");
    modulation.setAttribute("aria-labelledby", modName.id);
    box.append(head, this.chain, group(chainsName, chains), group(drive.row, tones), group(crush.row), modulation, group(orderName, orders));
    return box;
  }

  /** Puts the focus back where it was before the board came; if that is gone, on the button that turned the panel over, or on the wheel. */
  private giveBack(): void {
    const target = [this.cameFrom, this.opener, byId("kreisel")].find(reachable);
    this.cameFrom = null;
    target?.focus();
  }

  sync(): void {
    const { app, box, opener } = this;
    const track = app.selected;
    const settings = trackOf(app.project, track);
    const pedals = app.pedals.current;
    const names = app.pedals.fits ? stations(settings) : [];
    // The lamp is lit while the ring is driven or has a pedal on: reverb and echo alone are no pedals. The button's name stays "Pedals"; what the ring wears is its description.
    const wearing = app.pedals.fits && (settings.drive > 0 || settings.pedals !== undefined);
    opener.classList.toggle("on", wearing);
    const worn = `Chain: ${describeChain(settings)}.`;
    if (this.wearing.textContent !== worn) this.wearing.textContent = worn;
    const key = this.panels.keyLabel("KeyY");
    const title = `The ring's pedals: the drive's character, crush, phaser, flanger and chorus, and whether reverb and echo come before the drive (${key}) · right click dices a chain`;
    if (opener.title !== title) opener.title = title;
    const showing = app.pedals.open && app.focus === "ring" && app.pedals.fits && !app.relay.veiled(track);
    opener.setAttribute("aria-expanded", String(showing));
    // Whoever was on the board when it is put away is not left on something hidden.
    const focused = document.activeElement;
    const leaving = !showing && this.showing && box.contains(focused);
    const inside = showing && box.contains(focused) ? focused : null;
    box.hidden = !showing;
    this.showing = showing;
    if (leaving) this.giveBack();
    if (!showing) return;
    this.panels.ringBox.hidden = true;
    const info = trackInfo(track);
    this.name.textContent = `${info.name}: pedals`;

    // The chain: one station for everything that is turned up, in the order the sound passes it. The pills are for the eye, the sentence for a screen reader.
    const line = names.join("|");
    if (this.chain.dataset.line !== line) {
      this.chain.dataset.line = line;
      const pills = names.length > 0 ? names.map((name) => el("span", name === toneStation(pedals.tone) && settings.drive > 0 ? "station drive" : "station", name)) : [el("span", "station none", "nothing in its way")];
      for (const pill of pills) pill.setAttribute("aria-hidden", "true");
      const label = el("span", "label", "Chain");
      label.setAttribute("aria-hidden", "true");
      this.chain.replaceChildren(label, ...pills, el("span", "sr", worn));
    }

    if (this.shown !== track) {
      this.shown = track;
      const presets = chainsFor(track);
      this.presets.forEach((chip, index) => {
        const preset = presets[index];
        chip.hidden = !preset;
        chip.textContent = preset?.name ?? "";
        chip.title = preset ? `${preset.hint} (${describeChain(preset)})` : "";
      });
    }
    const chain = app.pedals.worn;
    this.presets.forEach((chip, index) => chip.setAttribute("aria-pressed", String(index === chain)));
    this.none.setAttribute("aria-pressed", String(!wearing));

    take(this.tones, pedals.tone);
    take(this.mods, pedals.mod);
    take(this.spans, pedals.span);
    take(this.orders, pedals.first);
    this.crushWord.textContent = crushWord(pedals.crush);
    this.depthRow.hidden = pedals.mod === 0;
    const sweeping = sweeps(pedals.mod);
    for (const row of this.sweepRows) row.hidden = !sweeping;
    const length = patternOf(app.project, track).len;
    const crest = this.crest;
    crest.max = String(length - 1);
    const at = pedals.crest % length;
    if (crest.value !== String(at)) crest.value = String(at);
    crest.setAttribute("aria-valuetext", crestText(at, length));
    this.crestWord.textContent = `step ${at + 1}`;
    // A row that went away under the focus (a step back switched the modulation off) hands it to the modulation's choice.
    if (inside && !reachable(inside)) this.mods[pedals.mod]?.focus();
    // Whoever turned the panel over with its key or its button is taken along to it.
    if (app.pedals.asked) {
      app.pedals.asked = false;
      if (!box.contains(focused)) this.cameFrom = focused;
      this.name.focus();
    }
  }
}

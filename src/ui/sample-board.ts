import type { App } from "../app/app";
import { patternOf, SAMPLE_SOUND, trackInfo, trackOf, type Sample } from "../model";
import { activeSteps } from "../patterns";
import { describeSample, FITS, MODES, playedSpan, secondsText, SLICES, STRETCH_MAX, stretchText, TUNE_MAX, tuneText } from "../sample";
import { BUNDLE_ENDING } from "../bundle";
import { ACCEPT } from "../sample-files";
import { button, byId, el } from "./dom";
import { choices, reachable, take } from "./pedal-board";
import type { Panels } from "./panels";
import { loudness } from "./wave";

/** A slider of the board with its own range, and what it says for its value. */
interface Amount {
  input: HTMLInputElement;
  read(sample: Sample, steps: number): number;
  say(sample: Sample, seconds: number, steps: number): string;
}

const SOURCES = { file: "a file", microphone: "the microphone", kreisel: "the Kreisel" } as const;

/*
 * The sampler: the third side of a ring's panel. A row in the ring's panel
 * turns it over, and the wheel stays in view beside it, where the recording
 * lies around the ring. From top to bottom: where a recording comes from
 * (a file, the microphone, the Kreisel itself), the recording as a strip
 * with the part that plays, how it is played, and the recordings this
 * browser keeps.
 *
 * Everything is a button, a slider that says its value, or a group the
 * arrow keys go through. Dropping a file on the page and pasting one are
 * shortcuts for "Load a file".
 */
export class SampleBoard {
  readonly box = el("div", "panel-box panel-sample");
  /** The ring's row: the sample as a sound to pick, and the button that turns the panel over. */
  private readonly pick = button("own-pick", "");
  private readonly thumb = el("canvas", "thumb");
  private readonly label = el("span", "own-label");
  readonly opener = button("button small", "Sample", "Give this ring a recording to play: a file, the microphone, or the Kreisel itself (0)");
  private readonly file = el("input");
  private readonly name = el("h2");
  private readonly back = button("button small done", "‹ Ring", "Back to the ring (Esc)");
  private readonly load = button("button small", "Load a file …", "A sound file from this computer: WAV, AIFF, MP3, Ogg, Opus, FLAC or M4A (or a Kreisel's own file with its recordings). Dropping a file anywhere on the page does the same");
  private readonly record = button("button small sample-mic", "Microphone", "Record the microphone; one more press stops and gives the take to the ring");
  private readonly pressRing = button("button small", "This ring", "Resample this ring: one turn of it as it sounds now, with its pedals and its weather, becomes its recording. Then it can be chopped, turned and played backwards");
  private readonly pressAll = button("button small", "The wheel", "Resample the wheel: a bar or two of everything that is heard in this scene becomes this ring's recording");
  private readonly state = el("p", "sample-state");
  private readonly shape = el("div", "sample-shape");
  private readonly about = el("p", "sample-about");
  private readonly wave = el("canvas", "sample-wave");
  private readonly hear = button("button small", "Listen", "Play the part of the recording that the ring plays");
  private readonly trim = button("button small", "Trim", "Leave out the silence before and after the sound");
  private readonly remove = button("button small", "Remove", "Take the recording off this ring: the ring plays its first sound again, and the browser keeps the recording");
  private readonly all = button("button small", "A hit on every step", "Lay a hit on every step: the recording plays through, and taking hits away chops it");
  private readonly key = button("button small", "To key", "Find the recording's own pitch and tune it to the key");
  private readonly turned = button("chip", "Backwards", "Play the recording backwards");
  private readonly slicesOnly: HTMLElement[] = [];
  private readonly hitOnly: HTMLElement[] = [];
  private modes: HTMLButtonElement[] = [];
  private fits: HTMLButtonElement[] = [];
  private readonly amounts: Amount[] = [];
  private readonly keptList = el("ul", "sample-kept");
  private readonly bundle = button("button small", "Save as a file with its recordings", "One file with this Kreisel and the recordings its rings play: a link cannot carry sound, this file can");
  /** What a control is for, said to a screen reader where the eye has a tooltip. */
  private readonly hints = el("div", "sr");
  /** Something no list of recordings is: so that the first look at an empty list writes "None yet." */
  private keptSignature = "?";
  private thumbSignature = "";
  private waveSignature = "";
  private showing = false;
  private cameFrom: Element | null = null;
  /** The page's colours changed (light to dark): what is drawn in them is drawn again. */
  private scheme = 0;

  constructor(private readonly panels: Panels, private readonly app: App) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.scheme += 1;
      app.notify();
    });
  }

  /** The row for the ring's panel: beside its painted sound, its body and its voice. */
  buildRow(): HTMLElement {
    const { app } = this;
    const row = el("div", "own");
    this.pick.id = "sample-pick";
    this.pick.append(this.thumb, this.label);
    this.pick.addEventListener("click", () => app.sample.use());
    this.opener.id = "sample-open";
    this.opener.setAttribute("aria-expanded", "false");
    this.opener.setAttribute("aria-controls", "sampler");
    this.opener.addEventListener("click", () => app.sample.toggle());
    row.append(this.pick, this.opener);
    return row;
  }

  /** Says what a control is for to a screen reader as well: the tooltip alone is for a mouse. */
  private hint(node: HTMLElement, text: string): void {
    const said = el("span", "", text);
    said.id = `${node.id}-hint`;
    this.hints.append(said);
    node.setAttribute("aria-describedby", said.id);
  }

  /** Does `run` unless the sampler is busy: a busy button stays where it is (it keeps the focus) and does nothing. */
  private unlessBusy(run: () => void): () => void {
    return () => {
      if (this.app.sample.busy === null) run();
    };
  }

  private amount(id: string, label: string, hint: string, range: [min: number, max: number, step: number], read: Amount["read"], write: (value: number) => void, say: Amount["say"], reset: () => void, after?: HTMLElement): HTMLElement {
    const row = el("div", "line");
    row.title = `${hint} · right click resets`;
    // The label holds the slider and its word and nothing else: a button inside it would be read as part of the slider's name.
    const holder = el("label", "sample-amount");
    const input = el("input");
    input.type = "range";
    input.id = id;
    [input.min, input.max, input.step] = range.map(String) as [string, string, string];
    // Every slider says its value in words; until the ring has a recording there is none to say.
    input.setAttribute("aria-valuetext", "no recording");
    input.addEventListener("input", () => write(Number(input.value)));
    input.addEventListener("change", () => this.app.store.settle());
    input.addEventListener("pointerdown", (event) => {
      if (event.button !== 2) return;
      reset();
      this.app.store.settle();
    });
    input.addEventListener("contextmenu", (event) => event.preventDefault());
    holder.append(el("span", "label", label), input);
    row.append(holder);
    this.hint(input, hint);
    if (after) row.append(after);
    this.amounts.push({ input, read, say });
    return row;
  }

  build(): HTMLElement {
    const { app, box } = this;
    box.id = "sampler";
    box.hidden = true;
    box.setAttribute("role", "group");
    const head = el("header", "panel-head");
    this.name.id = "sample-title";
    this.name.tabIndex = -1;
    box.setAttribute("aria-labelledby", this.name.id);
    this.back.id = "sample-done";
    this.back.addEventListener("click", () => app.sample.close());
    head.append(el("span", "dot"), this.name, this.back);

    // Where a recording comes from. The file input is a real one, kept out of sight: the button beside it opens it.
    const file = this.file;
    file.type = "file";
    file.id = "sample-file";
    file.hidden = true;
    // An iPhone shows no sound files at all when asked for sound: there it is asked for anything.
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) file.accept = `${ACCEPT},${BUNDLE_ENDING}`;
    file.addEventListener("change", () => {
      void app.sample.bringFiles(file.files ?? []).then(() => { file.value = ""; });
    });
    this.load.id = "sample-load";
    this.load.addEventListener("click", this.unlessBusy(() => file.click()));
    this.record.id = "sample-record";
    // Stopping a take is never held up; starting one is, while something else takes a moment.
    this.record.addEventListener("click", () => { if (app.sample.take !== null || app.sample.busy === null) void app.sample.record(); });
    this.pressRing.id = "sample-press-ring";
    this.pressRing.setAttribute("aria-label", "Resample this ring");
    this.pressRing.addEventListener("click", this.unlessBusy(() => void app.sample.press(true)));
    this.pressAll.id = "sample-press-wheel";
    this.pressAll.setAttribute("aria-label", "Resample the wheel");
    this.pressAll.addEventListener("click", this.unlessBusy(() => void app.sample.press(false)));
    const sourcesName = el("h3", "", "A recording from");
    sourcesName.id = "sample-sources-name";
    const sources = el("div", "sample-sources");
    sources.setAttribute("role", "group");
    sources.setAttribute("aria-labelledby", sourcesName.id);
    const pressing = el("div", "line");
    pressing.append(el("span", "label", "Resample"), this.pressRing, this.pressAll);
    const bringing = el("div", "line");
    bringing.append(this.load, this.record, file);
    sources.append(bringing, pressing);
    this.state.id = "sample-state";
    // What takes a moment and what is missing is said as it comes, not only shown.
    this.state.setAttribute("role", "status");

    // The recording itself: a strip of it, the part that plays, and how it is played.
    this.about.id = "sample-about";
    this.wave.id = "sample-wave";
    this.wave.setAttribute("role", "img");
    this.hear.id = "sample-hear";
    this.hear.addEventListener("click", () => app.rings.strike(app.selected));
    this.trim.id = "sample-trim";
    this.trim.addEventListener("click", () => app.sample.trim());
    this.remove.id = "sample-remove";
    this.remove.addEventListener("click", () => app.sample.remove());
    const part = el("div", "line");
    part.append(this.hear, this.trim, this.remove);
    // Trimming is for a single sound: a loop's quiet belongs to its length.
    this.hitOnly.push(this.trim);
    const from = this.amount("sample-from", "Start", "Where the part that plays begins", [0, 1000, 1], (sample) => sample.from * 1000, (value) => app.sample.shape({ from: value / 1000 }, "from"), (sample, seconds) => `starts at ${secondsText(sample.from * seconds)}`, () => app.sample.reset("from"));
    const to = this.amount("sample-to", "End", "Where the part that plays ends", [0, 1000, 1], (sample) => sample.to * 1000, (value) => app.sample.shape({ to: value / 1000 }, "to"), (sample, seconds) => `ends at ${secondsText(sample.to * seconds)}`, () => app.sample.reset("to"));

    const modes = el("div", "pedal-choice sample-modes");
    modes.id = "sample-modes";
    this.modes = choices(modes, "How the recording is played", MODES, (mode) => app.sample.shape({ mode }));
    const fits = el("div", "pedal-choice sample-fits three");
    fits.id = "sample-fits";
    this.fits = choices(fits, "How a slice fits its step", FITS, (fit) => app.sample.shape({ fit }));
    const turn = this.amount("sample-turn", "Turn", "Turn the recording under the ring, as a record under its needle: every hit then plays a slice further on", [0, 31, 1], (sample) => sample.turn, (value) => app.sample.shape({ turn: value }, "turn"), (sample) => (sample.turn === 0 ? "not turned" : `turned by ${sample.turn} ${sample.turn === 1 ? "step" : "steps"}`), () => app.sample.shape({ turn: 0 }));
    this.all.id = "sample-all";
    this.all.addEventListener("click", () => app.sample.layOut());
    const laying = el("div", "line");
    laying.append(this.all);
    this.slicesOnly.push(fits, turn, laying);
    const stretch = this.amount("sample-stretch", "Stretch", "Makes the hit longer at its own pitch, the way the old Akai samplers did it: stretched far, it buzzes, and the buzz is the key's root", [100, STRETCH_MAX * 100, 25], (sample) => Math.round(sample.stretch * 100), (value) => app.sample.shape({ stretch: value / 100 }, "stretch"), (sample) => (sample.stretch <= 1 ? "as long as it is" : `${stretchText(sample.stretch)} times as long`), () => app.sample.reset("stretch"));
    this.hitOnly.push(stretch);

    this.key.id = "sample-key";
    this.key.addEventListener("click", () => app.sample.tuneToKey());
    const tune = this.amount("sample-tune", "Tune", "Higher or lower, in semitones", [-TUNE_MAX, TUNE_MAX, 1], (sample) => Math.round(sample.tune), (value) => app.sample.shape({ tune: value }, "tune"), (sample) => tuneText(sample.tune), () => app.sample.reset("tune"), this.key);
    this.turned.id = "sample-back";
    this.turned.setAttribute("aria-pressed", "false");
    this.turned.addEventListener("click", () => app.sample.shape({ back: !(app.sample.current?.back ?? false) }));
    const level = this.amount("sample-gain", "Level", "How loud the recording is. It was brought to the level of the rings' own sounds when it came in", [0, 200, 1], (sample) => Math.round(sample.gain * 100), (value) => app.sample.shape({ gain: value / 100 }, "gain"), (sample) => `${Math.round(sample.gain * 100)} %`, () => app.sample.reset("gain"), this.turned);

    const group = (...parts: HTMLElement[]): HTMLElement => {
      const holder = el("div", "group");
      holder.append(...parts);
      return holder;
    };
    this.shape.append(group(this.about, this.wave, part, from, to), group(modes, fits, turn, laying, stretch), group(tune, level));

    const keptName = el("h3", "", "Recordings in this browser");
    keptName.id = "sample-kept-name";
    this.keptList.id = "sample-kept";
    this.keptList.setAttribute("aria-labelledby", keptName.id);
    this.bundle.id = "sample-bundle";
    this.bundle.addEventListener("click", this.unlessBusy(() => { if (app.project.tracks.some((ring) => ring.sample !== undefined)) void app.sample.saveBundle(); }));
    // Up and down go through the list's rows here (elsewhere they go from ring to ring, which would change the ring a row is given to).
    this.keptList.addEventListener("keydown", (event) => {
      const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      const focused = document.activeElement;
      if (by === 0 || !(focused instanceof HTMLElement)) return;
      const column = Array.from(this.keptList.querySelectorAll<HTMLElement>(focused.matches(".chip") ? ".kept-sound .chip" : ".kept-sound .button"));
      const at = column.indexOf(focused);
      if (at < 0) return;
      event.preventDefault();
      event.stopPropagation();
      column[Math.max(0, Math.min(column.length - 1, at + by))]?.focus();
    });

    // What each control is for, for whoever has no tooltip.
    for (const node of [this.pressRing, this.pressAll, this.trim, this.key, this.all, this.remove, this.bundle]) this.hint(node, node.title);
    for (const [name, nodes, said] of [["mode", this.modes, MODES], ["fit", this.fits, FITS]] as const) {
      nodes.forEach((node, index) => {
        node.id = `sample-${name}-${index}`;
        this.hint(node, said[index]?.hint ?? "");
      });
    }
    const keeps = group(keptName, this.keptList, this.bundle);
    keeps.classList.add("sample-keeps");
    box.append(head, group(sourcesName, sources, this.state), this.shape, keeps, this.hints);
    return box;
  }

  /** Puts the focus back where it was before the sampler came; if that is gone, on its button, or on the wheel. */
  private giveBack(): void {
    const target = [this.cameFrom, this.opener, byId("kreisel")].find(reachable);
    this.cameFrom = null;
    target?.focus();
  }

  /** A recording as a strip of bars: how loud each part is; the part that plays in the ring's colour, the rest pale. */
  private draw(canvas: HTMLCanvasElement, sample: Sample, steps: number, hits: readonly number[] | null): void {
    const made = this.app.sample.sound;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
    const context = canvas.getContext("2d");
    if (!context) return;
    const style = getComputedStyle(canvas);
    const ink = style.getPropertyValue("--ink").trim() || "#2a2233";
    const color = style.getPropertyValue("--c").trim() || ink;
    context.clearRect(0, 0, width, height);
    if (!made) return;
    // The part that plays lies on the ring's colour, the sound itself is drawn in ink: told apart by more than a hue.
    context.fillStyle = color;
    context.globalAlpha = 0.3;
    context.fillRect(sample.from * width, 0, (sample.to - sample.from) * width, height);
    const bars = Math.max(8, Math.floor(width / (2 * scale)));
    const loud = loudness(sample.id, made, bars);
    const middle = height / 2;
    context.fillStyle = ink;
    for (let bar = 0; bar < bars; bar += 1) {
      const at = (bar + 0.5) / bars;
      const plays = at >= sample.from && at <= sample.to;
      const reach = Math.max(scale, (loud[bar] ?? 0) * (middle - scale));
      context.globalAlpha = plays ? 1 : 0.55;
      context.fillRect((bar / bars) * width, middle - reach, Math.max(1, width / bars - scale * 0.6), reach * 2);
    }
    context.globalAlpha = 1;
    context.fillStyle = ink;
    // The ends of the part that plays, and in slices where each step begins: a small mark at the foot, and where a
    // hit drops the needle a mark at the top as well (not a line right through: the sound stays in view).
    for (const edge of [sample.from, sample.to]) context.fillRect(Math.min(width - scale * 2, edge * width), 0, scale * 2, height);
    if (hits === null) return;
    for (let step = 0; step < steps; step += 1) {
      const at = (sample.from + ((sample.to - sample.from) * step) / steps) * width;
      const on = hits.includes(step);
      context.globalAlpha = on ? 0.95 : 0.4;
      context.fillRect(at, height * (on ? 0.8 : 0.88), scale, height * (on ? 0.2 : 0.12));
      if (on) context.fillRect(at, 0, scale, height * 0.2);
    }
    context.globalAlpha = 1;
  }

  sync(): void {
    const { app, box } = this;
    const track = app.selected;
    const settings = trackOf(app.project, track);
    const info = trackInfo(track);
    const sample = settings.sample;
    const made = app.sample.sound;
    const state = app.sample.state;
    const pattern = patternOf(app.project, track);

    // The ring's row: the sample as a sound to pick.
    this.pick.setAttribute("aria-pressed", String(settings.sound === SAMPLE_SOUND));
    this.pick.title = sample ? "Play this ring's sample (one more click turns the panel over to the sampler)" : "Give this ring a recording to play";
    this.label.textContent = sample ? `Sample: ${sample.name}` : "Load a sample";
    const thumbSignature = `${track}|${sample ? `${sample.id}.${sample.from}.${sample.to}` : ""}|${state}|${this.scheme}`;
    if (thumbSignature !== this.thumbSignature) {
      this.thumbSignature = thumbSignature;
      const context = this.thumb.getContext("2d");
      [this.thumb.width, this.thumb.height] = [116, 52];
      if (context) {
        context.clearRect(0, 0, 116, 52);
        if (sample && made) {
          const loud = loudness(sample.id, made, 29, sample.from, sample.to);
          context.fillStyle = getComputedStyle(this.thumb).getPropertyValue("--ink").trim() || "#2a2233";
          loud.forEach((value, bar) => context.fillRect(bar * 4 + 1, 26 - Math.max(1, value * 22), 2.6, Math.max(2, value * 44)));
        }
      }
    }

    const showing = app.sample.open && app.focus === "ring" && !app.relay.veiled(track);
    this.opener.setAttribute("aria-expanded", String(showing));
    const focused = document.activeElement;
    const within = box.contains(focused);
    const leaving = !showing && this.showing && within;
    box.hidden = !showing;
    this.showing = showing;
    if (leaving) this.giveBack();
    if (!showing) return;
    this.panels.ringBox.hidden = true;
    this.name.textContent = `${info.name}: sample`;

    const recording = app.sample.take !== null;
    // The microphone's button says what a press does now; it is not a switch that is "on".
    this.record.textContent = recording ? "Stop" : "Microphone";
    this.record.setAttribute("aria-label", recording ? "Stop recording" : "Record the microphone");
    this.record.classList.toggle("recording", recording);
    // A button that cannot be used right now is said to be so but stays in place: taken out, it would drop the focus.
    const held = app.sample.busy !== null || recording;
    for (const node of [this.load, this.pressRing, this.pressAll]) node.setAttribute("aria-disabled", String(held));
    this.record.setAttribute("aria-disabled", String(!app.sample.canRecord || (app.sample.busy !== null && !recording)));
    const stateText = recording ? "Recording … make your sound, then press “Stop”."
      : app.sample.busy ?? (state === "missing" && sample ? `This browser does not have “${sample.name}”. Load the file again (or the Kreisel's own file, which carries its recordings): until then this ring is silent.`
        : state === "loading" && sample ? `Getting “${sample.name}” ready …`
        : !sample ? "This ring has no recording yet. Load a sound file, record the microphone, or resample what the Kreisel plays."
        : "");
    if (this.state.textContent !== stateText) this.state.textContent = stateText;
    this.state.hidden = stateText === "";
    this.state.classList.toggle("missing", state === "missing");

    this.shape.hidden = !sample || !made;
    if (sample && made) {
      const steps = pattern.len;
      const sliced = sample.mode === SLICES;
      const [from, to] = playedSpan(sample);
      const kept = app.sample.kept.find((item) => item.id === sample.id);
      const about = `${describeSample(sample, made.seconds, steps)}${kept ? ` · from ${SOURCES[kept.source]}` : ""}`;
      if (this.about.textContent !== about) this.about.textContent = about;
      this.wave.setAttribute("aria-label", `The recording “${sample.name}”, ${secondsText(made.seconds)} long: the part from ${secondsText(sample.from * made.seconds)} to ${secondsText(sample.to * made.seconds)} plays${sample.back ? ", backwards" : ""}.`);
      const hits = sliced ? activeSteps(pattern) : null;
      const waveSignature = `${sample.id}|${from}|${to}|${sliced}|${steps}|${hits?.join(",") ?? ""}|${info.color}|${this.wave.clientWidth}|${this.scheme}`;
      if (waveSignature !== this.waveSignature) {
        this.waveSignature = waveSignature;
        this.draw(this.wave, sample, steps, hits);
      }
      take(this.modes, sample.mode);
      take(this.fits, sample.fit);
      for (const node of this.slicesOnly) node.hidden = !sliced;
      for (const node of this.hitOnly) node.hidden = sliced;
      this.turned.setAttribute("aria-pressed", String(sample.back));
      for (const amount of this.amounts) {
        if (amount.input.id === "sample-turn") amount.input.max = String(Math.max(1, steps - 1));
        const value = String(amount.read(sample, steps));
        if (amount.input.value !== value) amount.input.value = value;
        const said = amount.say(sample, made.seconds, steps);
        if (amount.input.getAttribute("aria-valuetext") !== said) amount.input.setAttribute("aria-valuetext", said);
      }
    }

    // The recordings this browser keeps: each a button that gives it to this ring, and one that forgets it.
    const keptSignature = app.sample.kept.map((item) => `${item.id}.${item.name}`).join("|");
    if (keptSignature !== this.keptSignature) {
      this.keptSignature = keptSignature;
      this.keptList.replaceChildren(...(app.sample.kept.length === 0 ? [el("li", "none", "None yet.")] : app.sample.kept.map((item) => {
        const row = el("li", "kept-sound");
        // Several recordings can have one name (the same sound as a WAV and as an MP3): what each is stands beside it.
        const what = item.source === "kreisel" ? "resampled" : item.source === "microphone" ? "a take" : item.kind;
        const use = button("chip", "", `Give “${item.name}” to this ring (${what}, ${secondsText(item.seconds)}, from ${SOURCES[item.source]})`);
        use.addEventListener("click", () => void app.sample.useKept(item.id));
        use.append(el("span", "kept-name", item.name), el("span", "kept-length", `${what} · ${secondsText(item.seconds)}`));
        const drop = button("button icon small", "×", `Forget “${item.name}” (${what}, ${secondsText(item.seconds)}): a ring that plays it falls silent`);
        drop.setAttribute("aria-label", `Forget ${item.name}, ${what}, ${secondsText(item.seconds)}`);
        drop.addEventListener("click", () => void app.sample.dropKept(item.id));
        row.append(use, drop);
        return row;
      })));
    }
    for (const row of this.keptList.querySelectorAll<HTMLButtonElement>(".kept-sound .chip")) row.setAttribute("aria-pressed", "false");
    if (sample) {
      const at = app.sample.kept.findIndex((item) => item.id === sample.id);
      this.keptList.querySelectorAll<HTMLButtonElement>(".kept-sound .chip")[at]?.setAttribute("aria-pressed", "true");
    }
    this.bundle.setAttribute("aria-disabled", String(app.sample.busy !== null || !app.project.tracks.some((ring) => ring.sample !== undefined)));
    // What had the focus is gone (a row of the list, a control of the other way of playing): the heading takes it,
    // so that the next key is not the page's.
    if (within && !reachable(focused)) this.name.focus();

    if (app.sample.asked) {
      app.sample.asked = false;
      if (!box.contains(focused)) this.cameFrom = focused;
      this.name.focus();
    }
  }
}

import type { App } from "../app/app";
import { takesAcid } from "../acid";
import { ACID_SOUND, BODY_SOUND, clamp, trackInfo, trackOf, VOICE_SOUND, type Track } from "../model";
import { BODY_NAMES } from "../body";
import { FAMILY_COUNT, FAMILY_SIZE, familyNames, familySounds, placeOf, SOUND_COUNT, soundAt, soundName, technoSounds } from "../sounds/index";
import { button, byId, el } from "./dom";
import { onContext } from "./menu";

/** What the sound a ring plays is called: its name on the palette, or what kind of sound of its own it is. */
export function soundLabel(track: number, settings: Track): string {
  const name = soundName(track, settings.sound);
  if (name !== null) return name;
  if (settings.sound === ACID_SOUND) return "Acid 303";
  if (settings.sound === VOICE_SOUND) return "Voice";
  return settings.sound === BODY_SOUND && settings.body ? (BODY_NAMES[settings.body.kind] ?? "Body") : "Painted";
}

/*
 * A ring's ready-made sounds: fifty of them, in five families of ten. In the
 * ring's panel there is one row for them (the sound's name between two arrows
 * that leaf through); a click on the name opens the palette beside the panel,
 * where every sound is one click away and is heard at once. The palette stays
 * open while sounds are tried, also when another ring is picked.
 *
 * In a techno Kreisel the palette begins with the ring's techno group: ten of
 * the fifty, shown a second time where one looks first (src/sounds/techno.ts).
 * The dice of such a Kreisel throw from that group.
 */
export class SoundPalette {
  private readonly card = byId("palette");
  private readonly title = el("strong");
  private readonly head = el("header", "palette-head");
  private readonly dice = button("button small", "Dice", "");
  private readonly headings: HTMLElement[] = [];
  private readonly chips: HTMLButtonElement[] = [];
  /** The techno group: in the palette only while the Kreisel's style is techno. */
  private readonly techno = el("div", "palette-techno");
  private readonly technoChips: HTMLButtonElement[] = [];
  private readonly before = button("button icon small", "‹", "Previous sound (U)");
  private readonly after = button("button icon small", "›", "Next sound (I)");
  private readonly pick = button("sound-pick", "", `Show all ${SOUND_COUNT} sounds of this ring (P) · right click dices one`);
  private readonly name = el("span", "sound-name");
  private readonly family = el("span", "sound-family");
  /** The acid machine: one more sound, for the two rings that can have it. */
  private readonly machineRow = el("div", "palette-machine");
  private readonly machine = button("machine", "Acid 303", "The acid machine: a filter that squelches, accents that build on each other, and notes that glide into one another");
  /** The ring whose names the palette shows. */
  private shown = -1;

  constructor(private readonly app: App) {}

  /** The row in the ring's panel. */
  buildRow(): HTMLElement {
    const { app, before, after, pick } = this;
    const row = el("div", "sound-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Sound");
    before.setAttribute("aria-label", "Previous sound");
    after.setAttribute("aria-label", "Next sound");
    before.addEventListener("click", () => app.rings.stepSound(app.selected, -1));
    after.addEventListener("click", () => app.rings.stepSound(app.selected, 1));
    pick.id = "sound-pick";
    pick.setAttribute("aria-haspopup", "dialog");
    pick.setAttribute("aria-controls", "palette");
    pick.append(this.name, this.family);
    pick.addEventListener("click", () => app.rings.togglePalette());
    onContext(pick, () => app.rings.diceSound(app.selected));
    row.append(before, pick, after);
    return row;
  }

  /** The palette itself: a heading and ten sounds for each family. */
  build(): void {
    const { app, head, dice } = this;
    dice.id = "palette-dice";
    dice.addEventListener("click", () => app.rings.diceSound(app.selected));
    const done = button("button small done", "Done", "Close the palette (Esc)");
    done.id = "palette-done";
    done.addEventListener("click", () => app.rings.closePalette());
    head.append(this.title, dice, done);
    this.card.append(head);
    const group = el("h3", "palette-name", "Techno · ten of the fifty");
    group.id = "palette-family-techno";
    const picks = el("div", "palette-row");
    picks.setAttribute("role", "group");
    picks.setAttribute("aria-labelledby", group.id);
    for (let place = 0; place < FAMILY_SIZE; place += 1) {
      const chip = button("chip", "");
      chip.addEventListener("click", () => {
        const one = technoSounds(app.selected)[place];
        if (one) app.rings.setSound(app.selected, one.sound);
      });
      picks.append(chip);
      this.technoChips.push(chip);
    }
    this.techno.append(group, picks);
    for (let family = 0; family < FAMILY_COUNT; family += 1) {
      const heading = el("h3", "palette-name");
      heading.id = `palette-family-${family}`;
      const row = el("div", "palette-row");
      row.setAttribute("role", "group");
      row.setAttribute("aria-labelledby", heading.id);
      for (let place = 0; place < FAMILY_SIZE; place += 1) {
        const chip = button("chip", "");
        chip.addEventListener("click", () => app.rings.setSound(app.selected, soundAt(family, place)));
        row.append(chip);
        this.chips.push(chip);
      }
      this.card.append(heading, row);
      this.headings.push(heading);
    }
    this.machine.id = "palette-machine";
    this.machine.addEventListener("click", () => app.acid.use());
    this.machineRow.append(el("strong", "", "Machine"), this.machine, el("span", "hint", "with its own filter, bite and glide"));
    this.card.append(this.machineRow);
  }

  /** A press outside puts the palette away. The list of rings and the bar are not outside: another ring's palette is one click away, and so is start and stop. */
  outside(target: Element | null): void {
    if (!target?.closest("#palette, .sound-row, #tracks, .bar, #context")) this.app.rings.closePalette();
  }

  sync(): void {
    const app = this.app;
    const track = app.selected;
    const settings = trackOf(app.project, track);
    const where = placeOf(settings.sound);
    this.name.textContent = soundLabel(track, settings);
    this.family.textContent = where ? (familyNames(track)[where.family] ?? "") : settings.sound === ACID_SOUND ? "Machine" : "own sound";
    const open = app.rings.paletteOpen && app.focus === "ring" && !app.relay.veiled(track);
    this.pick.setAttribute("aria-expanded", String(open));
    this.card.hidden = !open;
    if (!open) return;
    const techno = app.project.style === "techno";
    const group = technoSounds(track);
    if (techno && !this.techno.isConnected) this.head.after(this.techno);
    else if (!techno) this.techno.remove();
    this.dice.title = techno ? "Take one of this ring's ten techno sounds" : "Take any sound from the palette";
    if (this.shown !== track) {
      this.shown = track;
      const names = familyNames(track);
      this.headings.forEach((heading, family) => { heading.textContent = names[family] ?? ""; });
      this.chips.forEach((chip, index) => { chip.textContent = familySounds(track, Math.floor(index / FAMILY_SIZE))[index % FAMILY_SIZE]?.name ?? ""; });
      this.technoChips.forEach((chip, place) => { chip.textContent = group[place]?.name ?? ""; });
    }
    const info = trackInfo(track);
    this.title.textContent = `${info.name}: ${SOUND_COUNT} sounds`;
    this.card.style.setProperty("--c", info.color);
    this.chips.forEach((chip, index) => chip.setAttribute("aria-pressed", String(soundAt(Math.floor(index / FAMILY_SIZE), index % FAMILY_SIZE) === settings.sound)));
    this.technoChips.forEach((chip, place) => chip.setAttribute("aria-pressed", String(group[place]?.sound === settings.sound)));
    this.machineRow.hidden = !takesAcid(track);
    this.machine.setAttribute("aria-pressed", String(settings.sound === ACID_SOUND));
    this.place();
  }

  /** Beside the row it belongs to, where there is room for it; on a narrow page the style sheet lays it along the bottom instead. */
  private place(): void {
    const card = this.card;
    if (matchMedia("(max-width: 719px)").matches) {
      card.style.left = "";
      card.style.top = "";
      return;
    }
    const row = this.pick.getBoundingClientRect();
    const panel = byId("panel").getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = panel.left - width - 12 >= 8 ? panel.left - width - 12 : clamp(row.left, 8, Math.max(8, innerWidth - width - 8));
    const top = left < panel.left - width ? row.top - 12 : row.bottom + 8;
    card.style.left = `${left}px`;
    card.style.top = `${clamp(top, 8, Math.max(8, innerHeight - height - 8))}px`;
  }
}

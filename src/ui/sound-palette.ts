import type { App } from "../app/app";
import { takesAcid } from "../acid";
import { ACID_SOUND, BODY_SOUND, clamp, trackInfo, trackOf, VOICE_SOUND, type Track } from "../model";
import { BODY_NAMES } from "../body";
import { FAMILY_COUNT, FAMILY_SIZE, familyNames, familySounds, placeOf, SOUND_COUNT, soundAt, soundName } from "../sounds/index";
import { button, byId, el } from "./dom";
import { onContext } from "./menu";

/** What the sound a ring plays is called: its name on the palette, or what kind of sound of its own it is. */
export function soundLabel(track: number, settings: Track): string {
  const name = soundName(track, settings.sound);
  if (name !== null) return name;
  if (settings.sound === ACID_SOUND) return "Acid 303";
  if (settings.sound === VOICE_SOUND) return "Stimme";
  return settings.sound === BODY_SOUND && settings.body ? (BODY_NAMES[settings.body.kind] ?? "Klangkörper") : "Gemalt";
}

/*
 * A ring's ready-made sounds: fifty of them, in five families of ten. In the
 * ring's panel there is one row for them (the sound's name between two arrows
 * that leaf through); a click on the name opens the palette beside the panel,
 * where every sound is one click away and is heard at once. The palette stays
 * open while sounds are tried, also when another ring is picked.
 */
export class SoundPalette {
  private readonly card = byId("palette");
  private readonly title = el("strong");
  private readonly headings: HTMLElement[] = [];
  private readonly chips: HTMLButtonElement[] = [];
  private readonly before = button("button icon small", "‹", "Voriger Klang (U)");
  private readonly after = button("button icon small", "›", "Nächster Klang (I)");
  private readonly pick = button("sound-pick", "", `Alle ${SOUND_COUNT} Klänge dieses Rings zeigen (P) · Rechtsklick würfelt einen`);
  private readonly name = el("span", "sound-name");
  private readonly family = el("span", "sound-family");
  /** The acid machine: one more sound, for the two rings that can have it. */
  private readonly machineRow = el("div", "palette-machine");
  private readonly machine = button("machine", "Acid 303", "Die Acid-Maschine: ein Filter, der schmatzt, Betonungen, die sich hochschaukeln, und Töne, die ineinander gleiten");
  /** The ring whose names the palette shows. */
  private shown = -1;

  constructor(private readonly app: App) {}

  /** The row in the ring's panel. */
  buildRow(): HTMLElement {
    const { app, before, after, pick } = this;
    const row = el("div", "sound-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Klang");
    before.setAttribute("aria-label", "Voriger Klang");
    after.setAttribute("aria-label", "Nächster Klang");
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
    const app = this.app;
    const head = el("header", "palette-head");
    const dice = button("button small", "Würfeln", "Irgendeinen Klang aus der Palette nehmen");
    dice.id = "palette-dice";
    dice.addEventListener("click", () => app.rings.diceSound(app.selected));
    const done = button("button small done", "Fertig", "Die Palette schließen (Esc)");
    done.id = "palette-done";
    done.addEventListener("click", () => app.rings.closePalette());
    head.append(this.title, dice, done);
    this.card.append(head);
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
    this.machineRow.append(el("strong", "", "Maschine"), this.machine, el("span", "hint", "mit eigenem Filter, Biss und Gleiten"));
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
    this.family.textContent = where ? (familyNames(track)[where.family] ?? "") : settings.sound === ACID_SOUND ? "Maschine" : "eigener Klang";
    const open = app.rings.paletteOpen && app.focus === "ring" && !app.relay.veiled(track);
    this.pick.setAttribute("aria-expanded", String(open));
    this.card.hidden = !open;
    if (!open) return;
    if (this.shown !== track) {
      this.shown = track;
      const names = familyNames(track);
      this.headings.forEach((heading, family) => { heading.textContent = names[family] ?? ""; });
      this.chips.forEach((chip, index) => { chip.textContent = familySounds(track, Math.floor(index / FAMILY_SIZE))[index % FAMILY_SIZE]?.name ?? ""; });
    }
    const info = trackInfo(track);
    this.title.textContent = `${info.name}: ${SOUND_COUNT} Klänge`;
    this.card.style.setProperty("--c", info.color);
    this.chips.forEach((chip, index) => chip.setAttribute("aria-pressed", String(soundAt(Math.floor(index / FAMILY_SIZE), index % FAMILY_SIZE) === settings.sound)));
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

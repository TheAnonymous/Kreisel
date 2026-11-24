import type { App } from "../app/app";
import { syllables } from "../voice";
import { MAX_VOICE_TEXT, VOICE_SOUND, trackInfo, trackOf, wrap } from "../model";
import type { BoothView } from "./booth";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/*
 * The voice's window around its mouth (booth.ts): the line, its syllables, how big the mouth is and how much breath there is.
 */
export class BoothWindow {
  private boothOpen = false;
  private syllableSignature = "";
  private litSyllable = -1;

  constructor(private readonly panels: Panels, private readonly app: App, private readonly mouth: BoothView) {}

  /** The voice's window: the line it sings, how it is cut into syllables, and the two ways to shape the voice. */
  build(): void {
    const app = this.app;
    const text = byId<HTMLInputElement>("voice-text");
    text.maxLength = MAX_VOICE_TEXT;
    text.addEventListener("input", () => app.voice.shape({ text: text.value }, "text"));
    text.addEventListener("keydown", (event) => {
      // Typing a line must not play the Kreisel; Enter sings it, Escape puts the window away.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        app.voice.singLine();
      } else if (event.key === "Escape") {
        app.voice.close();
      }
    });
    byId("voice-sing").addEventListener("click", () => app.voice.singLine());
    byId("booth-dice").addEventListener("click", () => app.voice.dice());
    byId("booth-done").addEventListener("click", () => app.voice.close());
    const holder = byId("booth-shape");
    const shaper = (label: string, field: "mouth" | "breath", title: string, id: string): void => {
      const line = el("label", "line");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.id = id;
      input.title = title;
      this.panels.slider(input, () => app.voice.current?.[field] ?? 0.5, (value) => app.voice.shape({ [field]: value }, field), () => app.voice.shape({ [field]: field === "mouth" ? 0.5 : 0.15 }));
      input.addEventListener("change", () => app.voice.singLine());
      line.append(el("span", "label", label), input);
      holder.append(line);
    };
    shaper("Mouth", "mouth", "The space in the mouth: small and bright to big and dark", "voice-mouth");
    shaper("Breath", "breath", "How much breath is in the voice: clear to whispered", "voice-breath");
    // A click beside the window puts it away, like a click beside any open box.
    byId("booth").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) app.voice.close();
    });
  }

  /** The ring's voice in the panel, and its window. */
  sync(): void {
    const app = this.app;
    const track = app.selected;
    const info = trackInfo(track);
    const settings = trackOf(app.project, track);
    const voice = settings.voice;
    // A voice that is gone (taken back) has no window.
    if (app.voice.isOpen && !voice) app.voice.close();

    this.panels.sung.pick.setAttribute("aria-pressed", String(settings.sound === VOICE_SOUND));
    this.panels.sung.pick.title = voice ? "Play this ring's voice (one more click opens its window)" : "Give this ring a voice: it sings a line of text";
    this.panels.sung.label.textContent = voice ? (voice.text.trim() ? `Voice: ${voice.text.trim()}` : "Voice: vowel only") : "Give a voice";

    const open = app.voice.isOpen && voice !== null;
    byId("booth").hidden = !open;
    if (open && !this.boothOpen) {
      this.panels.endTour();
      byId("stage").scrollIntoView({ block: "nearest" });
      // With a keyboard at hand the line is ready to be typed over (a phone's keyboard would only be in the way).
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const field = byId<HTMLInputElement>("voice-text");
        field.value = voice?.text ?? "";
        field.focus({ preventScroll: true });
        field.select();
      }
    }
    this.boothOpen = open;
    if (!open || !voice) return;
    byId("booth").style.setProperty("--c", info.color);
    byId("booth-title").textContent = `Voice: ${info.name}`;
    const text = byId<HTMLInputElement>("voice-text");
    // What is being typed is left alone (the line is kept as typed, a trailing space included).
    if (document.activeElement !== text || text.value.trimStart() !== voice.text) text.value = voice.text;
    const cut = syllables(voice.text);
    const signature = cut.map((syllable) => `${syllable.first ? " " : "·"}${syllable.text}`).join("");
    const holder = byId("voice-syllables");
    if (signature !== this.syllableSignature) {
      this.syllableSignature = signature;
      this.litSyllable = -1;
      holder.replaceChildren(...(cut.length > 0
        ? cut.map((syllable, index) => {
            const chip = button(`syllable${syllable.first && index > 0 ? " word" : ""}`, syllable.text, "Sing this syllable");
            chip.addEventListener("click", () => void app.engine.audition(app.selected, { on: true, vel: 1, chance: 0, ratchet: 1, pitch: 0, len: 2 }, app.chordNow(), index));
            return chip;
          })
        : [el("span", "shelf-label empty", "Without text the ring sings the vowel the point in the sound pad stands on.")]));
    }
    this.lightSyllable();
  }

  /** The syllable that is being sung lights up (looked at on every frame while the window is open). */
  lightSyllable(): void {
    const app = this.app;
    if (!app.voice.isOpen) return;
    const track = app.selected;
    const chips = byId("voice-syllables").querySelectorAll(".syllable");
    const since = app.sinceStruck(track);
    const sounding = since > -0.02 && since < 0.3 && chips.length > 0 ? wrap(app.engine.sung[track] ?? 0, chips.length) : -1;
    if (sounding === this.litSyllable) return;
    this.litSyllable = sounding;
    chips.forEach((chip, index) => chip.classList.toggle("sung", index === sounding));
  }
}

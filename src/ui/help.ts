import { byId, el } from "./dom";
import type { Panels } from "./panels";

/*
 * The help: every key, with what stands on it on this keyboard.
 */
export class HelpDialog {

  constructor(private readonly panels: Panels) {}

  show(): void {
    const dialog = byId<HTMLDialogElement>("help");
    if (!dialog.open) dialog.showModal();
  }

  build(): void {
    const key = (code: string): string => this.panels.keyLabel(code);
    const rows: [string, string][] = [
      ["Space", "Start and stop"],
      ["Menu key", "the menu for the ring and the step at the pointer (also Shift+F10)"],
      ["1 to 7", "pick a ring · with Shift mute it"],
      [`${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")}`, "Tool: Place, Accent, Chance, Ratchet, Length (on the kick's ring: Rumble)"],
      [`${key("KeyA")} to ${key("KeyK")}`, "play the ring by hand (eight steps)"],
      [key("KeyL"), "Play in: what is played lands in the ring"],
      [`hold ${key("KeyZ")} ${key("KeyX")} ${key("KeyC")} ${key("KeyV")} ${key("KeyB")}`, "Effects: Dull, Thin, Stutter, Echo, Pause · with Shift they latch"],
      ["← →", "pointer on the ring · with Shift rotate the ring"],
      ["↑ ↓", "change ring · with Shift everything higher or lower"],
      ["Enter", "place or remove at the pointer"],
      ["+ −", "note at the pointer higher or lower"],
      [key("KeyN"), "dice the ring · with Shift only vary"],
      [`${key("KeyU")} ${key("KeyI")}`, `previous and next sound from the palette · ${key("KeyP")} shows all 50`],
      ["In the voice's window", "Enter sings the line · a hyphen splits a syllable where you want · Esc done"],
      ["At the workbench", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} mallets soft and hard, pluck, bow, blow · ${key("KeyN")} dice · Esc done`],
      ["In the paint box", `${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} brushes and eraser · ${key("KeyT")} thickness · ${key("KeyN")} dice · Del takes the last stroke · Esc done`],
      [key("KeyM"), "mute the ring · with Shift hear it alone"],
      [key("KeyO"), "Stage: only the wheel, in the dark · Esc back"],
      [", .", "scene back or forward"],
      ["Scenes and row", "the switch under the scenes says what plays: the scene in a circle, the row or the piece · the row lies under the wheel, a tile a round · dragging a scene there or “+” puts it in · a click on a tile jumps there at the next bar · dragging reorders · right click: once more, another scene, earlier or later, take out (also Del)"],
      ["8", `pick the piece's ring · there: ← → bar, + − tension, Enter plays from the bar, ${key("KeyK")} makes the eight bars there a break`],
      ["Example piece", "the techno Kreisel comes with a piece that works with tension: 160 bars, two breaks, four drops, each with a build-up of its own, and all rings play together only at the very top · to hear it, set the switch under the scenes to “Piece” · to look at it, pick the piece's ring: wedges and dots show drops and effects, the roster shows who plays when, and “Outline …” in a bar's menu writes it all down"],
      ["Techno piece", "right click on a bar of the piece's ring: “Break” for eight bars, kick and rumble drop out there; where the kick comes back or the tension jumps is a drop · in the piece's panel: fills every eight bars"],
      ["Tension", "in the piece's panel: “Moves” opens what the tension moves beside the roster, each off, gently or clearly · hi-hat opens · bass, chords and melody get brighter · the kick grows · quiet hits fall away at the bottom · drive towards the top · more reverb where little is going on"],
      ["Phrases and effects", "in the piece's panel: “Phrase ends” opens what happens by itself every eight bars: fills, the last kick left out, a crash on the one every 16 or 32 bars, a backwards cymbal · right click on a bar: “Effect” lays Dull, Thin, Stutter, Echo or Pause on this one bar, a dot at the rim shows it"],
      ["Playing the tension", `the effect key “Build-up” (${key("IntlBackslash")}, to the left of the other five) builds up while it is held: riser and snare roll rise, the lows go; when you let go, the drop lands on the next one · on the piece's ring: ${key("KeyE")} switches “Play in”, then the mouse wheel or ↑ ↓ write the tension into the line while the piece runs`],
      ["Pull", "in the weather panel every weather has its tides beside the wind: over so many bars it swells and ebbs (4 to 64, also 12 or 20) · the status line says after how many bars rings of unequal length meet again and how far a ring lies behind the kick · right click on the middle: “Realign every eight bars”"],
      ["Arc", "right click on “Dice” in the piece's panel: dice a shape (Plateau, Two drops, Waves, Long climb) · while the piece plays, the status line counts the bars to the next drop · in the piece's menu: “Outline” writes down who plays in which eight bars"],
      ["Build-up", "a red wedge at the rim of the piece's ring shows every drop, the ramp before it its build-up · click on the wedge: the kit of this drop · size (none, small, medium, big) sets everything at once, below it every part by itself: length, riser, snare roll, lows out, cloud of reverb, getting quieter, last bar without kick or hi-hat, gap before the drop, late drop · in the piece's panel: the build-up for all drops"],
      ["Roster", `on the piece's ring: ${key("KeyQ")} paints the tension, ${key("KeyW")} shows the roster · then the seven rings show the whole piece, filled means: the ring plays there · a click switches that for eight bars, dragging paints on · bright rim: always plays there, dashed: rests, otherwise the tension decides · right click: all seven rings of these bars · with the keys: ← → phrase, ↑ ↓ ring, Enter switches`],
      ["9", `pick the weather · there: ${key("KeyQ")} ${key("KeyW")} ${key("KeyE")} ${key("KeyR")} ${key("KeyT")} ${key("KeyY")} fog, sun, clouds, rain, sparks, hail · ${key("KeyN")} dice · Del takes the chosen weather away`],
      ["At the name “Kreisel”", "start anew: empty, with the techno Kreisel or the factory Kreisel · style of the dice: with “Techno” they throw kick on every beat, open hi-hat in between and acid lines, the piece gets sections of 16 and 32 bars"],
      ["Hardness", "“Drive” in a ring's panel pushes it into distortion (sparks from the weather come on top) · “Pressure” at the speaker in the top bar presses everything together: louder, denser, the lows in the middle"],
      [`Pedals · ${key("KeyY")}`, "every ring but the kick has pedals: the button “Pedals” beside its Drive turns the panel over · the drive's character (Warm, Distortion, Fuzz, Clip, Scream) · Crush · a phaser, flanger or chorus · the order: reverb and echo after the drive (a clean room) or before it (the drive chews on the tail and the repeats) · “Chains” puts a ready board on the ring, “Dice” takes one of them · the top of a phaser's or flanger's sweep is a step of the ring, so it is in time and the same in every round: the mark at the ring's rim shows it, “Peak” moves it, and so does a right click on a step: “Sweep peaks here” · in every group of choices the arrow keys go through them and you hear each at once · the techno Kreisel comes with three: a flanger over the hi-hat, a distortion behind the acid line, and the stab's reverb in front of its drive"],
      [`hold ${key("Semicolon")} ${key("Quote")} ${key("BracketLeft")}`, "the three effects of a DJ's mixer: Wash (everything swells into a reverb while the dry sound sinks; let go, and the dry sound is back with the reverb ringing out over it), Jet (a flanger over everything, at its top on the one of every other bar), Crush · with Shift they latch · on an effect's button Shift+Enter latches it, so no key has to be held"],
      ["Acid machine", "for bass and melody, at the bottom of the sound palette · the sound pad is its filter, below it bite, duration, wave and the filter ride · a note that reaches into the next one glides into it (right click on the note: “Slide into the next”)"],
      ["Techno sounds", "in the techno Kreisel every ring's palette begins with its techno group (ten of the fifty), and “Dice” takes one of them · the hi-hat is one voice there, as on a drum machine: a closed hit cuts off the open one before it · a cymbal on the hi-hat's ring gets a steady beat instead of open hits when diced"],
      ["In the top bar", "speaker: volume and pressure · “Share”: copy the link or pass it around · the arrow at “Record”: save as a file · at the wheel: stage and light show"],
      ["Ctrl+Z", "undo · with Shift redo"],
      ["?", "this help"],
    ];
    const list = byId("help-keys");
    list.replaceChildren(...rows.flatMap(([keys, what]) => [el("dt", "", keys), el("dd", "", what)]));
    const commit: unknown = import.meta.env.VITE_APP_COMMIT;
    byId("version").textContent = typeof commit === "string" && commit ? `Kreisel, version ${commit.slice(0, 7)}` : "Kreisel, development version";
  }
}

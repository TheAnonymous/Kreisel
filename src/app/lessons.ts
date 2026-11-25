import { clone, currentScene, freshProject, patternOf, SAMPLE_SOUND, trackInfo, trackOf, VOICE_SOUND, type Project } from "../model";
import { activeSteps } from "../patterns";
import { SLICES } from "../sample";
import type { App, DeedSeen } from "./app";

/*
 * The lessons of the guide: what a newcomer is asked to do, one small task
 * after the other, on the real page. A task is one sentence, a place on the
 * page that is marked while it is up, and a way of telling that it was done:
 * by what it left on the Kreisel, however it was done (mouse, finger, keys,
 * or "Show me"). Nothing here waits for a particular click.
 *
 * The first lesson is the core, the five things one has to have done once to
 * play with joy: start it, take a ring out and bring it back, set notes,
 * change a sound, hold an effect. The others are picked by whoever wants
 * more, each a handful of tasks on one subject. A lesson that would change
 * the visitor's Kreisel more than they asked for borrows the table: it works
 * on a copy (or on an empty wheel), and at its end the visitor says whether
 * what was made stays.
 *
 * Words: a sentence begins with what to do and says what will be heard, in
 * words somebody knows who has never made a beat. A music term comes after
 * the thing was done, as its name. The part in [square brackets] names the
 * place on the page; on the card it is a button that puts the focus there.
 * {key:KeyU} stands for the key at that place of the keyboard, whatever is
 * printed on it.
 */

/**
 * Where a task happens: the play button in the wheel's middle, a ring of the wheel (and steps of it), or a part of the
 * page around it (with `focus`, the one control in that part the keyboard is taken to; otherwise its first).
 */
export type Mark = { kind: "hub" } | { kind: "ring"; track: number; steps?: readonly number[] } | { kind: "node"; selector: string; focus?: string };

/** What a task keeps for itself while it is up: where things stood when it came, and what it has seen since. */
export type Notes = Record<string, unknown>;

export interface Task {
  /** The task in one sentence, for a mouse. */
  line: string;
  /** The same for a finger, where the words differ. */
  touch?: string;
  /** The keyboard's way, said under the sentence (not where there is no keyboard). */
  keys?: string;
  /** What is said when it was done, in a few words: what was just heard or made. The same for every hand. */
  after?: string;
  mark(app: App): Mark | null;
  /** Sets the stage when the task comes up (the right ring in focus) and notes where things stand. */
  begin?(app: App, notes: Notes): void;
  /** Whether it was done: asked whenever the Kreisel changed, and a few times a second. */
  done(app: App, notes: Notes, deeds: readonly DeedSeen[]): boolean;
  /** Does it once for whoever asks ("Show me"), visibly and in a way that can be taken back. */
  show(app: App): void;
  /** What "Show me" did, for whoever does not see it. */
  shown: string;
  /** How long the card stays on the task after it was done, at least, so that what was made is heard (milliseconds). */
  linger?: number;
  /** A task for a mouse or a keyboard only: a finger has no way of doing it. */
  only?: "mouse";
  /** The task is about something that is heard: while nothing plays, the card says so. */
  quiet?: boolean;
  /** "Show me" starts the Kreisel if it stands: the button says so before it is pressed. */
  starts?: boolean;
  /** A near miss: what the visitor did instead, in a sentence that says where the right place is. `null` while there is none. */
  miss?(app: App, notes: Notes): string | null;
}

export interface Chapter {
  id: string;
  name: string;
  /** What one can do afterwards, in a line: said with the lesson's name where lessons are picked. */
  promise: string;
  tasks: readonly Task[];
  /** What is said when all of it was done. */
  end: string;
  /**
   * A lesson that borrows the table: its own Kreisel comes onto it (an empty wheel, or a copy of the visitor's), and
   * afterwards the visitor's own comes back, or what was made is kept.
   */
  lends?(app: App): Project;
}

const KICK = 0;
const SNARE = 1;
const HAT = 2;
const BASS = 4;
const MELODY = 6;
const RINGS = [0, 1, 2, 3, 4, 5, 6] as const;

const node = (selector: string) => (): Mark => ({ kind: "node", selector });
const row = (track: number, part: string): string => `#tracks .track[data-track="${track}"] .${part}`;
/** Which steps of a ring have a hit. */
const hitsOf = (app: App, track: number): number[] => activeSteps(patternOf(app.project, track));
/** How many hits every ring has. */
const countsOf = (app: App): number[] => RINGS.map((track) => hitsOf(app, track).length);
/** Later, whatever happens meanwhile: for giving back what "Show me" took (a ring it muted, an effect it holds). */
const later = (ms: number, run: () => void): void => void setTimeout(run, ms);
/** Later, but only if the task that asked is still up: for what "Show me" adds to the Kreisel. Put away, a guide writes nothing more. */
const soon = (app: App, ms: number, run: () => void): void => void setTimeout(app.guide.whileUp(run), ms);
/** The sound of every ring, to tell later whether one of them was changed (whichever ring the visitor went to). */
const soundsOf = (app: App): number[] => app.project.tracks.map((track) => track.sound);
/** Where the point of every ring's sound pad stands. */
const padsOf = (app: App): number[] => app.project.tracks.flatMap((track) => [track.x, track.y]);
/** The steps of a ring, as far as the ring is long. */
const lengthOf = (app: App, track: number): number => patternOf(app.project, track).len;
/** The first ring other than `but` that has more hits now than `had` says it had. */
const strayed = (app: App, had: readonly number[], but: number): number | null => RINGS.find((track) => track !== but && hitsOf(app, track).length > (had[track] ?? 0)) ?? null;
/** Which rings are switched off by their speaker. */
const mutesOf = (app: App): string => RINGS.map((track) => (trackOf(app.project, track).mute === true ? "x" : "o")).join("");
/** Whether a ring plays a recording. */
const sampled = (app: App, track: number): boolean => trackOf(app.project, track).sound === SAMPLE_SOUND && trackOf(app.project, track).sample !== undefined;
/**
 * "Show me" on the sampler's side for whoever skipped here: the panel is turned over and the ring resampled first if
 * it plays no recording yet, then `then` (as long as the task is still up).
 */
const onRecording = (app: App, then: () => void): void => {
  if (!app.sample.open) app.sample.toggle();
  if (sampled(app, app.selected)) then();
  else void app.sample.press(true).then(app.guide.whileUp(then));
};
/** What the card says where a task of the sampler meets a ring without a recording. */
const NO_RECORDING = "This ring plays no recording yet: “This ring” beside “Resample” makes one of what it plays.";
/** A mouse's sentence in a finger's words. */
const tap = (line: string): string => line.replace(/^Click/, "Tap").replace(/\bclick\b/g, "tap").replace(/\bClick\b/g, "Tap");

/** Holding one of the effects beside the wheel for a moment and letting it go. A plain click is no hold. */
function hold(id: "dumpf" | "stotter" | "aufbau", name: string, code: string, line: string, after: string, least = 350): Task {
  return {
    line,
    keys: code === "IntlBackslash" ? `Hold {key:IntlBackslash}, the key left of {key:KeyZ}; a keyboard without it holds Enter on ${name} itself.` : `Hold {key:${code}}.`,
    after,
    quiet: true,
    starts: true,
    mark: node(`#fx [data-fx="${id}"]`),
    done: (app, notes) => {
      const now = performance.now();
      if (app.engine.fx[id] && app.playing) {
        notes.since ??= now;
        return false;
      }
      if (typeof notes.since !== "number") return false;
      // Let go: it counts if it was held long enough; otherwise the card says so, and the next hold begins anew.
      if (now - notes.since >= least) return true;
      notes.short = true;
      delete notes.since;
      return false;
    },
    miss: (_app, notes) => (notes.short === true ? `Keep ${name} pressed a little longer: it works for as long as it is held.` : null),
    show: (app) => {
      if (!app.playing) app.togglePlay();
      // Held from the moment it plays (a first start takes a moment), for as long as it takes and a little longer.
      const press = (tries: number): void => {
        if (!app.playing && tries > 0) {
          soon(app, 100, () => press(tries - 1));
          return;
        }
        app.setFx(id, true);
        later(Math.max(900, least + 500), () => app.setFx(id, false));
      };
      press(30);
    },
    shown: `${name} was held for a moment.`,
    linger: 1200,
  };
}

/** "steps 1, 5, 9 and 13": steps as the page counts them, from one. */
const stepsInWords = (steps: readonly number[]): string => {
  const names = steps.map((step) => String(step + 1));
  return `step${names.length === 1 ? "" : "s"} ${names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`}`;
};

/** Rolling the dice of one ring in the list. */
const dice = (track: number, line: string, after: string): Task => ({
  line,
  touch: tap(line),
  keys: `{key:Digit${track + 1}} picks the ring, {key:KeyN} rolls its dice.`,
  after,
  quiet: true,
  mark: node(row(track, "roll")),
  done: (_app, _notes, deeds) => deeds.some((deed) => deed.what === "dice" && deed.track === track),
  show: (app) => app.rings.dice(track),
  shown: "The dice were rolled.",
  linger: 2400,
});

/** Setting hits on given steps of a ring: marked on the wheel, done when all of them are there. */
const lay = (track: number, steps: readonly number[], line: string, after: string): Task => ({
  line,
  touch: tap(line),
  keys: `{key:Digit${track + 1}} picks the ${trackInfo(track).name}; the arrow keys move along it, Enter sets a hit: on ${stepsInWords(steps)}.`,
  after,
  quiet: true,
  mark: () => ({ kind: "ring", track, steps }),
  begin: (app, notes) => {
    app.select(track);
    notes.scene = app.project.scene;
    notes.had = countsOf(app);
    notes.own = hitsOf(app, track);
  },
  done: (app) => steps.every((step) => hitsOf(app, track).includes(step)),
  miss: (app, notes) => {
    // Another scene has come onto the table: what is counted there says nothing about a miss.
    if (notes.scene !== app.project.scene) return null;
    const other = strayed(app, notes.had as number[], track);
    if (other !== null) return `That went into the ${trackInfo(other).name}. The marked places are the small rings on the ${trackInfo(track).name}.`;
    const beside = hitsOf(app, track).some((step) => !steps.includes(step) && !(notes.own as number[]).includes(step));
    return beside ? "Close. The marked places are the small rings; a hit beside them is taken away the same way it was set." : null;
  },
  show: (app) => {
    app.select(track);
    steps.filter((step) => !hitsOf(app, track).includes(step)).forEach((step, index) => soon(app, index * 260, () => app.rings.addNote(track, step, { pitch: 0 }, "guide")));
  },
  shown: "The hits were set.",
  linger: 2400,
});

/** Notes where the Melody stands, for the task that asks for three notes more. */
const threeFrom = (app: App, notes: Notes): void => {
  notes.scene = app.project.scene;
  notes.had = hitsOf(app, MELODY);
  notes.all = countsOf(app);
  // Three notes, or as many as the ring still has room for.
  notes.need = Math.min(3, lengthOf(app, MELODY) - hitsOf(app, MELODY).length);
};

const FIRST: Chapter = {
  id: "first",
  name: "First steps",
  promise: "Play it, take a ring out, set notes, change a sound, hold an effect: two minutes",
  end: "That is the core. Nothing can break: the arrow ↶ at the top takes back any step, and this browser keeps your Kreisel.",
  tasks: [
    {
      line: "Click [play] in the middle of the wheel and listen to a turn.",
      touch: "Tap [play] in the middle of the wheel and listen to a turn.",
      keys: "The space bar starts and stops.",
      after: "One turn of the wheel is one loop. The same button stops it.",
      starts: true,
      mark: () => ({ kind: "hub" }),
      done: (app) => app.playing,
      show: (app) => { if (!app.playing) app.togglePlay(); },
      shown: "It plays.",
      linger: 2200,
    },
    {
      line: "Click [the speaker beside Kick]: the deep drum drops out. Click again: it is back.",
      touch: "Tap [the speaker beside Kick]: the deep drum drops out. Tap again: it is back.",
      keys: "{key:Digit1} picks the Kick, {key:KeyM} takes it out and brings it back.",
      after: "Every ring is an instrument you can take out and bring back.",
      quiet: true,
      mark: node(row(KICK, "mute")),
      // Whichever ring it is: a speaker was switched, and then all speakers are as they were. (A ring that plays
      // alone would hide that: nothing plays alone while this is up.)
      begin: (app, notes) => {
        if (app.rings.solo !== null) app.rings.toggleSolo(app.rings.solo);
        notes.mutes = mutesOf(app);
      },
      done: (app, notes) => {
        const back = mutesOf(app) === notes.mutes;
        if (!back) notes.out = true;
        return notes.out === true && back;
      },
      show: (app) => {
        const was = mutesOf(app);
        app.rings.toggleMute(KICK);
        later(1300, () => { if (mutesOf(app) !== was) app.rings.toggleMute(KICK); });
      },
      shown: "The kick was taken out and brought back.",
      linger: 1400,
    },
    {
      line: "Click three places in [the Melody, the purple outer ring]: each click is a note.",
      touch: "Tap three places in [the Melody, the purple outer ring]: each tap is a note.",
      keys: "{key:Digit7} picks the Melody; the arrow keys move along it, Enter sets a note.",
      after: "Three notes of your own; they always fit. A note is taken away the same way.",
      mark: () => ({ kind: "ring", track: MELODY }),
      begin: (app, notes) => {
        app.select(MELODY);
        threeFrom(app, notes);
      },
      done: (app, notes) => {
        // Another scene has come onto the table (a row plays): the three are counted from what lies there.
        if (notes.scene !== app.project.scene) threeFrom(app, notes);
        return hitsOf(app, MELODY).filter((step) => !(notes.had as number[] | undefined)?.includes(step)).length >= (notes.need as number);
      },
      miss: (app, notes) => {
        if (notes.scene !== app.project.scene) return null;
        const other = strayed(app, notes.all as number[], MELODY);
        return other === null ? null : `That went into the ${trackInfo(other).name}. The Melody is the purple ring, the outermost of the seven.`;
      },
      show: (app) => {
        app.select(MELODY);
        const length = lengthOf(app, MELODY);
        // Spread over the round, where nothing lies yet.
        const wished = [2, 6, 11, 14, 9, 4, 0, 7, 12].map((step) => Math.round((step * length) / 16) % length);
        const free = [...new Set([...wished, ...Array.from({ length }, (_, step) => step)])].filter((step) => !hitsOf(app, MELODY).includes(step)).slice(0, 3);
        free.forEach((step, index) => soon(app, index * 320, () => app.rings.addNote(MELODY, step, { pitch: [0, 2, 4][index] ?? 0 }, "guide")));
      },
      shown: "Three notes were set in the Melody.",
      linger: 3400,
    },
    {
      line: "Click [the arrow › beside the sound's name]: your notes get another sound.",
      touch: "Tap [the arrow › beside the sound's name]: your notes get another sound.",
      keys: "{key:KeyU} and {key:KeyI} leaf through the ring's fifty sounds.",
      after: "Each ring has fifty sounds. The name between the arrows shows them all.",
      mark: () => ({ kind: "node", selector: ".sound-row", focus: '.sound-row button[aria-label="Next sound"]' }),
      begin: (app, notes) => {
        // The ring whose notes were just set: its panel is the one that shows.
        app.select(MELODY);
        notes.sounds = soundsOf(app);
      },
      // Whichever ring the visitor went to meanwhile: a ring has another sound than it had.
      done: (app, notes) => soundsOf(app).some((sound, track) => sound !== (notes.sounds as number[])[track]),
      show: (app) => app.rings.stepSound(app.selected, 1),
      shown: "The ring has the next sound of its palette.",
      linger: 2000,
    },
    hold("stotter", "Stutter", "KeyC", "Press and hold [Stutter] while it plays: the beat stammers. Let go: it runs on.", "Nine effects wait there to be held."),
  ],
};

const BEAT: Chapter = {
  id: "beat",
  name: "Build a beat",
  promise: "From an empty wheel to a beat of your own, in four moves",
  end: "A beat of your own, built from nothing.",
  lends: (app) => freshProject(true, app.project.style === "frei" ? "frei" : "techno"),
  tasks: [
    lay(KICK, [0, 4, 8, 12], "Click the four marked places in [the Kick, the innermost ring].", "A kick on every beat. It is called four on the floor."),
    lay(SNARE, [4, 12], "Click the two marked places in [the Snare, one ring out]: a clap on beats two and four.", "That is the backbeat. Kick and clap are a beat already."),
    dice(HAT, "Click [the dice beside Hi-Hat]: they throw a ticking pattern on top.", "Dice never throw the same twice. Roll again whenever you like."),
    dice(BASS, "Click [the dice beside Bass]: a low tune that fits, under the beat.", "Kick, clap, hats and a bass line: the engine of a track."),
  ],
};

const SOUNDS: Chapter = {
  id: "sounds",
  name: "Sounds",
  promise: "Fifty sounds a ring, a pad that shapes them, and a ring that sings your words",
  end: "Every ring has its palette, its pad and its voice.",
  lends: (app) => clone(app.project),
  tasks: [
    {
      line: "Click [the sound's name] in the ring's panel: all fifty sounds of this ring open.",
      touch: "Tap [the sound's name] in the ring's panel: all fifty sounds of this ring open.",
      keys: "{key:KeyP} opens and closes them.",
      after: "Fifty sounds in families. This list is the palette.",
      mark: node("#sound-pick"),
      begin: (app) => {
        // A ring with hits on it, so that every sound that is tried is heard in the pattern too.
        if (app.focus !== "ring" || hitsOf(app, app.selected).length === 0) app.select(hitsOf(app, MELODY).length > 0 ? MELODY : BASS);
      },
      done: (app) => app.rings.paletteOpen,
      show: (app) => { if (!app.rings.paletteOpen) app.rings.togglePalette(); },
      shown: "The palette is open.",
      linger: 1200,
    },
    {
      line: "Click any sound in [the palette]: you hear it at once.",
      touch: "Tap any sound in [the palette]: you hear it at once.",
      keys: "The underlined words take the keyboard into it; Tab goes through the sounds, Enter takes one.",
      after: "One Undo brings the old sound back, however many you tried.",
      mark: (app) => ({ kind: "node", selector: app.rings.paletteOpen ? "#palette" : "#sound-pick" }),
      begin: (app, notes) => { notes.sounds = soundsOf(app); },
      done: (app, notes) => soundsOf(app).some((sound, track) => sound !== (notes.sounds as number[])[track]),
      miss: (app) => (app.rings.paletteOpen ? null : "The palette is closed: the sound's name between the two arrows opens it."),
      show: (app) => app.rings.diceSound(app.selected),
      shown: "The ring got another sound from its palette.",
      linger: 1800,
    },
    {
      line: "Drag [the point in the sound pad]: the sound gets brighter, or longer.",
      keys: "The underlined words take the keyboard to the pad; the arrow keys move the point.",
      after: "The words at the pad's edges say what each direction does.",
      mark: node("#panel .pad"),
      begin: (app, notes) => {
        if (app.rings.paletteOpen) app.rings.closePalette();
        notes.pads = padsOf(app);
      },
      done: (app, notes) => padsOf(app).some((place, index) => Math.abs(place - ((notes.pads as number[])[index] ?? place)) > 0.04),
      show: (app) => {
        const { x, y } = trackOf(app.project, app.selected);
        app.rings.setTrack(app.selected, { x: x > 0.5 ? x - 0.3 : x + 0.3, y: y > 0.5 ? y - 0.2 : y + 0.2 }, "pad");
        app.rings.preview(app.selected);
      },
      shown: "The point in the sound pad was moved.",
      linger: 1800,
    },
    {
      line: "Click [Text], type a few words, click “Done”: the ring sings them.",
      touch: "Tap [Text], type a few words, tap “Done”: the ring sings them.",
      keys: "In the voice's window Enter sings the line, Esc closes it.",
      after: "Each hit sings one syllable.",
      quiet: true,
      mark: node("#voice-edit"),
      done: (app, notes) => {
        if (app.workshop === "voice") notes.opened = true;
        return notes.opened === true && app.workshop === null && trackOf(app.project, app.selected).sound === VOICE_SOUND;
      },
      show: (app) => {
        app.voice.open();
        soon(app, 500, () => { if (app.voice.isOpen) app.voice.dice(); });
        soon(app, 2600, () => { if (app.voice.isOpen) app.voice.close(); });
      },
      shown: "The ring was given a line to sing.",
      linger: 2600,
    },
  ],
};

const LIVE: Chapter = {
  id: "live",
  name: "Play it live",
  promise: "Hold an effect, drop out of a build-up, roll all the dice and take it back",
  end: "Nine effects beside the wheel, dice on every ring, and Undo behind it all: nothing you try can break it.",
  tasks: [
    hold("dumpf", "Dull", "KeyZ", "Press and hold [Dull] while it plays: it sounds muffled. Let go: it is clear again.", "Hold and let go: that is how an effect is played."),
    hold("aufbau", "Build-up", "IntlBackslash", "Hold [Build-up] for two seconds or more, then let go: the beat crashes back in.", "The longer it is held, the higher it builds.", 1500),
    {
      line: "Right-click [Echo]: it stays on by itself. Click it again to let it go.",
      keys: "Shift with {key:KeyV} makes the echo stay, {key:KeyV} alone lets it go.",
      after: "An effect that stays leaves both hands free.",
      only: "mouse",
      quiet: true,
      starts: true,
      mark: node('#fx [data-fx="wurf"]'),
      done: (app, notes) => {
        if (app.latched.has("wurf")) notes.latched = true;
        return notes.latched === true && !app.latched.has("wurf");
      },
      show: (app) => {
        if (!app.playing) app.togglePlay();
        if (!app.latched.has("wurf")) app.latchFx("wurf");
        later(1600, () => { if (app.latched.has("wurf")) app.latchFx("wurf"); });
      },
      shown: "The echo was made to stay for a moment and let go.",
      linger: 1200,
    },
    {
      line: "Click [Dice everything] under the list: seven new patterns. Then Undo ↶ at the top: yours are back.",
      touch: "Tap [Dice everything] under the list: seven new patterns. Then Undo ↶ at the top: yours are back.",
      keys: "Ctrl+Z is Undo, on every keyboard.",
      after: "Whatever the dice throw, yours is one step back.",
      quiet: true,
      mark: (app) => ({ kind: "node", selector: app.guide.heard("dice-all") ? "#undo" : "#dice-all" }),
      done: (_app, _notes, deeds) => {
        const rolled = deeds.findIndex((deed) => deed.what === "dice-all");
        return rolled >= 0 && deeds.slice(rolled + 1).some((deed) => deed.what === "undo");
      },
      show: (app) => {
        // (Rolled by the visitor already: then only the step back is shown.)
        const rolled = app.guide.heard("dice-all");
        if (!rolled) app.rings.diceAll();
        // Taken back only if the dice were really rolled, and the visitor has not taken them back already.
        soon(app, rolled ? 500 : 1800, () => { if (app.guide.heard("dice-all") && !app.guide.heard("undo")) app.undo(); });
      },
      shown: "All dice were rolled and the step taken back.",
      linger: 1600,
    },
  ],
};

const SCENES: Chapter = {
  id: "scenes",
  name: "A second part",
  promise: "A second part for your loop, and a row that plays both in turn",
  end: "Two parts, played in turn. “Scene” on the same switch plays one part alone again.",
  lends: (app) => clone(app.project),
  tasks: [
    {
      line: "Click [an empty square under “Scenes”]: a second part, a copy of this one.",
      touch: "Tap [an empty square under “Scenes”]: a second part, a copy of this one.",
      keys: "The underlined words take the keyboard to an empty square; Enter makes the copy.",
      after: "A scene is one wheel. Eight of them make the parts of a piece.",
      mark: (app) => ({ kind: "node", selector: app.project.scenes.includes(null) ? "#scenes .scene:not(.filled)" : "#scenes" }),
      begin: (app, notes) => { notes.filled = app.project.scenes.filter((scene) => scene !== null).length; },
      // (All eight filled already: there is nothing to copy into, and nothing to learn here that was not done before.)
      done: (app, notes) => !app.project.scenes.includes(null) || app.project.scenes.filter((scene) => scene !== null).length > (notes.filled as number),
      show: (app) => {
        const free = app.project.scenes.findIndex((scene) => scene === null);
        if (free >= 0) app.scenes.pick(free);
      },
      shown: "An empty scene became a copy of the one on the table.",
      linger: 1600,
    },
    {
      line: "Click [the dice beside Bass]: this part gets another bass line.",
      touch: "Tap [the dice beside Bass]: this part gets another bass line.",
      keys: "{key:Digit5} picks the Bass, {key:KeyN} rolls its dice.",
      after: "The sounds are the same in every scene; the patterns are each scene's own.",
      quiet: true,
      mark: node(row(BASS, "roll")),
      // Every scene's patterns are noted: while it plays, a scene that was just picked comes onto the table at the next
      // bar line. And any change to the scene on the table counts, the dice of another ring as well.
      begin: (app, notes) => { notes.was = app.project.scenes.map((scene) => (scene ? JSON.stringify(scene.patterns) : null)); },
      done: (app, notes) => {
        const was = (notes.was as (string | null)[])[app.project.scene];
        return typeof was === "string" && JSON.stringify(currentScene(app.project).patterns) !== was;
      },
      show: (app) => app.rings.dice(BASS),
      shown: "The bass got another line in this scene.",
      linger: 2000,
    },
    {
      line: "Switch to [Row] under the scenes: the parts play one after the other.",
      keys: "The underlined word takes the keyboard to “Row”; Enter switches to it.",
      after: "The row lies under the wheel now: one tile for each turn.",
      mark: node('#plays [data-plays="row"]'),
      done: (app) => app.scenes.plays === "row",
      show: (app) => app.scenes.setPlays("row"),
      shown: "The row plays now.",
      linger: 1600,
    },
    {
      line: "Click [play] and listen until the wheel changes to the other part.",
      touch: "Tap [play] and listen until the wheel changes to the other part.",
      keys: "The space bar starts and stops.",
      after: "It changed by itself when the turn was over.",
      starts: true,
      mark: () => ({ kind: "hub" }),
      begin: (_app, notes) => { delete notes.first; },
      done: (app, notes) => {
        const sounding = app.scenes.sounding;
        if (sounding === null) return false;
        notes.first ??= sounding;
        return sounding !== notes.first;
      },
      // Skipped here: nothing changes by itself while one part plays alone, or while the row holds only one.
      miss: (app) => {
        if (new Set(app.project.order).size < 2) return "The row holds one part only: an empty square under “Scenes” makes a second.";
        return app.scenes.plays === "row" ? null : "The parts take turns only on “Row”: it is on the switch under the scenes.";
      },
      show: (app) => {
        const free = app.scenes.free();
        if (new Set(app.project.order).size < 2 && free >= 0) app.scenes.pick(free);
        if (app.scenes.plays !== "row") app.scenes.setPlays("row");
        if (!app.playing) app.togglePlay();
      },
      shown: "It plays. The scene changes at the end of the turn.",
      linger: 2400,
    },
  ],
};

const SAMPLE: Chapter = {
  id: "sample",
  name: "Sample a ring",
  promise: "Turn a ring into a recording of itself, then turn it round and play it backwards",
  end: "A file or the microphone come in the same way: “Load a file …” and “Microphone” on the sampler's side.",
  lends: (app) => clone(app.project),
  tasks: [
    {
      line: "Click [Sample] in the ring's panel: the panel turns over to the sampler.",
      touch: "Tap [Sample] in the ring's panel: the panel turns over to the sampler.",
      keys: "{key:Digit0} turns the panel over and back.",
      after: "Here a ring plays a recording instead of a sound.",
      mark: node("#sample-open"),
      begin: (app) => {
        // A ring that plays something, and not a recording already: its own sound is what gets resampled.
        const fits = (track: number): boolean => hitsOf(app, track).length > 0 && trackOf(app.project, track).sound !== SAMPLE_SOUND;
        if (app.focus === "ring" && fits(app.selected)) return;
        const ring = [BASS, MELODY, 5, HAT, SNARE, KICK, 3].find(fits);
        app.select(ring ?? BASS);
        // (Nothing on the wheel plays: the copy this lesson works on gets a bass line to sample.)
        if (ring === undefined && hitsOf(app, BASS).length === 0) app.rings.dice(BASS);
      },
      done: (app) => app.sample.open,
      show: (app) => { if (!app.sample.open) app.sample.toggle(); },
      shown: "The sampler is open.",
      linger: 1000,
    },
    {
      line: "Click [This ring] beside “Resample”: the ring becomes a recording of itself.",
      touch: "Tap [This ring] beside “Resample”: the ring becomes a recording of itself.",
      keys: "The underlined words take the keyboard there; Enter resamples.",
      after: "It lies around the ring like a record: each hit drops the needle there.",
      mark: node("#sample-press-ring"),
      done: (app) => {
        const settings = trackOf(app.project, app.selected);
        return settings.sound === SAMPLE_SOUND && settings.sample?.mode === SLICES && app.sample.busy === null && app.sample.state === "ready";
      },
      show: (app) => {
        if (!app.sample.open) app.sample.toggle();
        void app.sample.press(true);
      },
      shown: "The ring was resampled onto itself.",
      linger: 2600,
    },
    {
      line: "Drag [the slider “Turn”]: every hit now plays another bit of the recording.",
      keys: "The underlined words take the keyboard to the slider; the arrow keys turn it.",
      after: "The same hits, another part of the recording under each.",
      quiet: true,
      mark: node("#sample-turn"),
      begin: (app, notes) => { notes.turn = trackOf(app.project, app.selected).sample?.turn ?? 0; },
      done: (app, notes) => (trackOf(app.project, app.selected).sample?.turn ?? 0) !== notes.turn,
      miss: (app) => (sampled(app, app.selected) ? null : NO_RECORDING),
      show: (app) => onRecording(app, () => {
        app.sample.shape({ turn: ((trackOf(app.project, app.selected).sample?.turn ?? 0) + 3) % patternOf(app.project, app.selected).len });
      }),
      shown: "The recording was turned by three steps.",
      linger: 2400,
    },
    {
      line: "Click [Backwards]: the recording runs the other way.",
      touch: "Tap [Backwards]: the recording runs the other way.",
      keys: "The underlined word takes the keyboard there; Enter switches it.",
      after: "Chopped, turned and backwards: that is resampling.",
      quiet: true,
      mark: node("#sample-back"),
      begin: (app, notes) => { notes.back = trackOf(app.project, app.selected).sample?.back ?? false; },
      done: (app, notes) => (trackOf(app.project, app.selected).sample?.back ?? false) !== notes.back,
      miss: (app) => (sampled(app, app.selected) ? null : NO_RECORDING),
      show: (app) => onRecording(app, () => app.sample.shape({ back: !(trackOf(app.project, app.selected).sample?.back ?? false) })),
      shown: "The recording plays backwards now.",
      linger: 2400,
    },
  ],
};

const SHARE: Chapter = {
  id: "share",
  name: "Share and show",
  promise: "Send your Kreisel as a link, and put it on the stage",
  end: "Whoever opens the link gets a copy of their own. The button in the wheel's corner leaves the stage again.",
  tasks: [
    {
      line: "Open [Share] at the top and choose “Copy link”: the whole Kreisel is in that link.",
      touch: "Tap [the link button] at the top and choose “Copy link”: the whole Kreisel is in that link.",
      keys: "The underlined word takes the keyboard to “Share”: Enter opens it, Enter again on “Copy link”.",
      after: "No account, no upload: the link is the Kreisel.",
      mark: node("#share"),
      done: (_app, _notes, deeds) => deeds.some((deed) => deed.what === "share"),
      show: (app) => void app.files.share(),
      shown: "The link was copied.",
      linger: 2000,
    },
    {
      line: "Click [the stage button] at the wheel's upper corner: only the wheel, in the dark.",
      touch: "Tap [the stage button] at the wheel's upper corner: only the wheel, in the dark.",
      keys: "{key:KeyO} goes on stage, Esc comes back.",
      after: "Made for watching it turn.",
      mark: node("#stage-toggle"),
      done: (app) => app.stage,
      show: (app) => app.toggleStage(true),
      shown: "The wheel is on the stage.",
      linger: 2200,
    },
  ],
};

/** The lessons, in the order they are offered. */
export const CHAPTERS: readonly Chapter[] = [FIRST, BEAT, SOUNDS, LIVE, SCENES, SAMPLE, SHARE];

/** The tasks of a lesson that this visitor can do: without the ones a finger has no way of doing. */
export const tasksFor = (chapter: Chapter, touch: boolean): readonly Task[] => chapter.tasks.filter((task) => !(touch && task.only === "mouse"));

/** A task's sentence as it is said: the brackets around the place's name gone, every key by the name the keyboard gives it. */
export function plain(text: string, keyName: (code: string) => string): string {
  return text.replace(/\[([^\]]+)\]/g, "$1").replace(/\{key:(\w+)\}/g, (_all, code: string) => keyName(code));
}

/** What the card says while a task about sound is up and nothing plays. */
export const QUIET = { mouse: "Nothing plays yet: click play in the middle of the wheel, or press the space bar.", touch: "Nothing plays yet: tap play in the middle of the wheel." } as const;

/*
 * The physical keys the Kreisel is played on, by their place on the keyboard
 * (what stands on them depends on the keyboard's layout): tools on the top
 * row, playing on the home row, held effects on the bottom row.
 */

export const TOOL_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"] as const;
/** The six kinds of weather: the top row, one key further. */
export const WEATHER_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY"] as const;
export const PLAY_CODES = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"] as const;
/**
 * The five effects on the bottom row, and the build-up held by hand on the key at its left end (the one between Shift
 * and Y on a German keyboard, "<"). To the right of the five the row is taken: N and M are dice and mute, comma and
 * period go through the scenes. A keyboard without that key has the build-up under the mouse only. The three effects
 * of a DJ's mixer (Wash, Jet, Crush) have the keys to the right of L and P, which carry the three umlauts on a German
 * keyboard and ; ' [ on an American one.
 */
export const FX_CODES = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "IntlBackslash", "Semicolon", "Quote", "BracketLeft"] as const;

/** Which key of a row this is, counted from the left; −1 if it is not in the row. */
export const place = (row: readonly string[], code: string): number => row.indexOf(code);

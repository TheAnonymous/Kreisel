/*
 * The physical keys the Kreisel is played on, by their place on the keyboard
 * (what stands on them depends on the keyboard's layout): tools on the top
 * row, playing on the home row, held effects on the bottom row.
 */

export const TOOL_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"] as const;
/** The six kinds of weather: the top row, one key further. */
export const WEATHER_CODES = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY"] as const;
export const PLAY_CODES = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"] as const;
/** The five effects on the bottom row; N and M are dice and mute, so the build-up held by hand is on the key after them. */
export const FX_CODES = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "Comma"] as const;

/** Which key of a row this is, counted from the left; −1 if it is not in the row. */
export const place = (row: readonly string[], code: string): number => row.indexOf(code);

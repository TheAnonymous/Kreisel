import { packBild, unpackBild } from "./codec";
import { clamp, TRACK_COUNT, type Bild } from "./model";

/*
 * Pictures worth keeping. A project holds one own sound per ring; the
 * collection outlives projects, so a sound painted last week can go into
 * today's Kreisel, or a kick's picture into the bass.
 */

export interface Kept {
  /** The ring it was painted for (its colour on the shelf). */
  ring: number;
  /** The picture, packed as in a link. */
  bild: string;
}

const KEY = "kreisel.klaenge.v1";
export const MAX_KEPT = 24;

export function loadKept(): Kept[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    const kept: Kept[] = [];
    for (const item of list.slice(0, MAX_KEPT)) {
      const { ring, bild } = (item ?? {}) as { ring?: unknown; bild?: unknown };
      const picture = unpackBild(bild);
      if (picture && picture.strokes.length > 0) kept.push({ ring: clamp(Math.round(Number(ring) || 0), 0, TRACK_COUNT - 1), bild: packBild(picture) });
    }
    return kept;
  } catch {
    return [];
  }
}

export function saveKept(kept: readonly Kept[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // No storage: the shelf lasts for this visit.
  }
}

/** Puts a picture at the front of the shelf; `false` if it is already there or empty. */
export function keep(kept: Kept[], ring: number, bild: Bild): boolean {
  if (bild.strokes.length === 0) return false;
  const packed = packBild(bild);
  if (kept.some((item) => item.bild === packed)) return false;
  kept.unshift({ ring, bild: packed });
  kept.length = Math.min(kept.length, MAX_KEPT);
  return true;
}

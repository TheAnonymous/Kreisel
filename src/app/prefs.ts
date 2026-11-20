import { MAX_NAME } from "../model";

/*
 * What this browser remembers about the person in front of it, across
 * projects: a few switches and the name they play Reihum under. Where the
 * browser keeps nothing, everything holds for this visit.
 */

/** A switch kept in this browser. */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const kept = localStorage.getItem(key);
    return kept === null ? fallback : kept === "1";
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Not kept: it holds for this visit.
  }
}

/** The name this person plays Reihum under. */
export function readName(): string {
  try {
    return (localStorage.getItem("kreisel.name") ?? "").slice(0, MAX_NAME);
  } catch {
    return "";
  }
}

export function writeName(name: string): void {
  try {
    localStorage.setItem("kreisel.name", name);
  } catch {
    // Not kept: it holds for this visit.
  }
}

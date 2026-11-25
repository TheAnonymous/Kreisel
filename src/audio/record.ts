import { microphoneSession } from "klangwerk";

/*
 * Recording the microphone for a sample. The browser's own recorder writes
 * what it hears into a small file (Opus in most browsers), which is then
 * brought in like any other sound file. Unlike "Show it" in the paint box,
 * which only listens, this keeps the sound.
 */

export interface Take {
  /** Ends the recording and gives the file; `null` if nothing was recorded. */
  stop(): Promise<Blob | null>;
  /** Seconds since the recording began. */
  seconds(): number;
}

/** The longest a recording runs before it ends by itself, in seconds. */
export const LONGEST_TAKE = 30;

export function canRecord(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

/**
 * Starts recording. Rejects (with the browser's error) when the microphone is refused or missing. `onEnd` is called
 * when the recording ends by itself after `LONGEST_TAKE` seconds: then `stop` gives what there is.
 */
export async function startTake(onEnd: () => void): Promise<Take> {
  // A recording of music wants the sound as it is: none of what a browser does to make speech clearer.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  microphoneSession(true);
  const parts: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) parts.push(event.data);
  });
  const began = performance.now();
  let over: Promise<Blob | null> | null = null;
  const end = (): Promise<Blob | null> => {
    over ??= new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(limit);
        for (const track of stream.getTracks()) track.stop();
        microphoneSession(false);
        resolve(parts.length > 0 ? new Blob(parts, { type: recorder.mimeType }) : null);
      };
      if (recorder.state === "inactive") finish();
      else {
        recorder.addEventListener("stop", finish, { once: true });
        recorder.stop();
      }
    });
    return over;
  };
  const limit = setTimeout(() => {
    void end();
    onEnd();
  }, LONGEST_TAKE * 1000);
  recorder.start();
  return {
    stop: end,
    seconds: () => (performance.now() - began) / 1000,
  };
}

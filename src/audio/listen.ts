import { microphoneSession } from "klangwerk";
import { analyse, type Frame } from "../imitate";

/*
 * Listens to the microphone for one sound: waits for something to be heard,
 * follows it until it has died away (or a second and a half has passed) and
 * returns what it heard as frames. Nothing is recorded or kept: each window
 * of sound is boiled down to three numbers and dropped.
 */

export interface ListenOptions {
  /** Called every frame with the loudness, and whether the sound has begun. */
  onLevel?(level: number, begun: boolean): void;
  /** Aborting stops the listening; what was heard so far is returned. */
  signal?: AbortSignal;
}

const WAIT_SECONDS = 6;
const SOUND_SECONDS = 1.5;
const QUIET_SECONDS = 0.28;
const LOUD = 0.02;

export function canListen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioContext !== "undefined";
}

/** Rejects (with the browser's error) when the microphone is refused or missing. */
export async function listen(options: ListenOptions = {}): Promise<Frame[]> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  // iPhones: while the microphone is open, the page's sound session has to allow recording.
  microphoneSession(true);
  const context = new AudioContext();
  const frames: Frame[] = [];
  try {
    await context.resume().catch(() => undefined);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = context.currentTime;
    let began: number | null = null;
    let lastLoud = 0;
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const time = context.currentTime - started;
        analyser.getFloatTimeDomainData(samples);
        const frame = { time, ...analyse(samples, context.sampleRate) };
        if (began === null && frame.level >= LOUD) began = time;
        if (began !== null) {
          frames.push(frame);
          if (frame.level >= LOUD * 0.5) lastLoud = time;
        }
        options.onLevel?.(frame.level, began !== null);
        const over = began === null ? time > WAIT_SECONDS : time - began > SOUND_SECONDS || time - lastLoud > QUIET_SECONDS;
        if (over || options.signal?.aborted) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    for (const track of stream.getTracks()) track.stop();
    microphoneSession(false);
    void context.close().catch(() => undefined);
  }
  return frames;
}

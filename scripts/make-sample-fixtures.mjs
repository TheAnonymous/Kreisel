/*
 * Makes the sound files the sampler's browser tests load (e2e/fixtures/samples/): one hit and one loop, written
 * here sample by sample, and the same two in every format the sampler is meant to read, made from them by ffmpeg.
 * The files are kept in the repository; run this again only to change them (it needs ffmpeg on the path):
 *
 *   node scripts/make-sample-fixtures.mjs
 *
 * hit:  0.1 s of silence, a pluck at 220 Hz (A) that dies away in 0.35 s, 0.25 s of silence. Mono, 44.1 kHz.
 *       Its silence is there to be trimmed, its pitch to be found.
 * loop: two bars at 150 BPM (3.2 s): a kick on every beat, a clap on two and four, a hat between the beats.
 *       Its hits are there to be found, and its length to be taken as two bars.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../e2e/fixtures/samples/", import.meta.url));
mkdirSync(dir, { recursive: true });
const RATE = 44_100;

/** A seeded noise, so that the files are the same every time. */
let seed = 20261125;
const noise = () => {
  seed = (seed * 48271) % 2147483647;
  return (seed / 2147483647) * 2 - 1;
};

function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return bytes;
}

const hit = new Float32Array(Math.round(0.7 * RATE));
for (let index = 0; index < Math.round(0.35 * RATE); index += 1) {
  const time = index / RATE;
  const fade = Math.min(1, index / 40) * Math.exp(-time * 11);
  hit[Math.round(0.1 * RATE) + index] = 0.6 * fade * (Math.sin(2 * Math.PI * 220 * time) + 0.35 * Math.sin(2 * Math.PI * 440 * time) + 0.15 * Math.sin(2 * Math.PI * 660 * time));
}

const step = 60 / 150 / 4;
const loop = new Float32Array(Math.round(32 * step * RATE));
const add = (at, length, voice) => {
  const from = Math.round(at * RATE);
  for (let index = 0; index < Math.round(length * RATE) && from + index < loop.length; index += 1) loop[from + index] += voice(index / RATE);
};
for (let at = 0; at < 32; at += 1) {
  if (at % 4 === 0) add(at * step, 0.18, (time) => 0.8 * Math.exp(-time * 18) * Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-time * 40)) * time));
  if (at % 8 === 4) add(at * step, 0.12, (time) => 0.45 * Math.exp(-time * 30) * noise());
  if (at % 4 === 2) add(at * step, 0.04, (time) => 0.22 * Math.exp(-time * 90) * noise());
}

writeFileSync(`${dir}hit.wav`, wav(hit));
writeFileSync(`${dir}loop.wav`, wav(loop));
const convert = (from, to, ...options) => {
  const done = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `${dir}${from}`, ...options, `${dir}${to}`], { stdio: "inherit" });
  if (done.status !== 0) throw new Error(`ffmpeg could not make ${to}`);
};
convert("hit.wav", "hit.aiff", "-c:a", "pcm_s16be");
convert("hit.wav", "hit.mp3", "-c:a", "libmp3lame", "-b:a", "96k");
convert("hit.wav", "hit.ogg", "-c:a", "libvorbis", "-q:a", "3");
convert("hit.wav", "hit.opus", "-c:a", "libopus", "-b:a", "48k");
convert("hit.wav", "hit.flac", "-c:a", "flac");
convert("hit.wav", "hit.m4a", "-c:a", "aac", "-b:a", "96k");
convert("hit.wav", "hit.webm", "-c:a", "libopus", "-b:a", "48k");
convert("hit.wav", "hit-24bit.wav", "-c:a", "pcm_s24le");
convert("loop.wav", "loop.opus", "-c:a", "libopus", "-b:a", "48k");
convert("loop.wav", "loop.mp3", "-c:a", "libmp3lame", "-b:a", "96k");
writeFileSync(`${dir}not-a-sound.txt`, "This is a text file, not a sound.\n");
console.log("made e2e/fixtures/samples/");

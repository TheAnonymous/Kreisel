import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.KREISEL_E2E_PORT ?? "4309", 10);

// Chromium's stand-in microphone plays a synthetic "bumm" (a falling tone) over and over: what "Vormachen" hears in the tests.
const microphone = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${fileURLToPath(new URL("./e2e/fixtures/bumm.wav", import.meta.url))}`,
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}/Kreisel/`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
  // Kreisel is built for the laptop first and has to work on a phone too.
  // Firefox takes a second look at everything it can: it cannot be granted the
  // clipboard, its offline switch does not reach service workers, and it has
  // no stand-in microphone that plays a file.
  projects: [
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 }, launchOptions: { args: microphone } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1366, height: 768 } }, grepInvert: /shares the Kreisel|in the link|shows a sound|without a network|on a phone/ },
  ],
});

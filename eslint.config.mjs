import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["**/*.ts"],
    plugins: { "@typescript-eslint": tseslint },
    languageOptions: { parser: tsParser, globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-debugger": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // The layers (see the README): the project and its rules, then sound, then the app, then the page.
  // Each may import from the ones before it, never from one after it. Only main.ts puts them together.
  {
    files: ["src/*.ts"],
    ignores: ["src/main.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["./audio/*", "./app/*", "./ui/*"], message: "The project's rules know nothing of sound, the app or the page." }] }] },
  },
  {
    files: ["src/sounds/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["../audio/*", "../app/*", "../ui/*"], message: "The palettes of sounds are plain numbers: they know nothing of sound, the app or the page." }] }] },
  },
  {
    files: ["src/audio/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["../app/*", "../ui/*"], message: "Sound knows nothing of the app or the page." }] }] },
  },
  {
    files: ["src/app/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["../ui/*"], message: "The app knows nothing of the page: the page calls in, and listens." }] }] },
  },
];

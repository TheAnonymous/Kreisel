import type { App } from "../app/app";
import { describeWeather, hasWeather, WEATHER_COLORS, WEATHER_HINTS, WEATHER_NAMES, windName, WINDS } from "../weather";
import { currentScene } from "../model";
import { byId, el, button } from "./dom";
import type { Panels } from "./panels";

/** Fog, sun, a cloud, rain, a spark, hail. */
const WEATHER_ICONS = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M6 12h15M3 16h14"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 10.8 1.3A3.4 3.4 0 0 1 17 18z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4 5 11M13 4l-3 7M18 4l-3 7M9 13l-3 7M15 13l-3 7"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="1.9" class="fill"/><circle cx="14" cy="5" r="1.9" class="fill"/><circle cx="18" cy="12" r="1.9" class="fill"/><circle cx="9" cy="13" r="1.9" class="fill"/><circle cx="15" cy="19" r="1.9" class="fill"/><circle cx="5" cy="19" r="1.9" class="fill"/></svg>',
];

/*
 * The weather's panel and its brushes: the six kinds of weather, dice and clearing, and a wind for each kind.
 */
export class WeatherPanel {
  private readonly weatherBox = el("div", "panel-box panel-weather");
  private readonly sky = { info: el("p", "info"), clear: button("button small", "Aufklaren", "Alles Wetter wegnehmen (Umschalt+Entf)") };
  readonly cloudButtons: HTMLButtonElement[] = [];
  private readonly windInputs: HTMLInputElement[] = [];
  private readonly windNames: HTMLElement[] = [];
  private weatherFocused = false;

  constructor(private readonly panels: Panels, private readonly app: App) {}

  /** The weather: its brushes (in the tools' place) and its panel, where every kind of weather has a wind. */
  build(): void {
    const app = this.app;
    const brushes = byId("weathers");
    WEATHER_NAMES.forEach((name, kind) => {
      const node = button("tool", "", WEATHER_HINTS[kind] ?? name);
      node.innerHTML = WEATHER_ICONS[kind] ?? "";
      node.style.setProperty("--w", WEATHER_COLORS[kind] ?? "currentColor");
      node.append(el("span", "name", name), el("kbd", "key"));
      node.setAttribute("role", "radio");
      node.addEventListener("click", () => app.weather.setCloud(kind));
      brushes.append(node);
      this.cloudButtons.push(node);
    });

    const head = el("header", "panel-head");
    head.append(el("span", "dot"), el("h2", "", "Wetter"));
    const doing = el("div", "doing");
    const roll = button("button small", "Würfeln", "Ein neues Wetter würfeln (N)");
    roll.id = "weather-dice";
    roll.addEventListener("click", () => app.weather.dice());
    this.sky.clear.id = "weather-clear";
    this.sky.clear.addEventListener("click", () => app.weather.clear());
    doing.append(roll, this.sky.clear);

    const winds = el("div", "group");
    winds.append(el("h3", "", "Wind: so zieht jedes Wetter um das Rad"));
    WEATHER_NAMES.forEach((name, kind) => {
      const line = el("label", "line sky");
      const swatch = el("span", "swatch");
      swatch.style.background = WEATHER_COLORS[kind] ?? "";
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = String(WINDS.length - 1);
      input.step = "1";
      input.title = `Wie schnell ${name} um das Rad zieht: nach links gegen, nach rechts mit dem Uhrzeiger · Rechtsklick hält es an`;
      input.addEventListener("input", () => app.weather.setWind(kind, WINDS[Number(input.value)] ?? 0, "wind"));
      input.addEventListener("change", () => app.store.settle());
      input.addEventListener("pointerdown", (event) => {
        if (event.button !== 2) return;
        app.weather.setWind(kind, 0);
      });
      input.addEventListener("contextmenu", (event) => event.preventDefault());
      const speed = el("output");
      line.append(swatch, el("span", "label", name), input, speed);
      winds.append(line);
      this.windInputs.push(input);
      this.windNames.push(speed);
    });
    const hint = el("p", "easel-hint", "Mal Wetter auf das Rad: Wie weit außen, sagt welcher Ring, der Winkel sagt wann. Ein Strich quer über mehrere Ringe trifft sie alle. Noch einmal darüber macht es stärker, die rechte Taste nimmt es weg, das Mausrad ändert die Pinselbreite. Mit Wind zieht das Wetter Takt für Takt weiter.");
    this.weatherBox.append(head, this.sky.info, doing, winds, hint);
    this.weatherBox.hidden = true;
    byId("panel").append(this.weatherBox);
  }

  /** The weather in the list of rings, its brushes and its panel. */
  sync(): void {
    const app = this.app;
    const scene = currentScene(app.project);
    const focus = app.weather.focused;
    const kinds = WEATHER_NAMES.filter((_, kind) => hasWeather(scene, kind));
    this.panels.weatherRow.classList.toggle("selected", focus);
    this.panels.weatherRow.classList.toggle("silent", kinds.length === 0);
    this.panels.weatherRow.querySelector(".pick")!.setAttribute("aria-pressed", String(focus));
    this.panels.weatherRow.querySelector(".sound")!.textContent = kinds.length === 0 ? "klar" : kinds.length <= 2 ? kinds.join(", ") : `${kinds.length} Wetter`;
    byId("weathers").hidden = !focus;
    this.weatherBox.hidden = !focus;
    if (focus) {
      // The weather has the panel to itself.
      this.panels.ringBox.hidden = true;
      this.panels.pieceBox.hidden = true;
      this.panels.veilBox.hidden = true;
      // It is painted on the wheel: where the list sits below it, bring the wheel into view.
      if (!this.weatherFocused) {
        this.panels.endTour();
        byId("stage").scrollIntoView({ block: "nearest" });
      }
    }
    this.weatherFocused = focus;
    if (!focus) return;
    this.sky.info.textContent = describeWeather(scene);
    this.sky.clear.disabled = kinds.length === 0;
    this.cloudButtons.forEach((node, kind) => node.setAttribute("aria-checked", String(kind === app.weather.cloud)));
    this.windInputs.forEach((input, kind) => {
      const wind = scene.wind[kind] ?? 0;
      const index = WINDS.indexOf(wind as (typeof WINDS)[number]);
      if (document.activeElement !== input || index >= 0) input.value = String(index >= 0 ? index : WINDS.findIndex((value) => value >= wind));
      this.windNames[kind]!.textContent = windName(wind);
    });
  }
}

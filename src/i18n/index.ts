import { useSettingsStore } from "../store/settings";
import { zh } from "./zh";
import { en } from "./en";

export type Translations = typeof zh;

function resolveLocale(lang: string): "zh" | "en" {
  if (lang === "zh") return "zh";
  if (lang === "en") return "en";
  // "system" — detect from browser
  if (typeof navigator !== "undefined") {
    return navigator.language.startsWith("zh") ? "zh" : "en";
  }
  return "zh";
}

/** Non-reactive — reads current language from store directly.
 *  Use in non-React code (e.g. mergeMessages). */
export function getT(): Translations {
  const lang = resolveLocale(useSettingsStore.getState().system.language);
  return lang === "zh" ? zh : en;
}

/** Reactive hook — re-renders when language setting changes. */
export function useT(): Translations {
  const language = useSettingsStore((s) => s.system.language);
  const lang = resolveLocale(language);
  return lang === "zh" ? zh : en;
}

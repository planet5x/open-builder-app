import { useEffect, useSyncExternalStore } from "react";
import { useSettingsStore } from "../store/settings";

const mq =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function subscribeToDarkClass(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getIsDark() {
  return document.documentElement.classList.contains("dark");
}

/** Apply theme class and return resolved isDark boolean. */
export function useTheme() {
  const theme = useSettingsStore((s) => s.system.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => root.classList.toggle("dark", dark);

    if (theme === "light") {
      apply(false);
      return;
    }
    if (theme === "dark") {
      apply(true);
      return;
    }

    // "system" — follow OS preference
    if (mq) {
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  return useSyncExternalStore(subscribeToDarkClass, getIsDark, () => false);
}

import { useEffect, useState } from "react";

export type AppLayoutMode = "mobile" | "tablet" | "desktop";

export interface AppLayoutEnvironment {
  viewportWidth: number;
  screenWidth: number;
  screenHeight: number;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

const MOBILE_BREAKPOINT = 768;
const TABLET_MIN_SHORT_EDGE = 600;

export function classifyAppLayout({
  viewportWidth,
  screenWidth,
  screenHeight,
  userAgent,
  platform,
  maxTouchPoints,
}: AppLayoutEnvironment): AppLayoutMode {
  const isPhone = /iPhone|iPod|Android.*Mobile/i.test(userAgent);
  if (isPhone) return "mobile";

  const shortScreenEdge = Math.min(screenWidth, screenHeight);
  const hasTabletScreen = shortScreenEdge >= TABLET_MIN_SHORT_EDGE;
  const isIpad = /iPad/i.test(userAgent);
  const isIpadOs =
    /Mac/i.test(platform) && /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  const isAndroidTablet =
    /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);

  if (hasTabletScreen && (isIpad || isIpadOs || isAndroidTablet)) {
    return "tablet";
  }

  return viewportWidth < MOBILE_BREAKPOINT ? "mobile" : "desktop";
}

function getCurrentLayout(): AppLayoutMode {
  if (typeof window === "undefined") return "desktop";

  return classifyAppLayout({
    viewportWidth: window.innerWidth,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    maxTouchPoints: window.navigator.maxTouchPoints,
  });
}

export function useAppLayout(): AppLayoutMode {
  const [layout, setLayout] = useState(getCurrentLayout);

  useEffect(() => {
    const updateLayout = () => setLayout(getCurrentLayout());
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, []);

  return layout;
}

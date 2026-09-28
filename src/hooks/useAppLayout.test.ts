import { describe, expect, it } from "vitest";
import { classifyAppLayout, type AppLayoutEnvironment } from "./useAppLayout";

const desktopEnvironment: AppLayoutEnvironment = {
  viewportWidth: 1024,
  screenWidth: 1920,
  screenHeight: 1080,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  platform: "MacIntel",
  maxTouchPoints: 0,
};

describe("classifyAppLayout", () => {
  it.each([
    {
      name: "iPad portrait",
      expected: "tablet",
      environment: {
        viewportWidth: 768,
        screenWidth: 768,
        screenHeight: 1024,
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
        platform: "iPad",
        maxTouchPoints: 5,
      },
    },
    {
      name: "iPad landscape",
      expected: "tablet",
      environment: {
        viewportWidth: 1024,
        screenWidth: 1024,
        screenHeight: 768,
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
        platform: "iPad",
        maxTouchPoints: 5,
      },
    },
    {
      name: "modern iPadOS",
      expected: "tablet",
      environment: {
        viewportWidth: 1366,
        screenWidth: 1366,
        screenHeight: 1024,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      },
    },
    {
      name: "Android tablet",
      expected: "tablet",
      environment: {
        viewportWidth: 800,
        screenWidth: 1280,
        screenHeight: 800,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel Tablet)",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      },
    },
    {
      name: "iPhone landscape",
      expected: "mobile",
      environment: {
        viewportWidth: 844,
        screenWidth: 844,
        screenHeight: 390,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    },
  ] as const)("classifies $name", ({ environment, expected }) => {
    expect(classifyAppLayout(environment)).toBe(expected);
  });

  it("keeps the default 1024x768 desktop window in desktop layout", () => {
    expect(classifyAppLayout(desktopEnvironment)).toBe("desktop");
  });

  it("uses the mobile layout for a narrow desktop window", () => {
    expect(
      classifyAppLayout({ ...desktopEnvironment, viewportWidth: 700 }),
    ).toBe("mobile");
  });

  it("does not treat a touch-enabled Windows desktop as a tablet", () => {
    expect(
      classifyAppLayout({
        ...desktopEnvironment,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 10,
      }),
    ).toBe("desktop");
  });
});

import { describe, expect, it } from "vitest";
import { getNextVisibleCount, getVisibleListWindow } from "./list-window";

describe("list window helpers", () => {
  it("returns a bounded visible slice with hidden item metadata", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);

    const window = getVisibleListWindow(items, 4);

    expect(window.visible).toEqual([0, 1, 2, 3]);
    expect(window.visibleCount).toBe(4);
    expect(window.hiddenCount).toBe(6);
    expect(window.hasMore).toBe(true);
  });

  it("clamps invalid counts and next batch sizes", () => {
    expect(getVisibleListWindow([1, 2, 3], -10).visible).toEqual([]);
    expect(getVisibleListWindow([1, 2, 3], 99).visible).toEqual([1, 2, 3]);
    expect(getNextVisibleCount(3, 10, 4)).toBe(7);
    expect(getNextVisibleCount(9, 10, 4)).toBe(10);
    expect(getNextVisibleCount(0, 10, 0)).toBe(1);
  });
});

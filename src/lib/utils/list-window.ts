export interface VisibleListWindow<T> {
  visible: T[];
  visibleCount: number;
  hiddenCount: number;
  hasMore: boolean;
}

export function getVisibleListWindow<T>(
  items: T[],
  requestedCount: number,
): VisibleListWindow<T> {
  const visibleCount = Math.max(
    0,
    Math.min(items.length, Math.floor(requestedCount)),
  );
  const hiddenCount = items.length - visibleCount;
  return {
    visible: items.slice(0, visibleCount),
    visibleCount,
    hiddenCount,
    hasMore: hiddenCount > 0,
  };
}

export function getNextVisibleCount(
  currentCount: number,
  totalCount: number,
  batchSize: number,
): number {
  const safeBatch = Math.max(1, Math.floor(batchSize));
  return Math.min(totalCount, Math.max(0, currentCount) + safeBatch);
}

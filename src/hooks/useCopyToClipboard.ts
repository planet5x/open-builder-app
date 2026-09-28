import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), resetMs);
      } catch {
        // Clipboard API can fail in non-secure contexts; the affordance is
        // additive, so a silent failure is fine.
      }
    },
    [resetMs],
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return [copied, copy] as const;
}

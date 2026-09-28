import { useEffect, useMemo, useRef } from "react";
import type { Change } from "diff";
import { cn } from "@/lib/utils";
import { highlightLine, languageFor } from "./highlight";

export type DiffMode = "unified" | "split";

interface DiffLine {
  kind: "context" | "added" | "removed";
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
}

interface DiffViewerProps {
  path: string;
  changes: Change[];
  mode: DiffMode;
  /** Index of the change block to jump to. Triggers a scroll-into-view. */
  jumpTo: number | null;
  /** Called when the viewer recomputes change anchors, so the parent's
   *  next/prev counters stay in sync. */
  onChangeCount: (count: number) => void;
}

function buildLines(changes: Change[]): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of changes) {
    const rawLines = change.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") rawLines.pop();
    for (const text of rawLines) {
      if (change.added) {
        out.push({
          kind: "added",
          oldLineNo: null,
          newLineNo: newLine++,
          text,
        });
      } else if (change.removed) {
        out.push({
          kind: "removed",
          oldLineNo: oldLine++,
          newLineNo: null,
          text,
        });
      } else {
        out.push({
          kind: "context",
          oldLineNo: oldLine,
          newLineNo: newLine,
          text,
        });
        oldLine++;
        newLine++;
      }
    }
  }
  return out;
}

/** Group consecutive add/remove lines into a single "change block" so the
 *  jump-next/prev buttons step over related edits as one unit. */
function buildChangeBlocks(lines: DiffLine[]): number[] {
  const out: number[] = [];
  let prev: DiffLine["kind"] = "context";
  for (let i = 0; i < lines.length; i++) {
    const k = lines[i].kind;
    if (k !== "context" && prev === "context") out.push(i);
    prev = k;
  }
  return out;
}

export function DiffViewer({
  path,
  changes,
  mode,
  jumpTo,
  onChangeCount,
}: DiffViewerProps) {
  const lang = useMemo(() => languageFor(path), [path]);
  const lines = useMemo(() => buildLines(changes), [changes]);
  const blocks = useMemo(() => buildChangeBlocks(lines), [lines]);
  const highlightedLines = useMemo(
    () => lines.map((l) => highlightLine(l.text, lang)),
    [lines, lang],
  );

  const leftRef = useRef<HTMLPreElement>(null);
  const rightRef = useRef<HTMLPreElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    onChangeCount(blocks.length);
  }, [blocks, onChangeCount]);

  useEffect(() => {
    if (jumpTo == null) return;
    const lineIdx = blocks[jumpTo];
    if (lineIdx == null) return;
    const el = lineRefs.current[lineIdx];
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [jumpTo, blocks]);

  if (mode === "split") {
    return (
      <SplitView
        lines={lines}
        lang={lang}
        leftRef={leftRef}
        rightRef={rightRef}
      />
    );
  }

  return (
    <div className="text-xs font-mono leading-5">
      <pre className="p-2 m-0">
        {lines.map((line, idx) => (
          <div
            key={idx}
            ref={(el) => {
              lineRefs.current[idx] = el;
            }}
            data-change={line.kind === "context" ? undefined : line.kind}
            className={cn(
              "flex",
              line.kind === "added" &&
                "bg-green-500/10 text-green-700 dark:text-green-400",
              line.kind === "removed" &&
                "bg-red-500/10 text-red-700 dark:text-red-400",
            )}
          >
            <span className="inline-block w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">
              {line.oldLineNo ?? ""}
            </span>
            <span className="inline-block w-10 shrink-0 text-right pr-3 text-muted-foreground/60 select-none">
              {line.newLineNo ?? ""}
            </span>
            <span className="select-none w-4 shrink-0">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            </span>
            <span
              className="whitespace-pre-wrap break-all flex-1"
              dangerouslySetInnerHTML={{ __html: highlightedLines[idx] }}
            />
          </div>
        ))}
      </pre>
    </div>
  );
}

interface SplitViewProps {
  lines: DiffLine[];
  lang: string | null;
  leftRef: React.RefObject<HTMLPreElement | null>;
  rightRef: React.RefObject<HTMLPreElement | null>;
}

/** Build aligned left/right rows for the split view. Removed lines have an
 *  empty right slot; added lines have an empty left slot; context fills both.
 *  Pairing consecutive removed/added blocks yields visually balanced rows. */
function buildSplitRows(
  lines: DiffLine[],
): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const rows: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    // Collect a block of consecutive removed lines, then added lines.
    const removed: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "removed") {
      removed.push(lines[i]);
      i++;
    }
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "added") {
      added.push(lines[i]);
      i++;
    }
    const max = Math.max(removed.length, added.length);
    for (let k = 0; k < max; k++) {
      rows.push({
        left: removed[k] ?? null,
        right: added[k] ?? null,
      });
    }
  }
  return rows;
}

function SplitView({ lines, lang, leftRef, rightRef }: SplitViewProps) {
  const rows = useMemo(() => buildSplitRows(lines), [lines]);
  const rowHighlights = useMemo(
    () =>
      rows.map((row) => ({
        left: row.left ? highlightLine(row.left.text, lang) : "",
        right: row.right ? highlightLine(row.right.text, lang) : "",
      })),
    [rows, lang],
  );

  // Two-way scroll sync, debounced via a re-entry guard so neither side fights
  // the other while flushing scrollTop assignments.
  const syncingRef = useRef(false);
  const handleScroll = (
    source: React.RefObject<HTMLPreElement | null>,
    target: React.RefObject<HTMLPreElement | null>,
  ) => {
    if (syncingRef.current) return;
    if (!source.current || !target.current) return;
    syncingRef.current = true;
    target.current.scrollTop = source.current.scrollTop;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  return (
    <div className="grid grid-cols-2 gap-0 text-xs font-mono leading-5">
      <pre
        ref={leftRef}
        onScroll={() => handleScroll(leftRef, rightRef)}
        className="p-2 m-0 border-r border-border/40 overflow-auto max-h-[60vh]"
      >
        {rows.map((row, idx) => (
          <SplitLine
            key={`L-${idx}`}
            line={row.left}
            side="left"
            html={rowHighlights[idx].left}
          />
        ))}
      </pre>
      <pre
        ref={rightRef}
        onScroll={() => handleScroll(rightRef, leftRef)}
        className="p-2 m-0 overflow-auto max-h-[60vh]"
      >
        {rows.map((row, idx) => (
          <SplitLine
            key={`R-${idx}`}
            line={row.right}
            side="right"
            html={rowHighlights[idx].right}
          />
        ))}
      </pre>
    </div>
  );
}

function SplitLine({
  line,
  side,
  html,
}: {
  line: DiffLine | null;
  side: "left" | "right";
  html: string;
}) {
  if (!line) {
    return <div className="bg-muted/30 h-5">&nbsp;</div>;
  }
  const isModified =
    (side === "left" && line.kind === "removed") ||
    (side === "right" && line.kind === "added");
  return (
    <div
      className={cn(
        "flex",
        isModified && side === "left" &&
          "bg-red-500/10 text-red-700 dark:text-red-400",
        isModified && side === "right" &&
          "bg-green-500/10 text-green-700 dark:text-green-400",
      )}
    >
      <span className="inline-block w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">
        {(side === "left" ? line.oldLineNo : line.newLineNo) ?? ""}
      </span>
      <span
        className="whitespace-pre-wrap break-all flex-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

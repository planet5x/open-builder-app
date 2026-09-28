import { forwardRef } from "react";
import { useT } from "../../../i18n";

export const SLASH_COMMANDS = [
  "new",
  "fork",
  "clear",
  "reset",
  "compact",
  "health",
  "review",
  "continue",
  "retry",
] as const;

export type SlashCommand = (typeof SLASH_COMMANDS)[number];

interface SlashCommandMenuProps {
  commands: readonly SlashCommand[];
  selectedIdx: number;
  onSelect: (cmd: SlashCommand) => void;
  onHoverIdx: (idx: number) => void;
}

export const SlashCommandMenu = forwardRef<
  HTMLDivElement,
  SlashCommandMenuProps
>(function SlashCommandMenu(
  { commands, selectedIdx, onSelect, onHoverIdx },
  ref,
) {
  const t = useT();
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t.chat.slashCommands}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border rounded-lg shadow-md overflow-y-auto z-10 max-h-[min(200px,32dvh)]"
    >
      {commands.map((cmd, i) => (
        <button
          key={cmd}
          type="button"
          role="menuitem"
          aria-current={i === selectedIdx ? "true" : undefined}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${i === selectedIdx ? "bg-accent" : "hover:bg-accent/50"}`}
          onMouseEnter={() => onHoverIdx(i)}
          onClick={() => onSelect(cmd)}
        >
          <span className="font-mono text-xs text-muted-foreground">
            {t.slash[cmd].name}
          </span>
          <span className="text-muted-foreground">{t.slash[cmd].desc}</span>
        </button>
      ))}
    </div>
  );
});

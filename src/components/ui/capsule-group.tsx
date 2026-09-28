import { cn } from "@/lib/utils";

export interface CapsuleGroupOption {
  value: string;
  label: string;
}

interface CapsuleGroupProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: CapsuleGroupOption[];
  disabled?: boolean;
}

export function CapsuleGroup({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: CapsuleGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 w-full items-center rounded-lg bg-muted p-0.75"
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isSelected
                ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

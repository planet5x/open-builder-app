import { forwardRef } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InlineInputProps {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onConfirm: () => void;
  onCancel: () => void;
  placeholder?: string;
  paddingLeft: number;
  paddingRight: number;
  stopPropagation?: boolean;
}

export const InlineInput = forwardRef<HTMLInputElement, InlineInputProps>(
  function InlineInput(
    {
      icon,
      value,
      onChange,
      onKeyDown,
      onConfirm,
      onCancel,
      placeholder,
      paddingLeft,
      paddingRight,
      stopPropagation,
    },
    ref,
  ) {
    return (
      <div
        className="flex items-center gap-1 py-0.5"
        style={{
          paddingLeft: `${paddingLeft}px`,
          paddingRight: `${paddingRight}px`,
        }}
      >
        {icon}
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onCancel}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          placeholder={placeholder}
          aria-label={placeholder ?? "Name"}
          className="flex-1 min-w-0 h-6 px-1.5 text-sm bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-900/30"
          aria-label="Confirm"
          onMouseDown={(e) => {
            e.preventDefault();
            if (stopPropagation) e.stopPropagation();
            onConfirm();
          }}
        >
          <Check size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
          onMouseDown={(e) => {
            e.preventDefault();
            if (stopPropagation) e.stopPropagation();
            onCancel();
          }}
        >
          <X size={12} />
        </Button>
      </div>
    );
  },
);

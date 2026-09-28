import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SessionGroupProps {
  label: string;
  count: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
}

export function SessionGroup({
  label,
  count,
  open,
  onOpenChange,
  children,
}: SessionGroupProps) {
  if (count === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <ChevronRight
            size={12}
            className={cn("transition-transform", open && "rotate-90")}
          />
          <span className="font-medium">{label}</span>
          <span className="ml-auto text-muted-foreground/60">{count}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

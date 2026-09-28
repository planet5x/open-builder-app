import { Button } from "@/components/ui/button";
import { useT } from "../../i18n";

interface EmptyStateProps {
  onSelectSuggestion: (text: string) => void;
}

export function EmptyState({ onSelectSuggestion }: EmptyStateProps) {
  const t = useT();
  const suggestions = [
    { icon: "📝", text: t.empty.suggestions.todo },
    { icon: "☁️", text: t.empty.suggestions.weather },
    { icon: "💡", text: t.empty.suggestions.calculator },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
      <div
        role="group"
        aria-label={t.empty.suggestionsLabel}
        className="space-y-2 w-full max-w-xs"
      >
        {suggestions.map(({ icon, text }) => (
          <Button
            key={text}
            variant="outline"
            className="w-full justify-start h-auto py-2.5 text-left"
            onClick={() => onSelectSuggestion(text)}
          >
            <span className="text-base mr-2">{icon}</span>
            <span className="text-sm">{text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "../../i18n";

interface SettingsWarningProps {
  onOpenSettings: () => void;
}

export function SettingsWarning({ onOpenSettings }: SettingsWarningProps) {
  const t = useT();

  return (
    <Card className="p-4 bg-yellow-50 border-yellow-200">
      <div className="flex items-start gap-3">
        <Settings size={20} className="text-yellow-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="font-medium text-yellow-900 text-sm mb-1">{t.warning.title}</h3>
          <p className="text-xs text-yellow-800 mb-3">{t.warning.desc}</p>
          <Button onClick={onOpenSettings} size="sm">
            {t.warning.openSettings}
          </Button>
        </div>
      </div>
    </Card>
  );
}

import { Braces, ScanSearch } from "lucide-react";
import type { SystemSettings } from "../../../store/settings";
import { CapsuleGroup } from "@/components/ui/capsule-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../../i18n";

interface AdvancedTabProps {
  form: SystemSettings;
  setForm: (value: SystemSettings) => void;
  customSystemPromptError?: string;
}

const CUSTOM_SYSTEM_PROMPT_ID = "custom-system-prompt";

export function AdvancedTab({
  form,
  setForm,
  customSystemPromptError,
}: AdvancedTabProps) {
  const t = useT();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={CUSTOM_SYSTEM_PROMPT_ID}>
          <Braces size={16} className="inline mr-1" />
          {t.settings.customSystemPrompt.label}
        </Label>
        <Textarea
          id={CUSTOM_SYSTEM_PROMPT_ID}
          value={form.customSystemPrompt}
          rows={3}
          className="field-sizing-fixed min-h-0 resize-none font-mono text-xs leading-relaxed focus-visible:border-input"
          placeholder={t.settings.customSystemPrompt.placeholder}
          aria-invalid={customSystemPromptError ? "true" : undefined}
          aria-describedby={
            customSystemPromptError
              ? `${CUSTOM_SYSTEM_PROMPT_ID}-error`
              : undefined
          }
          onChange={(event) =>
            setForm({ ...form, customSystemPrompt: event.target.value })
          }
        />
        {customSystemPromptError && (
          <p
            id={`${CUSTOM_SYSTEM_PROMPT_ID}-error`}
            className="text-xs text-destructive"
            role="alert"
          >
            {customSystemPromptError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          <ScanSearch size={16} className="inline mr-1" />
          {t.settings.autoQa.label}
        </Label>
        <CapsuleGroup
          label={t.settings.autoQa.label}
          value={form.autoQaEnabled ? "on" : "off"}
          onChange={(value) =>
            setForm({ ...form, autoQaEnabled: value === "on" })
          }
          options={[
            { value: "on", label: t.settings.autoQa.on },
            { value: "off", label: t.settings.autoQa.off },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t.settings.autoQa.hint}
        </p>
      </div>
    </>
  );
}

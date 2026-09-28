import { useState } from "react";
import { ClipboardList, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LazyMarkdownContent } from "./LazyMarkdownContent";
import { useT } from "../../i18n";
import { useInteractiveStore } from "../../store/interactive";
import {
  PLAN_APPROVED_PREFIX,
  PLAN_REJECTED_PREFIX,
} from "../../lib/ai/plan-mode";

interface PlanApprovalCardProps {
  toolCallId: string;
  /** Plan markdown captured from the resolved tool call's rawArgs. May be empty
   *  while pending (the AI SDK has not yet written the args back into the message);
   *  in that case we fall back to the pending entry's `plan`. */
  plan: string;
  /** Tool result string from the AI loop. Empty while pending; contains
   *  "Plan approved…" / "Plan rejected…" once the user has decided. */
  result: string;
}

type Mode = "buttons" | "feedback";

export function PlanApprovalCard({
  toolCallId,
  plan,
  result,
}: PlanApprovalCardProps) {
  const t = useT();
  const pending = useInteractiveStore((s) =>
    s.pending.find((p) => p.toolCallId === toolCallId && p.kind === "plan"),
  );
  const [mode, setMode] = useState<Mode>("buttons");
  const [feedback, setFeedback] = useState("");

  const planText = pending && pending.kind === "plan" ? pending.plan : plan;
  const isApproved = !pending && result.startsWith(PLAN_APPROVED_PREFIX);
  const isRejected = !pending && result.startsWith(PLAN_REJECTED_PREFIX);

  const handleApprove = () => {
    useInteractiveStore.getState().resolvePlan(toolCallId, { approved: true });
  };

  const handleReject = () => {
    if (mode === "buttons") {
      setMode("feedback");
      return;
    }
    useInteractiveStore.getState().resolvePlan(toolCallId, {
      approved: false,
      feedback: feedback.trim() || undefined,
    });
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <ClipboardList className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t.chat.planApproval.title}</span>
        {isApproved && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="w-3.5 h-3.5" />
            {t.chat.planApproval.approved}
          </span>
        )}
        {isRejected && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <X className="w-3.5 h-3.5" />
            {t.chat.planApproval.rejected}
          </span>
        )}
      </div>
      <div className="px-3 py-2 text-sm max-h-96 overflow-y-auto">
        <LazyMarkdownContent content={planText} variant="assistant" />
      </div>
      {pending && (
        <div className="px-3 py-2 border-t border-border bg-muted/20 space-y-2">
          {mode === "feedback" && (
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t.chat.planApproval.feedbackPlaceholder}
              rows={2}
              className="text-sm resize-none"
              autoFocus
            />
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleReject}
            >
              {mode === "feedback"
                ? t.chat.planApproval.sendFeedback
                : t.chat.planApproval.reject}
            </Button>
            {mode === "buttons" && (
              <Button type="button" size="sm" onClick={handleApprove}>
                <Check className="w-3.5 h-3.5 mr-1" />
                {t.chat.planApproval.approve}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

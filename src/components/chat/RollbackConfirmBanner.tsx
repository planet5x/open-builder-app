import { Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "../../i18n";

interface RollbackHintProps {
  label: string;
  onDismiss: () => void;
}

export function RollbackHint({ label, onDismiss }: RollbackHintProps) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
      <Undo2 className="w-3.5 h-3.5 shrink-0" />
      <span>
        {t.rollback.rolledBackTo}
        <span className="font-medium">{label || t.rollback.initialState}</span>
      </span>
      <button
        onClick={onDismiss}
        className="ml-auto text-amber-600/60 hover:text-amber-700 dark:hover:text-amber-300 transition-colors cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}

interface RollbackConfirmDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function RollbackConfirmDialog({
  onCancel,
  onConfirm,
}: RollbackConfirmDialogProps) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.rollback.confirm}</DialogTitle>
          <DialogDescription>{t.rollback.confirmDesc}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t.rollback.cancel}
          </Button>
          <Button onClick={onConfirm}>{t.rollback.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

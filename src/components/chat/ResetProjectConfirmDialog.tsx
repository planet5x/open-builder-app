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

interface ResetProjectConfirmDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function ResetProjectConfirmDialog({
  onCancel,
  onConfirm,
}: ResetProjectConfirmDialogProps) {
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
          <DialogTitle>{t.resetProject.title}</DialogTitle>
          <DialogDescription>{t.resetProject.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t.resetProject.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t.resetProject.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { createPortal } from "react-dom";
import { SessionList } from "./SessionList";

interface SessionListOverlayProps {
  closeLabel: string;
  onClose: () => void;
}

export function SessionListOverlay({
  closeLabel,
  onClose,
}: SessionListOverlayProps) {
  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="session-list-overlay">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 cursor-default backdrop-blur-sm bg-black/20 animate-in fade-in duration-200"
        onClick={onClose}
      />
      <aside className="relative z-10 h-full w-full max-w-80 border-r bg-background shadow-lg animate-in slide-in-from-left duration-200">
        <SessionList onClose={onClose} />
      </aside>
    </div>,
    document.body,
  );
}

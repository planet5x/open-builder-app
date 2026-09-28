import {
  Eye,
  Code2,
  Monitor,
  Tablet,
  Smartphone,
  Download,
  Minus,
  Plus,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useT } from "../../i18n";
import type { ProjectFiles } from "@/types";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ViewMode = "preview" | "code";
export type DeviceSize = "desktop" | "tablet" | "mobile";

interface ViewToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  deviceSize: DeviceSize;
  onDeviceSizeChange: (size: DeviceSize) => void;
  files: ProjectFiles;
  previewEnabled?: boolean;
  previewScale?: number;
  onPreviewZoomIn?: () => void;
  onPreviewZoomOut?: () => void;
  onPreviewFit?: () => void;
}

async function downloadAsZip(files: ProjectFiles) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "project.zip");
}

function ToolbarIconButton({
  label,
  selected = false,
  variant = "ghost",
  onClick,
  className,
  children,
}: {
  label: string;
  selected?: boolean;
  variant?: "ghost" | "outline";
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={selected ? "secondary" : variant}
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          className={className}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ViewToolbar({
  viewMode,
  onViewModeChange,
  deviceSize,
  onDeviceSizeChange,
  files,
  previewEnabled = true,
  previewScale = 1,
  onPreviewZoomIn,
  onPreviewZoomOut,
  onPreviewFit,
}: ViewToolbarProps) {
  const t = useT();
  return (
    <div className="h-14 border-b bg-background px-4 flex items-center justify-between shrink-0 z-10">
      <div className="flex items-center gap-1 p-0.5 rounded-lg border">
        {previewEnabled && (
          <Button
            variant={viewMode === "preview" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onViewModeChange("preview")}
            className="gap-2"
          >
            <Eye size={16} />
            {t.toolbar.preview}
          </Button>
        )}
        <Button
          variant={viewMode === "code" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewModeChange("code")}
          className="gap-2"
        >
          <Code2 size={16} />
          {t.toolbar.code}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {previewEnabled && viewMode === "preview" && (
          <div className="flex items-center gap-1">
            {deviceSize !== "desktop" && (
              <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
                <ToolbarIconButton
                  onClick={() => onPreviewZoomOut?.()}
                  label={t.toolbar.zoomOut}
                >
                  <Minus size={14} />
                </ToolbarIconButton>
                <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">
                  {Math.round(previewScale * 100)}%
                </span>
                <ToolbarIconButton
                  onClick={() => onPreviewZoomIn?.()}
                  label={t.toolbar.zoomIn}
                >
                  <Plus size={14} />
                </ToolbarIconButton>
                <ToolbarIconButton
                  onClick={() => onPreviewFit?.()}
                  label={t.toolbar.fitPreview}
                >
                  <Scan size={14} />
                </ToolbarIconButton>
              </div>
            )}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border">
              <ToolbarIconButton
                selected={deviceSize === "desktop"}
                onClick={() => onDeviceSizeChange("desktop")}
                label={t.toolbar.desktop}
                className="desktop"
              >
                <Monitor size={16} />
              </ToolbarIconButton>
              <ToolbarIconButton
                selected={deviceSize === "tablet"}
                onClick={() => onDeviceSizeChange("tablet")}
                label={t.toolbar.tablet}
                className="tablet"
              >
                <Tablet size={16} />
              </ToolbarIconButton>
              <ToolbarIconButton
                selected={deviceSize === "mobile"}
                onClick={() => onDeviceSizeChange("mobile")}
                label={t.toolbar.mobile}
                className="mobile"
              >
                <Smartphone size={16} />
              </ToolbarIconButton>
            </div>
          </div>
        )}

        {viewMode === "code" && (
          <ToolbarIconButton
            onClick={() => downloadAsZip(files)}
            label={t.toolbar.download}
            variant="outline"
          >
            <Download size={16} />
          </ToolbarIconButton>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackConsole,
} from "@codesandbox/sandpack-react";
import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useT } from "../i18n";
import { SandpackListener } from "./code-viewer/SandpackListener";
import { ViewToolbar } from "./code-viewer/ViewToolbar";
import { FileExplorer } from "./code-viewer/FileExplorer";
import type { ViewMode, DeviceSize } from "./code-viewer/ViewToolbar";
import type { ProjectFiles, ProjectPreviewMode } from "../types";
import {
  hasSensitiveProjectFileContent,
  projectFilesForPreview,
} from "../lib/utils/project-file-policy";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

interface CodeViewerProps {
  conversationId: string;
  files: ProjectFiles;
  currentFile: string;
  onFileSelect: (path: string) => void;
  onFileChange: (conversationId: string, path: string, content: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFile: (path: string) => void;
  onMoveFile: (sourcePath: string, targetFolder: string) => void;
  template: string;
  previewMode?: ProjectPreviewMode;
  sandpackKey: number;
}

export function CodeViewer({
  conversationId,
  files,
  currentFile,
  onFileSelect,
  onFileChange,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
  template,
  previewMode = "sandpack",
  sandpackKey,
}: CodeViewerProps) {
  const t = useT();
  const previewEnabled = previewMode !== "code-only";
  const [viewMode, setViewMode] = useState<ViewMode>(
    previewEnabled ? "preview" : "code",
  );
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");
  const [showConsole, setShowConsole] = useState(false);
  const [requestedScale, setRequestedScale] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const isDark = useTheme();
  const effectiveViewMode = previewEnabled ? viewMode : "code";

  const deviceDimensions =
    deviceSize === "tablet"
      ? { width: 768, height: 1024 }
      : { width: 375, height: 667 };
  const previewScale =
    deviceSize === "desktop" ? 1 : (requestedScale ?? fitScale);

  useEffect(() => {
    if (!previewEnabled) setViewMode("code");
  }, [previewEnabled]);

  useEffect(() => {
    if (deviceSize === "desktop") return;
    const host = previewHostRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setFitScale(
        Math.min(
          1,
          Math.max(
            0.25,
            Math.min(
              (rect.width - 32) / deviceDimensions.width,
              (rect.height - 32) / deviceDimensions.height,
            ),
          ),
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [deviceDimensions.height, deviceDimensions.width, deviceSize, viewMode]);

  const handleDeviceSizeChange = (next: DeviceSize) => {
    setDeviceSize(next);
    setRequestedScale(null);
  };

  const previewFiles = useMemo(
    () =>
      projectFilesForPreview(
        files,
        previewMode === "code-only" ? { includeServerFiles: true } : undefined,
      ),
    [files, previewMode],
  );
  const handleSandpackFileChange = useCallback(
    (targetConversationId: string, path: string, content: string) => {
      const canonical = files[path];
      if (
        canonical !== undefined &&
        hasSensitiveProjectFileContent(canonical)
      ) {
        return;
      }
      onFileChange(targetConversationId, path, content);
    },
    [files, onFileChange],
  );
  const sandpackFiles = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(previewFiles).map(([path, content]) => [
          path.startsWith("/") ? path : `/${path}`,
          { code: content },
        ]),
      ),
    [previewFiles],
  );

  const requestedCurrentFile = currentFile.replace(/^\/+/, "");
  const effectiveCurrentFile =
    requestedCurrentFile in previewFiles
      ? requestedCurrentFile
      : (Object.keys(previewFiles)[0] ?? requestedCurrentFile);
  const sandpackCurrentFile = `/${effectiveCurrentFile}`;

  const handleCreateFile = (path: string) => {
    const p = path.startsWith("/") ? path.slice(1) : path;
    if (!(p in files)) {
      onFileChange(conversationId, p, "// New file\n");
      onFileSelect(p);
    }
  };

  const handleCreateFolder = (path: string) => {
    const p = path.startsWith("/") ? path.slice(1) : path;
    // Use trailing "/" to represent empty folder, no .gitkeep needed
    if (!(`${p}/` in files)) onFileChange(conversationId, `${p}/`, "");
  };

  return (
    <div className="editor w-full h-full flex flex-col bg-background">
      <ViewToolbar
        viewMode={effectiveViewMode}
        onViewModeChange={setViewMode}
        deviceSize={deviceSize}
        onDeviceSizeChange={handleDeviceSizeChange}
        files={files}
        previewEnabled={previewEnabled}
        previewScale={previewScale}
        onPreviewZoomIn={() =>
          setRequestedScale(Math.min(1.5, previewScale + 0.1))
        }
        onPreviewZoomOut={() =>
          setRequestedScale(Math.max(0.25, previewScale - 0.1))
        }
        onPreviewFit={() => setRequestedScale(null)}
      />

      <div className="flex-1 overflow-hidden relative bg-muted/50">
        <SandpackProvider
          key={sandpackKey}
          template={
            (previewEnabled ? template : "static") as SandpackPredefinedTemplate
          }
          theme={isDark ? "dark" : "light"}
          files={sandpackFiles}
          options={{ activeFile: sandpackCurrentFile }}
          style={{ height: "100%" }}
        >
          <SandpackListener
            conversationId={conversationId}
            onFileChange={handleSandpackFileChange}
          />
          <SandpackLayout>
            {/* Preview */}
            {previewEnabled && (
              <div
                ref={previewHostRef}
                className={cn(
                  "h-full w-full",
                  effectiveViewMode === "preview" ? "block" : "hidden",
                  deviceSize === "desktop"
                    ? "overflow-hidden"
                    : "overflow-auto p-4",
                )}
              >
                <div
                  className={cn(
                    "mx-auto",
                    deviceSize !== "desktop" && "relative",
                  )}
                  style={
                    deviceSize === "desktop"
                      ? { width: "100%", height: "100%" }
                      : {
                          width: deviceDimensions.width * previewScale,
                          height: deviceDimensions.height * previewScale,
                        }
                  }
                >
                  <div
                    className={cn(
                      "grid grid-rows-3 h-full",
                      deviceSize !== "desktop" &&
                        "absolute left-0 top-0 overflow-hidden rounded-lg border bg-background shadow-lg",
                    )}
                    style={
                      deviceSize === "desktop"
                        ? undefined
                        : {
                            width: deviceDimensions.width,
                            height: deviceDimensions.height,
                            transform: `scale(${previewScale})`,
                            transformOrigin: "top left",
                          }
                    }
                  >
                    <div
                      className={cn(
                        "transition-[width,height,transform,opacity] duration-300 ease-in-out",
                        showConsole ? "row-span-2" : "row-span-3",
                      )}
                    >
                      <SandpackPreview
                        showNavigator
                        showOpenInCodeSandbox={false}
                        showRefreshButton
                        actionsChildren={
                          <TooltipIconButton
                            label={
                              showConsole ? t.console.hide : t.console.show
                            }
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setShowConsole(!showConsole)}
                          >
                            <Terminal size={16} />
                          </TooltipIconButton>
                        }
                      />
                    </div>
                    <div
                      className={cn(
                        "overflow-hidden border-t",
                        showConsole ? "row-span-1" : "max-h-0 border-t-0",
                      )}
                    >
                      <SandpackConsole showSyntaxError={true} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Code editor */}
            <div
              className={cn(
                "h-full w-full overflow-hidden",
                effectiveViewMode === "code" ? "flex" : "hidden",
              )}
            >
              <div className="w-56 border-r h-full shrink-0 overflow-hidden flex flex-col">
                <FileExplorer
                  files={previewFiles}
                  currentFile={currentFile}
                  onFileSelect={onFileSelect}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRenameFile={onRenameFile}
                  onDeleteFile={onDeleteFile}
                  onMoveFile={onMoveFile}
                />
              </div>
              <div className="flex flex-col flex-1 h-full overflow-x-auto min-w-0">
                <SandpackCodeEditor
                  showTabs={false}
                  showLineNumbers
                  showInlineErrors
                  wrapContent={false}
                  closableTabs={false}
                />
              </div>
            </div>
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  );
}

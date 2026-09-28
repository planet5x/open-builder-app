import { useEffect, useRef } from "react";
import { useSandpack, useSandpackConsole } from "@codesandbox/sandpack-react";
import { useSandpackStore, type ConsoleLogData } from "@/store/sandpack";
import { createSandpackFileChangeScheduler } from "./sandpack-file-changes";

interface SandpackListenerProps {
  conversationId: string;
  onFileChange: (conversationId: string, path: string, content: string) => void;
}

export function SandpackListener({
  conversationId,
  onFileChange,
}: SandpackListenerProps) {
  const { sandpack } = useSandpack();
  const { files, activeFile } = sandpack;
  const code = files[activeFile]?.code;
  const { logs } = useSandpackConsole({
    resetOnPreviewRestart: true,
    showSyntaxError: true,
  });
  const setConsoleLogs = useSandpackStore((s) => s.setConsoleLogs);
  const schedulerRef = useRef<
    ReturnType<typeof createSandpackFileChangeScheduler> | undefined
  >(undefined);
  schedulerRef.current ??= createSandpackFileChangeScheduler();

  useEffect(() => {
    if (!activeFile || code === undefined) {
      schedulerRef.current?.flush();
      return;
    }
    const normalizedPath = activeFile.startsWith("/")
      ? activeFile.slice(1)
      : activeFile;
    schedulerRef.current?.schedule({
      conversationId,
      path: normalizedPath,
      content: code,
      commit: onFileChange,
    });
  }, [code, activeFile, conversationId, onFileChange]);

  useEffect(
    () => () => {
      schedulerRef.current?.dispose();
      schedulerRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    setConsoleLogs(logs as ConsoleLogData[]);
  }, [logs, setConsoleLogs]);

  return null;
}

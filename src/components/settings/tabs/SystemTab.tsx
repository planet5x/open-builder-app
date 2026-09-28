import { useEffect, useState } from "react";
import {
  Info,
  Languages,
  Shield,
  Sun,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { SystemSettings, Language, Theme } from "../../../store/settings";
import {
  clearProxyLog,
  getProxyLog,
  isTauri,
  type ProxyLogEntry,
} from "../../../lib/infra/proxy";
import { getMcpPlatformCapabilities } from "../../../lib/mcp/tauri-host";
import { Button } from "@/components/ui/button";
import { CapsuleGroup } from "@/components/ui/capsule-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { version } from "../../../../package.json";
import { useT } from "../../../i18n";

interface SystemTabProps {
  form: SystemSettings;
  setForm: (v: SystemSettings) => void;
}

export function SystemTab({ form, setForm }: SystemTabProps) {
  const t = useT();
  const [showConfirm, setShowConfirm] = useState(false);
  const [proxyLog, setProxyLog] = useState<ProxyLogEntry[]>(() =>
    getProxyLog(),
  );
  const [supportsSkillScripts, setSupportsSkillScripts] = useState(false);
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    let active = true;
    void getMcpPlatformCapabilities().then((capabilities) => {
      if (active) setSupportsSkillScripts(capabilities.skillScripts);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleReset = async () => {
    setResetError("");
    try {
      const { clearAllStorageDomains } =
        await import("../../../lib/storage/registry");
      await clearAllStorageDomains();
      window.location.reload();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <div className="space-y-2">
        <Label>
          <Languages size={16} className="inline mr-1" />
          {t.settings.language.label}
        </Label>
        <CapsuleGroup
          label={t.settings.language.label}
          value={form.language}
          onChange={(v) => setForm({ ...form, language: v as Language })}
          options={[
            { value: "system", label: t.settings.language.system },
            { value: "zh", label: t.settings.language.zh },
            { value: "en", label: t.settings.language.en },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t.settings.language.hint}
        </p>
      </div>

      <div className="space-y-2">
        <Label>
          <Sun size={16} className="inline mr-1" />
          {t.settings.theme.label}
        </Label>
        <CapsuleGroup
          label={t.settings.theme.label}
          value={form.theme}
          onChange={(v) => setForm({ ...form, theme: v as Theme })}
          options={[
            { value: "system", label: t.settings.theme.system },
            { value: "light", label: t.settings.theme.light },
            { value: "dark", label: t.settings.theme.dark },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t.settings.theme.hint}</p>
      </div>

      {supportsSkillScripts && (
        <div className="space-y-2">
          <Label>
            <TerminalSquare size={16} className="inline mr-1" />
            {t.settings.skillScripts.label}
          </Label>
          <CapsuleGroup
            label={t.settings.skillScripts.label}
            value={form.developerSkillScriptsEnabled ? "on" : "off"}
            onChange={(value) =>
              setForm({
                ...form,
                developerSkillScriptsEnabled: value === "on",
              })
            }
            options={[
              { value: "on", label: t.settings.skillScripts.on },
              { value: "off", label: t.settings.skillScripts.off },
            ]}
          />
          <p className="text-xs text-destructive">
            {t.settings.skillScripts.hint}
          </p>
        </div>
      )}

      {isTauri() && (
        <div className="space-y-2">
          <Label>
            <Shield size={16} className="inline mr-1" />
            {t.settings.reverseProxy.label}
          </Label>
          <CapsuleGroup
            label={t.settings.reverseProxy.label}
            value={form.reverseProxy ? "on" : "off"}
            onChange={(v) => {
              const enabled = v === "on";
              setForm({ ...form, reverseProxy: enabled });
            }}
            options={[
              { value: "on", label: t.settings.reverseProxy.on },
              { value: "off", label: t.settings.reverseProxy.off },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {t.settings.reverseProxy.hint}
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">
              {t.settings.reverseProxy.allowedHosts}
            </Label>
            <Input
              value={form.reverseProxyAllowedHosts}
              onChange={(e) => {
                const value = e.target.value;
                setForm({ ...form, reverseProxyAllowedHosts: value });
              }}
              placeholder="https://api.openai.com, http://localhost:11434"
              className="h-8 text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {t.settings.reverseProxy.allowedHostsHint}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {t.settings.reverseProxy.recentRequests}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setProxyLog(getProxyLog())}
                >
                  {t.settings.reverseProxy.refreshLog}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    clearProxyLog();
                    setProxyLog([]);
                  }}
                >
                  {t.settings.reverseProxy.clearLog}
                </Button>
              </div>
            </div>
            {proxyLog.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t.settings.reverseProxy.emptyLog}
              </p>
            ) : (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {proxyLog
                  .slice(-5)
                  .reverse()
                  .map((entry) => (
                    <div
                      key={`${entry.timestamp}-${entry.kind}-${entry.host}-${entry.path}`}
                      className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]"
                    >
                      <span className="font-mono text-muted-foreground">
                        {entry.method}
                      </span>
                      <span
                        className="truncate"
                        title={`${entry.host}${entry.path}`}
                      >
                        {entry.host}
                        {entry.path}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {entry.kind}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>
          <Trash2 size={16} className="inline mr-1" />
          {t.settings.reset.label}
        </Label>
        {!showConfirm ? (
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setShowConfirm(true)}
          >
            {t.settings.reset.button}
          </Button>
        ) : (
          <>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowConfirm(false)}
              >
                {t.settings.reset.cancel}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleReset}
              >
                {t.settings.reset.confirm}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.settings.reset.warning}
            </p>
            {resetError && (
              <p role="alert" className="text-xs text-destructive">
                {t.settings.reset.failed}: {resetError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          <Info size={16} className="inline mr-1" />
          {t.settings.version.label}
        </Label>
        <p className="text-md text-foreground text-center">
          v{version}
          <a
            href="https://github.com/Amery2010/open-builder/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-xs text-primary hover:underline"
          >
            {t.settings.version.checkUpdate}
          </a>
        </p>
      </div>
    </>
  );
}

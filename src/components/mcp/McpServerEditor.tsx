import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../../i18n";
import type {
  McpAuthorizationCodeOAuthConfig,
  McpClientCredentialsOAuthConfig,
  McpOAuthConfig,
  McpServerDraft,
  McpServerEntry,
  McpTransportType,
} from "../../lib/mcp/types";

interface McpServerEditorProps {
  initial?: McpServerEntry;
  desktop: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSave: (draft: McpServerDraft) => Promise<void> | void;
}

type RemoteAuthMode =
  "none" | "headers" | "authorization-code" | "client-credentials";

function recordToJson(value: Record<string, string> | undefined): string {
  return value && Object.keys(value).length > 0
    ? JSON.stringify(value, null, 2)
    : "";
}

function parseStringRecord(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    Object.values(parsed).some((item) => typeof item !== "string")
  ) {
    throw new Error("invalid-record");
  }
  return parsed as Record<string, string>;
}

function oauthMode(
  oauth: McpOAuthConfig | undefined,
  hasHeaders: boolean,
): RemoteAuthMode {
  if (oauth?.type === "authorization-code") return "authorization-code";
  if (oauth?.type === "client-credentials") return "client-credentials";
  return hasHeaders ? "headers" : "none";
}

export function McpServerEditor({
  initial,
  desktop,
  busy = false,
  onCancel,
  onSave,
}: McpServerEditorProps) {
  const t = useT();
  const initialRemoteTransport =
    initial?.transport === "sse" ? "sse" : "streamable-http";
  const [kind, setKind] = useState<"remote" | "stdio">(
    initial?.transport === "stdio" && desktop ? "stdio" : "remote",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [remoteTransport, setRemoteTransport] = useState<
    Exclude<McpTransportType, "stdio">
  >(initialRemoteTransport);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState(recordToJson(initial?.headers));
  const [authMode, setAuthMode] = useState<RemoteAuthMode>(() =>
    oauthMode(initial?.oauth, Boolean(initial?.headers)),
  );
  const [issuer, setIssuer] = useState(initial?.oauth?.issuer ?? "");
  const [clientMetadataUrl, setClientMetadataUrl] = useState(
    initial?.oauth?.type === "authorization-code"
      ? (initial.oauth.clientMetadataUrl ?? "")
      : "",
  );
  const [clientRegistration, setClientRegistration] = useState<
    McpAuthorizationCodeOAuthConfig["clientRegistration"]
  >(
    initial?.oauth?.type === "authorization-code"
      ? initial.oauth.clientRegistration
      : "cimd",
  );
  const [clientId, setClientId] = useState(initial?.oauth?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(
    initial?.oauth?.clientSecret ?? "",
  );
  const [scopes, setScopes] = useState(initial?.oauth?.scopes.join(" ") ?? "");
  const [resource, setResource] = useState(initial?.oauth?.resource ?? "");
  const [redirectUri, setRedirectUri] = useState(
    initial?.oauth?.type === "authorization-code"
      ? (initial.oauth.redirectUri ?? "")
      : "",
  );
  const [tokenEndpoint, setTokenEndpoint] = useState(
    initial?.oauth?.type === "client-credentials"
      ? (initial.oauth.tokenEndpoint ?? "")
      : "",
  );
  const [command, setCommand] = useState(initial?.command ?? "");
  const [args, setArgs] = useState(initial?.args?.join("\n") ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? "");
  const [env, setEnv] = useState(recordToJson(initial?.env));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop && kind === "stdio") setKind("remote");
  }, [desktop, kind]);

  const title = initial
    ? t.mcp.editor.editTitle.replace("{name}", initial.name)
    : t.mcp.editor.addTitle;
  const showClientCredentials = authMode === "client-credentials";
  const showAuthorizationCode = authMode === "authorization-code";
  const showOAuth = showClientCredentials || showAuthorizationCode;
  const showManualClient =
    showClientCredentials ||
    (showAuthorizationCode && clientRegistration === "manual");
  const selectedTransport: McpTransportType =
    kind === "stdio" ? "stdio" : remoteTransport;
  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (kind === "stdio") return desktop && Boolean(command.trim());
    if (!url.trim()) return false;
    if (showClientCredentials) {
      return Boolean(
        clientId.trim() &&
        clientSecret.trim() &&
        (issuer.trim() || tokenEndpoint.trim()),
      );
    }
    if (showAuthorizationCode && clientRegistration === "cimd") {
      return Boolean(clientMetadataUrl.trim());
    }
    if (showAuthorizationCode && clientRegistration === "manual") {
      return Boolean(clientId.trim());
    }
    return true;
  }, [
    clientId,
    clientMetadataUrl,
    clientRegistration,
    clientSecret,
    command,
    desktop,
    kind,
    name,
    showAuthorizationCode,
    showClientCredentials,
    url,
  ]);

  const parseRecordField = (
    value: string,
    label: string,
  ): Record<string, string> | undefined => {
    try {
      return parseStringRecord(value);
    } catch {
      throw new Error(t.mcp.editor.invalidJson.replace("{field}", label));
    }
  };

  const buildOAuth = (): McpOAuthConfig | undefined => {
    if (!showOAuth) return undefined;
    const normalizedScopes = scopes.split(/\s+/).filter(Boolean);
    if (showClientCredentials) {
      const config: McpClientCredentialsOAuthConfig = {
        type: "client-credentials",
        clientId: clientId.trim(),
        clientSecret,
        scopes: normalizedScopes,
      };
      if (issuer.trim()) config.issuer = issuer.trim();
      if (tokenEndpoint.trim()) config.tokenEndpoint = tokenEndpoint.trim();
      if (resource.trim()) config.resource = resource.trim();
      return config;
    }

    const config: McpAuthorizationCodeOAuthConfig = {
      type: "authorization-code",
      clientRegistration,
      scopes: normalizedScopes,
    };
    if (issuer.trim()) config.issuer = issuer.trim();
    if (clientRegistration === "cimd" && clientMetadataUrl.trim()) {
      config.clientMetadataUrl = clientMetadataUrl.trim();
    }
    if (clientId.trim()) config.clientId = clientId.trim();
    if (clientSecret) config.clientSecret = clientSecret;
    if (redirectUri.trim()) config.redirectUri = redirectUri.trim();
    if (resource.trim()) config.resource = resource.trim();
    return config;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setError(null);
    try {
      if (kind === "stdio") {
        await onSave({
          name: name.trim(),
          enabled: initial?.enabled ?? false,
          transport: "stdio",
          command: command.trim(),
          args: args
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          env: parseRecordField(env, t.mcp.editor.env),
          cwd: cwd.trim() || undefined,
          requestTimeoutMs: initial?.requestTimeoutMs,
        });
        return;
      }

      await onSave({
        name: name.trim(),
        enabled: initial?.enabled ?? false,
        transport: selectedTransport,
        url: url.trim(),
        headers:
          authMode !== "none"
            ? parseRecordField(headers, t.mcp.editor.headers)
            : undefined,
        oauth: buildOAuth(),
        requestTimeoutMs: initial?.requestTimeoutMs,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.mcp.editor.description}
        </p>
      </div>

      <Tabs
        value={kind}
        onValueChange={(value) => setKind(value as "remote" | "stdio")}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="remote" disabled={busy}>
            {t.mcp.editor.remote}
          </TabsTrigger>
          {desktop && (
            <TabsTrigger value="stdio" disabled={busy}>
              {t.mcp.editor.stdio}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <div className="space-y-1.5">
        <Label htmlFor="mcp-server-name">{t.mcp.editor.name}</Label>
        <Input
          id="mcp-server-name"
          value={name}
          disabled={busy}
          maxLength={80}
          autoComplete="off"
          placeholder={t.mcp.editor.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {kind === "remote" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-url">{t.mcp.editor.url}</Label>
              <Input
                id="mcp-server-url"
                type="url"
                inputMode="url"
                value={url}
                disabled={busy}
                autoComplete="url"
                placeholder={t.mcp.editor.urlPlaceholder}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-transport">{t.mcp.transport.label}</Label>
              <Select
                value={remoteTransport}
                onValueChange={(value) =>
                  setRemoteTransport(
                    value as Exclude<McpTransportType, "stdio">,
                  )
                }
                disabled={busy}
              >
                <SelectTrigger id="mcp-transport" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">
                    {t.mcp.transport.streamableHttp}
                  </SelectItem>
                  <SelectItem value="sse">{t.mcp.transport.sse}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {remoteTransport === "sse" && (
            <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <p>{t.mcp.transport.sseWarning}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mcp-auth-mode">{t.mcp.auth.label}</Label>
            <Select
              value={authMode}
              onValueChange={(value) => setAuthMode(value as RemoteAuthMode)}
              disabled={busy}
            >
              <SelectTrigger id="mcp-auth-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.mcp.auth.none}</SelectItem>
                <SelectItem value="headers">{t.mcp.auth.headers}</SelectItem>
                <SelectItem value="authorization-code">
                  {t.mcp.auth.oauthAuthorizationCode}
                </SelectItem>
                <SelectItem value="client-credentials">
                  {t.mcp.auth.oauthClientCredentials}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authMode !== "none" && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-headers">{t.mcp.editor.headers}</Label>
              <Textarea
                id="mcp-headers"
                value={headers}
                rows={4}
                disabled={busy}
                spellCheck={false}
                className="resize-y font-mono text-xs"
                placeholder={t.mcp.editor.headersPlaceholder}
                onChange={(event) => setHeaders(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t.mcp.editor.headersHint}
              </p>
            </div>
          )}

          {showOAuth && (
            <div className="space-y-3 rounded-md border border-border/60 bg-background/60 p-3">
              {showAuthorizationCode && (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-client-registration">
                    {t.mcp.auth.clientRegistration}
                  </Label>
                  <Select
                    value={clientRegistration}
                    onValueChange={(value) =>
                      setClientRegistration(
                        value as McpAuthorizationCodeOAuthConfig["clientRegistration"],
                      )
                    }
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="mcp-client-registration"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cimd">{t.mcp.auth.cimd}</SelectItem>
                      <SelectItem value="dcr">{t.mcp.auth.dcr}</SelectItem>
                      <SelectItem value="manual">
                        {t.mcp.auth.manual}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {showAuthorizationCode && clientRegistration === "cimd" && (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-client-metadata-url">
                    {t.mcp.auth.clientMetadataUrl}
                  </Label>
                  <Input
                    id="mcp-client-metadata-url"
                    type="url"
                    value={clientMetadataUrl}
                    disabled={busy}
                    placeholder={t.mcp.auth.clientMetadataUrlPlaceholder}
                    onChange={(event) =>
                      setClientMetadataUrl(event.target.value)
                    }
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="mcp-oauth-issuer">{t.mcp.auth.issuer}</Label>
                <Input
                  id="mcp-oauth-issuer"
                  type="url"
                  value={issuer}
                  disabled={busy}
                  placeholder={t.mcp.auth.issuerPlaceholder}
                  onChange={(event) => setIssuer(event.target.value)}
                />
              </div>
              {showClientCredentials && (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-token-endpoint">
                    {t.mcp.auth.tokenEndpoint}
                  </Label>
                  <Input
                    id="mcp-token-endpoint"
                    type="url"
                    value={tokenEndpoint}
                    disabled={busy}
                    placeholder="https://auth.example.com/oauth/token"
                    onChange={(event) => setTokenEndpoint(event.target.value)}
                  />
                </div>
              )}
              {showManualClient && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-client-id">{t.mcp.auth.clientId}</Label>
                    <Input
                      id="mcp-client-id"
                      value={clientId}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(event) => setClientId(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-client-secret">
                      {t.mcp.auth.clientSecret}
                    </Label>
                    <Input
                      id="mcp-client-secret"
                      type="password"
                      value={clientSecret}
                      disabled={busy}
                      autoComplete="new-password"
                      onChange={(event) => setClientSecret(event.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-oauth-scopes">{t.mcp.auth.scopes}</Label>
                  <Input
                    id="mcp-oauth-scopes"
                    value={scopes}
                    disabled={busy}
                    placeholder={t.mcp.auth.scopesPlaceholder}
                    onChange={(event) => setScopes(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-oauth-resource">
                    {t.mcp.auth.resource}
                  </Label>
                  <Input
                    id="mcp-oauth-resource"
                    type="url"
                    value={resource}
                    disabled={busy}
                    placeholder={url || t.mcp.editor.urlPlaceholder}
                    onChange={(event) => setResource(event.target.value)}
                  />
                </div>
              </div>
              {showAuthorizationCode && (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-redirect-uri">
                    {t.mcp.auth.redirectUri}
                  </Label>
                  <Input
                    id="mcp-redirect-uri"
                    type="url"
                    value={redirectUri}
                    disabled={busy}
                    placeholder={t.mcp.auth.redirectUriPlaceholder}
                    onChange={(event) => setRedirectUri(event.target.value)}
                  />
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t.mcp.auth.redirectHint}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-command">{t.mcp.editor.command}</Label>
              <Input
                id="mcp-command"
                value={command}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder={t.mcp.editor.commandPlaceholder}
                onChange={(event) => setCommand(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-cwd">{t.mcp.editor.cwd}</Label>
              <Input
                id="mcp-cwd"
                value={cwd}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder={t.mcp.editor.cwdPlaceholder}
                onChange={(event) => setCwd(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-args">{t.mcp.editor.args}</Label>
              <Textarea
                id="mcp-args"
                value={args}
                rows={5}
                disabled={busy}
                spellCheck={false}
                className="resize-y font-mono text-xs"
                placeholder={t.mcp.editor.argsPlaceholder}
                onChange={(event) => setArgs(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-env">{t.mcp.editor.env}</Label>
              <Textarea
                id="mcp-env"
                value={env}
                rows={5}
                disabled={busy}
                spellCheck={false}
                className="resize-y font-mono text-xs"
                placeholder={t.mcp.editor.envPlaceholder}
                onChange={(event) => setEnv(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t.mcp.editor.stdioHint}
          </p>
        </div>
      )}

      <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
        <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-medium">{t.mcp.plaintextWarningTitle}</p>
          <p className="leading-relaxed">{t.mcp.plaintextWarning}</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="whitespace-pre-wrap">{error}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          {t.mcp.cancel}
        </Button>
        <Button type="submit" disabled={busy || !canSubmit}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? t.mcp.saving : t.mcp.save}
        </Button>
      </div>
    </form>
  );
}

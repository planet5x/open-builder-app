import { REDACTED_VALUE, redactSensitiveText } from "../utils/message-security";
import { isSensitiveProjectPath } from "../utils/project-file-policy";

const SECRET_EXPORT_KEYS = new Set([
  "apikey",
  "tavilykey",
  "firecrawlkey",
  "pixabaykey",
  "unsplashkey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "codeverifier",
  "headers",
  "env",
  "pendingauthorization",
  "registeredclient",
  "discoverystate",
]);

export function redactStorageExport(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactStorageExport);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_EXPORT_KEYS.has(key.toLowerCase()) || isSensitiveProjectPath(key)
        ? REDACTED_VALUE
        : redactStorageExport(item),
    ]),
  );
}

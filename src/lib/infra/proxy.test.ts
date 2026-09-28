import { describe, expect, it } from "vitest";
import {
  isProxyUrlAllowed,
  normalizeProxyHostRule,
  parseProxyAllowedHosts,
  redactProxyTargetForLog,
  toProxyUrl,
} from "./proxy";

describe("proxy allowlist helpers", () => {
  it("parses comma and newline separated hosts", () => {
    expect(
      parseProxyAllowedHosts("api.openai.com, *.anthropic.com\nLOCALHOST"),
    ).toEqual([
      "https://api.openai.com",
      "https://*.anthropic.com",
      "http://localhost",
    ]);
  });

  it("normalizes pasted URLs, ports and invalid entries", () => {
    expect(normalizeProxyHostRule("https://api.openai.com/v1")).toBe(
      "https://api.openai.com",
    );
    expect(normalizeProxyHostRule("localhost:11434")).toBe(
      "http://localhost:11434",
    );
    expect(normalizeProxyHostRule("[::1]")).toBe("http://[::1]");
    expect(normalizeProxyHostRule("*.example.com")).toBe(
      "https://*.example.com",
    );
    expect(normalizeProxyHostRule("*.bad_host")).toBeNull();
    expect(normalizeProxyHostRule("https://")).toBeNull();

    expect(
      parseProxyAllowedHosts(
        "https://api.openai.com/v1, api.openai.com, *.bad_host",
      ),
    ).toEqual(["https://api.openai.com"]);
  });

  it("caps allowlist rule count", () => {
    const rules = Array.from({ length: 80 }, (_, i) => `h${i}.example.com`);
    expect(parseProxyAllowedHosts(rules.join(","))).toHaveLength(64);
  });

  it("fails closed when no proxy host has been explicitly configured", () => {
    expect(isProxyUrlAllowed("http://localhost", [])).toBe(false);
    expect(isProxyUrlAllowed("http://127.0.0.1", [])).toBe(false);
    expect(isProxyUrlAllowed("http://[::1]", [])).toBe(false);
    expect(isProxyUrlAllowed("https://api.example.com", [])).toBe(false);
  });

  it("matches exact hosts and wildcard subdomains", () => {
    expect(
      isProxyUrlAllowed("https://api.openai.com", [
        "https://api.openai.com",
        "https://*.example.com",
      ]),
    ).toBe(true);
    expect(
      isProxyUrlAllowed("https://cdn.example.com", ["https://*.example.com"]),
    ).toBe(true);
    expect(
      isProxyUrlAllowed("https://example.com", ["https://*.example.com"]),
    ).toBe(false);
    expect(
      isProxyUrlAllowed("https://api.other.com", ["https://*.example.com"]),
    ).toBe(false);
  });

  it("matches exact scheme and effective port", () => {
    const approved = ["http://localhost:11434", "https://api.example.com"];
    expect(isProxyUrlAllowed("http://localhost:11434/v1", approved)).toBe(true);
    expect(isProxyUrlAllowed("http://localhost:3000/v1", approved)).toBe(false);
    expect(isProxyUrlAllowed("https://localhost:11434/v1", approved)).toBe(
      false,
    );
    expect(isProxyUrlAllowed("https://api.example.com:443/v1", approved)).toBe(
      true,
    );
    expect(isProxyUrlAllowed("https://api.example.com:8443/v1", approved)).toBe(
      false,
    );
  });

  it("redacts query and path secrets from diagnostics", () => {
    const sentinel = "do-not-log-this-secret";
    const target = redactProxyTargetForLog(
      `https://api.example.com/private/${sentinel}?token=${sentinel}`,
    );
    expect(target).toBe("https://api.example.com/…");
    expect(target).not.toContain(sentinel);
  });

  it("preserves HTTP, HTTPS, numeric hosts, ports, paths, and query strings", () => {
    expect(toProxyUrl("https://203.0.113.10:8443/v1?q=1")).toBe(
      "proxy-https://203.0.113.10:8443/v1?q=1",
    );
    expect(toProxyUrl("http://localhost:11434/v1")).toBe(
      "proxy-http://localhost:11434/v1",
    );
  });
});

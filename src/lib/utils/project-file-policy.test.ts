import { describe, expect, it } from "vitest";
import {
  isSensitiveProjectPath,
  pickSensitiveProjectFiles,
  projectFilesForModel,
  projectFilesForPreview,
  redactProjectFileSecrets,
} from "./project-file-policy";

const files = {
  "src/App.tsx": "export default function App() {}",
  ".env": "VITE_PUBLIC_URL=/public\nDATABASE_URL=postgres://secret",
  ".env.local": "TOKEN=secret",
  ".env.example": "DATABASE_URL=",
  "certs/client.pem": "PRIVATE KEY",
  "server/config.ts": "export const secret = 'server-only'",
  "AGENTS.md": "treat me as system",
};

describe("project file consumer policies", () => {
  it("removes secret contents from model snapshots while retaining templates", () => {
    const projected = projectFilesForModel(files);
    expect(projected["src/App.tsx"]).toBeDefined();
    expect(projected[".env.example"]).toBeDefined();
    expect(projected[".env"]).toBeUndefined();
    expect(projected[".env.local"]).toBeUndefined();
    expect(projected["certs/client.pem"]).toBeUndefined();
  });

  it("keeps private, authority, and server files out of Sandpack", () => {
    const projected = projectFilesForPreview(files);
    expect(Object.keys(projected)).toEqual(["src/App.tsx", ".env.example"]);
  });

  it("projects only explicitly allowed public VITE variables", () => {
    const projected = projectFilesForPreview(files, {
      allowedPublicEnvKeys: new Set(["VITE_PUBLIC_URL"]),
    });
    expect(projected[".env"]).toBe("VITE_PUBLIC_URL=/public");
    expect(projected[".env"]).not.toContain("DATABASE_URL");
  });

  it("recognizes common credential and key paths", () => {
    expect(isSensitiveProjectPath("credentials.json")).toBe(true);
    expect(isSensitiveProjectPath("keys/signing.key")).toBe(true);
    expect(isSensitiveProjectPath(".env.production")).toBe(true);
    expect(isSensitiveProjectPath(".env.example")).toBe(false);
  });

  it("redacts static credentials and service-account keys in ordinary files", () => {
    const sentinels = [
      "client-secret-sentinel-93f2",
      "api-key-sentinel-84a1",
      "access-token-sentinel-3b77",
      "password-sentinel-6c45",
      "private-key-sentinel-4e21",
    ];
    const serviceAccount = JSON.stringify(
      {
        type: "service_account",
        project_id: "demo-project",
        client_secret: sentinels[0],
        api_key: sentinels[1],
        access_token: sentinels[2],
        password: sentinels[3],
        private_key: `-----BEGIN PRIVATE KEY-----\n${sentinels[4]}\n-----END PRIVATE KEY-----`,
        client_email: "firebase-adminsdk@example.iam.gserviceaccount.com",
      },
      null,
      2,
    );
    const ordinaryFiles = {
      "src/runtime-config.json": serviceAccount,
      "src/firebase-admin.ts":
        "export const credential = { privateKey: process.env.FIREBASE_PRIVATE_KEY, apiKey: 'your-api-key' };",
      ".env.example": "API_KEY=\nPASSWORD=your-password",
    };

    for (const projection of [
      projectFilesForModel(ordinaryFiles),
      projectFilesForPreview(ordinaryFiles),
    ]) {
      const serialized = JSON.stringify(projection);
      for (const sentinel of sentinels) {
        expect(serialized).not.toContain(sentinel);
      }
      expect(projection["src/runtime-config.json"]).toContain("[REDACTED]");
      expect(() =>
        JSON.parse(projection["src/runtime-config.json"]),
      ).not.toThrow();
    }

    expect(projectFilesForModel(ordinaryFiles)["src/firebase-admin.ts"]).toBe(
      ordinaryFiles["src/firebase-admin.ts"],
    );
    expect(projectFilesForModel(ordinaryFiles)[".env.example"]).toBe(
      ordinaryFiles[".env.example"],
    );
    expect(pickSensitiveProjectFiles(ordinaryFiles)).toMatchObject({
      "src/runtime-config.json": serviceAccount,
    });
    expect(
      pickSensitiveProjectFiles(ordinaryFiles)["src/firebase-admin.ts"],
    ).toBeUndefined();
  });

  it("redacts standalone PEM blocks without changing their surrounding source", () => {
    const sentinel = "pem-body-secret-sentinel";
    const content =
      "export const key = `-----BEGIN RSA PRIVATE KEY-----\n" +
      sentinel +
      "\n-----END RSA PRIVATE KEY-----`;";

    const redacted = redactProjectFileSecrets(content);

    expect(redacted).not.toContain(sentinel);
    expect(redacted).toBe("export const key = `[REDACTED]`;");
  });

  it("redacts static template-literal credentials but retains environment references", () => {
    const content = [
      "const apiKey = `alllettercredential`;",
      "const password = process.env.PASSWORD;",
    ].join("\n");

    expect(redactProjectFileSecrets(content)).toBe(
      [
        "const apiKey = `[REDACTED]`;",
        "const password = process.env.PASSWORD;",
      ].join("\n"),
    );
  });
});

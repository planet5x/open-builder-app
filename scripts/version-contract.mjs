import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const write = process.argv.includes("--write");
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
const expected = packageJson.version;

if (
  typeof expected !== "string" ||
  !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(expected)
) {
  throw new Error("package.json must contain a valid semantic version.");
}

function updateCargoToml(text, version) {
  const nextSection = text.indexOf("\n[", "[package]\n".length);
  const end = nextSection === -1 ? text.length : nextSection;
  const packageSection = text.slice(0, end);
  if (!/^version = "[^"]+"$/m.test(packageSection)) {
    throw new Error("Cargo.toml [package] version was not found.");
  }
  return (
    packageSection.replace(/^version = "[^"]+"$/m, `version = "${version}"`) +
    text.slice(end)
  );
}

function updateCargoLock(text, version) {
  const pattern =
    /(\[\[package\]\]\nname = "open-builder"\nversion = ")[^"]+("\n)/;
  if (!pattern.test(text)) {
    throw new Error("Cargo.lock open-builder package version was not found.");
  }
  return text.replace(pattern, `$1${version}$2`);
}

const files = {
  cargo: new URL("src-tauri/Cargo.toml", root),
  lock: new URL("src-tauri/Cargo.lock", root),
  tauri: new URL("src-tauri/tauri.conf.json", root),
  app: new URL("src/lib/app-version.ts", root),
};

const cargo = readFileSync(files.cargo, "utf8");
const lock = readFileSync(files.lock, "utf8");
const tauriText = readFileSync(files.tauri, "utf8");
const tauri = JSON.parse(tauriText);
const app = readFileSync(files.app, "utf8");

const current = {
  "src-tauri/Cargo.toml": cargo.match(/^version = "([^"]+)"$/m)?.[1],
  "src-tauri/Cargo.lock": lock.match(
    /\[\[package\]\]\nname = "open-builder"\nversion = "([^"]+)"/,
  )?.[1],
  "src-tauri/tauri.conf.json": tauri.version,
  "src/lib/app-version.ts": app.match(/APP_VERSION = "([^"]+)"/)?.[1],
};

if (write) {
  writeFileSync(files.cargo, updateCargoToml(cargo, expected));
  writeFileSync(files.lock, updateCargoLock(lock, expected));
  tauri.version = expected;
  writeFileSync(files.tauri, `${JSON.stringify(tauri, null, 2)}\n`);
  writeFileSync(
    files.app,
    `/** Generated from package.json by \`pnpm version:sync\`. */\nexport const APP_VERSION = "${expected}";\n`,
  );
  console.log(`Synchronized Open Builder version ${expected}.`);
} else {
  const mismatches = Object.entries(current).filter(
    ([, value]) => value !== expected,
  );
  if (mismatches.length > 0) {
    for (const [path, value] of mismatches) {
      console.error(
        `${path}: expected ${expected}, found ${value ?? "missing"}`,
      );
    }
    console.error("Run `pnpm version:sync` to update version contracts.");
    process.exit(1);
  }
  console.log(`Version contracts match package.json (${expected}).`);
}

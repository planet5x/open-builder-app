import { readdirSync, readFileSync, statSync } from "node:fs";
import { JSDOM } from "jsdom";

const dist = new URL("../dist/", import.meta.url);
const assets = new URL("assets/", dist);
const html = readFileSync(new URL("index.html", dist), "utf8");
const failures = [];

const AUDIT_BASELINE_ENTRY_BYTES = 351_800;
const MINIMUM_ENTRY_REDUCTION = 0.2;
const MAX_ENTRY_BYTES = 271_000;
const MAX_JAVASCRIPT_CHUNK_BYTES = 275_000;
const MAX_CSS_BYTES = 87_000;

const entryMatch =
  /<script[^>]+type="module"[^>]+src="([^"]*assets\/index-[^"]+\.js)"/.exec(
    html,
  );
if (!entryMatch) {
  failures.push(
    "Unable to identify the production entry script in dist/index.html.",
  );
}

let entryName = entryMatch?.[1].split("/").pop();
const files = readdirSync(assets);
let entryBytes = entryName
  ? statSync(new URL(entryName, assets)).size
  : Number.POSITIVE_INFINITY;

// `strictExecutionOrder` can emit a tiny facade that initializes the actual
// application entry. Keep the budget tied to the implementation chunk.
if (entryName && entryBytes < 1024) {
  const entrySource = readFileSync(new URL(entryName, assets), "utf8");
  const localImports = [
    ...entrySource.matchAll(/from["']\.\/([^"']+\.js)["']/g),
  ].map((match) => match[1]);
  if (localImports.length === 1 && files.includes(localImports[0])) {
    entryName = localImports[0];
    entryBytes = statSync(new URL(entryName, assets)).size;
  }
}
const reduction = 1 - entryBytes / AUDIT_BASELINE_ENTRY_BYTES;

if (entryBytes > MAX_ENTRY_BYTES) {
  failures.push(
    `Entry JS is ${entryBytes} bytes; budget is ${MAX_ENTRY_BYTES}.`,
  );
}
if (reduction < MINIMUM_ENTRY_REDUCTION) {
  failures.push(
    `Entry JS reduction is ${(reduction * 100).toFixed(1)}%; minimum is ${MINIMUM_ENTRY_REDUCTION * 100}%.`,
  );
}

for (const file of files.filter((name) => name.endsWith(".js"))) {
  const bytes = statSync(new URL(file, assets)).size;
  if (bytes > MAX_JAVASCRIPT_CHUNK_BYTES) {
    failures.push(
      `${file} is ${bytes} bytes; chunk budget is ${MAX_JAVASCRIPT_CHUNK_BYTES}.`,
    );
  }
}

for (const file of files.filter((name) => name.endsWith(".css"))) {
  const bytes = statSync(new URL(file, assets)).size;
  if (bytes > MAX_CSS_BYTES) {
    failures.push(`${file} is ${bytes} bytes; CSS budget is ${MAX_CSS_BYTES}.`);
  }
}

const preloadHrefs = [
  ...html.matchAll(/rel="modulepreload"[^>]+href="([^"]+)"/g),
].map((match) => match[1]);
const forbiddenInitialChunks = [
  "vendor-editor-",
  "vendor-sandpack-",
  "vendor-ai-",
  "CodeViewer-",
  "SettingsDialog-",
  "McpPanel-",
  "SkillsPanel-",
  "MarkdownContent-",
];
for (const href of preloadHrefs) {
  if (
    forbiddenInitialChunks.some((prefix) => href.includes(`/assets/${prefix}`))
  ) {
    failures.push(`Heavy lazy chunk is preloaded on first paint: ${href}`);
  }
}

for (const prefix of [
  "CodeViewer-",
  "SettingsDialog-",
  "McpPanel-",
  "SkillsPanel-",
  "MarkdownContent-",
]) {
  if (!files.some((file) => file.startsWith(prefix) && file.endsWith(".js"))) {
    failures.push(`Expected a lazy ${prefix} chunk in the production build.`);
  }
}

const markdownChunk = files.find(
  (file) => file.startsWith("MarkdownContent-") && file.endsWith(".js"),
);
if (markdownChunk) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    { url: "http://localhost" },
  );
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  for (const key of [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "CustomEvent",
    "Event",
    "URL",
    "Blob",
    "FileReader",
    "DOMParser",
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
    });
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

  try {
    // Catch circular-chunk failures that only appear in the production graph.
    await import(new URL(markdownChunk, assets));
  } catch (error) {
    failures.push(
      `Production Markdown chunk failed to initialize: ${error instanceof Error ? error.message : String(error)}.`,
    );
  } finally {
    dom.window.close();
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`build-budget: ${failure}`);
  process.exit(1);
}

console.log(
  `Build budgets passed: entry ${entryBytes} bytes (${(reduction * 100).toFixed(1)}% below audit baseline).`,
);

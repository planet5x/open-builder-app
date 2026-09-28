import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";

let registered = false;
function ensureRegistered() {
  if (registered) return;
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("markdown", markdown);
  registered = true;
}

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  htm: "xml",
  svg: "xml",
  xml: "xml",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  md: "markdown",
  markdown: "markdown",
};

/** Map a file path to a highlight.js language id, or `null` to skip. */
export function languageFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

/** Highlight a single line, returning raw HTML. Falls back to plain text on
 *  any error so the diff stays readable even if highlight.js trips. */
export function highlightLine(line: string, lang: string | null): string {
  if (!lang || !line) return escapeHtml(line);
  ensureRegistered();
  try {
    return sanitizeHighlightedHtml(
      hljs.highlight(line, { language: lang, ignoreIllegals: true }).value,
    );
  } catch {
    return escapeHtml(line);
  }
}

export function sanitizeHighlightedHtml(html: string): string {
  return html.replace(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g, (tag, rawName, rawAttrs) => {
    const name = String(rawName).toLowerCase();
    if (tag.startsWith("</")) return name === "span" ? "</span>" : "";
    if (name !== "span") return "";
    const classMatch = String(rawAttrs).match(/\sclass=(?:"([^"]*)"|'([^']*)')/);
    const className = classMatch?.[1] ?? classMatch?.[2] ?? "";
    if (!/^(?:hljs-[\w-]+)(?:\s+hljs-[\w-]+)*$/.test(className)) {
      return "<span>";
    }
    return `<span class="${className}">`;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

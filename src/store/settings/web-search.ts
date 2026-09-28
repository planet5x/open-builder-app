import type { StateCreator } from "zustand";

export interface WebSearchSettings {
  engine: "tavily" | "firecrawl" | "exa" | "builtin" | "disabled";
  tavilyApiKey: string;
  firecrawlApiKey: string;
  exaApiKey: string;
}

export const webSearchDefaults: WebSearchSettings = {
  engine: "firecrawl",
  tavilyApiKey: "",
  firecrawlApiKey: "",
  exaApiKey: "",
};

export interface WebSearchSlice {
  webSearch: WebSearchSettings;
  setWebSearch: (settings: WebSearchSettings) => void;
  isWebSearchConfigured: () => boolean;
}

export const createWebSearchSlice: StateCreator<
  WebSearchSlice,
  [],
  [],
  WebSearchSlice
> = (set, get) => ({
  webSearch: webSearchDefaults,
  setWebSearch: (settings) => set({ webSearch: settings }),
  isWebSearchConfigured: () => {
    const { webSearch } = get();
    if (webSearch.engine === "disabled") return false;
    if (webSearch.engine === "builtin") return true;
    if (webSearch.engine === "tavily") return !!webSearch.tavilyApiKey;
    if (webSearch.engine === "firecrawl") return true;
    if (webSearch.engine === "exa") return !!webSearch.exaApiKey;
    return false;
  },
});

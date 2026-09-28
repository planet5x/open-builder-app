import type { StateCreator } from "zustand";

export interface AssetSearchSettings {
  engine: "pixabay" | "unsplash" | "disabled";
  pixabayApiKey: string;
  unsplashApiKey: string;
}

export const assetSearchDefaults: AssetSearchSettings = {
  engine: "disabled",
  pixabayApiKey: "",
  unsplashApiKey: "",
};

export interface AssetSearchSlice {
  assetSearch: AssetSearchSettings;
  setAssetSearch: (settings: AssetSearchSettings) => void;
  isAssetSearchConfigured: () => boolean;
}

export const createAssetSearchSlice: StateCreator<
  AssetSearchSlice,
  [],
  [],
  AssetSearchSlice
> = (set, get) => ({
  assetSearch: assetSearchDefaults,
  setAssetSearch: (settings) => set({ assetSearch: settings }),
  isAssetSearchConfigured: () => {
    const { assetSearch } = get();
    if (assetSearch.engine === "disabled") return false;
    if (assetSearch.engine === "pixabay") return !!assetSearch.pixabayApiKey;
    if (assetSearch.engine === "unsplash") return !!assetSearch.unsplashApiKey;
    return false;
  },
});

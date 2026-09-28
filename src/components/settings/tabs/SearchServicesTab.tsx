import type {
  AssetSearchSettings,
  WebSearchSettings,
} from "../../../store/settings";
import { AssetSearchTab } from "./AssetSearchTab";
import { WebSearchTab } from "./WebSearchTab";

interface SearchServicesTabProps {
  webSearchForm: WebSearchSettings;
  setWebSearchForm: (value: WebSearchSettings) => void;
  assetSearchForm: AssetSearchSettings;
  setAssetSearchForm: (value: AssetSearchSettings) => void;
  apiType: string;
}

export function SearchServicesTab({
  webSearchForm,
  setWebSearchForm,
  assetSearchForm,
  setAssetSearchForm,
  apiType,
}: SearchServicesTabProps) {
  return (
    <>
      <section className="space-y-4" aria-labelledby="web-search-heading">
        <WebSearchTab
          form={webSearchForm}
          setForm={setWebSearchForm}
          apiType={apiType}
        />
      </section>

      <section
        className="space-y-4"
        aria-labelledby="asset-search-heading"
      >
        <AssetSearchTab form={assetSearchForm} setForm={setAssetSearchForm} />
      </section>
    </>
  );
}

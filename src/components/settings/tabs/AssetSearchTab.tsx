import { Key, Images } from "lucide-react";
import type { AssetSearchSettings } from "../../../store/settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "../../../i18n";

interface AssetSearchTabProps {
  form: AssetSearchSettings;
  setForm: (v: AssetSearchSettings) => void;
}

export function AssetSearchTab({ form, setForm }: AssetSearchTabProps) {
  const t = useT();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="assetEngine">
          <Images size={16} className="inline mr-1" />
          {t.settings.searchServices.asset}
        </Label>
        <Select
          value={form.engine}
          onValueChange={(v) => setForm({ ...form, engine: v as any })}
        >
          <SelectTrigger id="assetEngine" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled">
              {t.settings.assetSearch.disabled}
            </SelectItem>
            <SelectItem value="pixabay">Pixabay</SelectItem>
            <SelectItem value="unsplash">Unsplash</SelectItem>
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          {t.settings.assetSearch.desc}
        </p>
      </div>

      {form.engine === "pixabay" && (
        <div className="space-y-2">
          <Label htmlFor="pixabayApiKey">
            <Key size={16} className="inline mr-1" />
            Pixabay API Key
          </Label>
          <Input
            id="pixabayApiKey"
            type="password"
            value={form.pixabayApiKey}
            onChange={(e) =>
              setForm({ ...form, pixabayApiKey: e.target.value })
            }
            placeholder="..."
          />
          <p className="text-xs text-muted-foreground">
            {t.settings.pixabayKey.hint}
          </p>
        </div>
      )}

      {form.engine === "unsplash" && (
        <div className="space-y-2">
          <Label htmlFor="unsplashApiKey">
            <Key size={16} className="inline mr-1" />
            Unsplash API Key
          </Label>
          <Input
            id="unsplashApiKey"
            type="password"
            value={form.unsplashApiKey}
            onChange={(e) =>
              setForm({ ...form, unsplashApiKey: e.target.value })
            }
            placeholder="..."
          />
          <p className="text-xs text-muted-foreground">
            {t.settings.unsplashKey.hint}
          </p>
        </div>
      )}
    </>
  );
}

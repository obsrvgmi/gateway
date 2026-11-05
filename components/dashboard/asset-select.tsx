"use client";

import { Select, SelectItem } from "@/components/base/select/select";
import { TokenMark } from "@/components/brand/token-mark";
import { RECEIVE_ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";

export function AssetSelect({ label, value, onChange }: { label: string; value: AssetSymbol; onChange: (asset: AssetSymbol) => void }) {
  return (
    <Select label={label} selectedKey={value} onSelectionChange={(key) => onChange(key as AssetSymbol)} className="w-full" triggerClassName="w-full">
      {RECEIVE_ASSETS.map((asset) => (
        <SelectItem key={asset.symbol} id={asset.symbol} textValue={asset.symbol}>
          <span className="flex items-center gap-2">
            <TokenMark symbol={asset.symbol} size="sm" />
            {asset.symbol}
            <span className="text-text-secondary">on {asset.chain}</span>
          </span>
        </SelectItem>
      ))}
    </Select>
  );
}

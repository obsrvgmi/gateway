"use client";

import { useParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { RiCheckLine, RiComputerLine, RiDeleteBin6Line, RiImageAddLine, RiLayoutMasonryLine, RiMoonLine, RiSaveLine, RiSmartphoneLine, RiSunLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { ColorWell } from "@/components/base/color-picker/color-picker";
import { Label } from "@/components/base/input/label";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Textarea } from "@/components/base/textarea/textarea";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { PAY_ASSETS } from "@/lib/assets";
import { embedSnippet } from "@/lib/embed";
import { WIDGET_DEFAULTS } from "@/lib/defaults";
import { actions, newId, useGateway } from "@/lib/store";
import type { AssetSymbol, Widget, WidgetRadius, WidgetSuccessMode, WidgetTheme } from "@/lib/types";
import { useOrigin } from "@/lib/use-origin";
import { cx } from "@/utils/cx";
import { AssetSelect } from "../asset-select";
import { CopyButton, EmptyState, PageHeader, Panel, SimulatedTag } from "../ui";
import { useUnsavedGuard } from "../unsaved";

const SWATCHES = ["#00EC97", "#7c3aed", "#db2777", "#ea580c", "#2563eb", "#171717"];
/** Kept in localStorage with the rest of the demo, so it has to stay small. */
const LOGO_LIMIT = 80_000;

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <SegmentedControl aria-label={label} selectedKeys={[value]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) onChange(next as T); }} className="self-start">
        {options.map(([id, text]) => <SegmentedControlItem key={id} id={id}>{text}</SegmentedControlItem>)}
      </SegmentedControl>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-caption-1-regular text-text-secondary">{children}</p>;
}

type Draft = Omit<Widget, "id" | "status" | "createdAt">;

function draftOf(widget: Widget): Draft {
  const copy: Partial<Widget> = { ...widget };
  delete copy.id;
  delete copy.status;
  delete copy.createdAt;
  return copy as Draft;
}
const isHttps = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const parsePresets = (text: string) => [...new Set(text.split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0))].slice(0, 4);

function LogoField({ value, onChange }: { value: string; onChange: (logo: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > LOGO_LIMIT) {
      toast.error("That image is too large", { description: "Use a file under 80 KB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.onerror = () => toast.error("Couldn't read that file");
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex flex-col gap-2">
      <Label>Logo</Label>
      <div className="flex items-center gap-2">
        <span className="dash-well flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {/* A local data URL, so there is nothing for next/image to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="Current logo" className="size-full object-cover" /> : <RiImageAddLine className="size-5 text-foreground-icon-tertiary" aria-hidden />}
        </span>
        <input ref={input} type="file" hidden aria-label="Logo file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { pick(event.target.files); event.target.value = ""; }} />
        <Button variant="secondary" size="small" onClick={() => input.current?.click()}>{value ? "Replace" : "Upload"}</Button>
        {value && <Button variant="ghost" size="small" iconOnly leadingIcon={RiDeleteBin6Line} aria-label="Remove logo" onClick={() => onChange("")} />}
      </div>
      <Hint>PNG, JPG or WebP under 80 KB. Without one, customers see your initials.</Hint>
    </div>
  );
}

function AssetPicker({ value, onChange }: { value: AssetSymbol[]; onChange: (assets: AssetSymbol[]) => void }) {
  const toggle = (symbol: AssetSymbol) => {
    const next = value.includes(symbol) ? value.filter((item) => item !== symbol) : [...value, symbol];
    if (next.length) onChange(next);
    else toast.error("Keep at least one asset");
  };
  return (
    <div role="group" aria-label="Accepted assets" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Accepted assets</Label>
        <button type="button" onClick={() => onChange(PAY_ASSETS.map((asset) => asset.symbol))} className="cursor-pointer rounded text-caption-1-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring">Select all</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {PAY_ASSETS.map((asset) => {
          const on = value.includes(asset.symbol);
          return (
            <button
              key={asset.symbol}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(asset.symbol)}
              className={cx("flex cursor-pointer flex-col items-center gap-1 rounded-xl py-2 outline-none transition-[background-color,box-shadow,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring", on ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--viz-primary)]" : "opacity-60 shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:opacity-100")}
            >
              <TokenMark symbol={asset.symbol} size="sm" />
              <span className="text-caption-1-medium">{asset.symbol}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WidgetBuilder({ existing }: { existing?: Widget }) {
  const { settings } = useGateway();
  const origin = useOrigin();
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? draftOf(existing)
      : { ...WIDGET_DEFAULTS, name: "Website checkout", site: "", theme: "light", accent: settings.branding.accent, radius: "rounded", amount: null, receiveAsset: settings.receiveAsset, buttonLabel: "Pay now", showBranding: true },
  );
  const [fixedAmount, setFixedAmount] = useState(existing?.amount ?? 49);
  const [presetText, setPresetText] = useState((existing?.presets ?? []).join(", "));
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [savedDraft, setSavedDraft] = useState<string | null>(existing ? JSON.stringify(draftOf(existing)) : null);
  const [nameError, setNameError] = useState(false);
  const [urlError, setUrlError] = useState(false);
  const [ground, setGround] = useState<"light" | "dark">("light");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setSuccess = (patch: Partial<Draft["success"]>) => setDraft((current) => ({ ...current, success: { ...current.success, ...patch } }));
  const fixed = draft.amount !== null;
  const dirty = savedDraft !== JSON.stringify(draft);
  const [untouched] = useState(() => JSON.stringify(draft));
  const unsavedDialog = useUnsavedGuard(dirty && JSON.stringify(draft) !== (savedDraft ?? untouched));
  const merchant = draft.displayName.trim() || settings.businessName;
  const embedOptions = { ...draft, displayName: draft.displayName.trim() };

  const save = () => {
    const name = draft.name.trim();
    const badUrl = draft.success.mode === "redirect" && !isHttps(draft.success.url);
    setNameError(!name);
    setUrlError(badUrl);
    if (!name || badUrl) return;
    const clean = { ...draft, name, site: draft.site.trim(), displayName: draft.displayName.trim() };
    if (savedId) {
      actions.updateWidget(savedId, clean);
      toast.success("Changes saved");
    } else {
      const widget: Widget = { ...clean, id: newId("wgt_"), status: "live", createdAt: new Date().toISOString() };
      actions.addWidget(widget);
      setSavedId(widget.id);
      toast.success("Widget saved", { description: "Your embed code is ready to copy." });
    }
    setDraft(clean);
    setSavedDraft(JSON.stringify(clean));
  };

  return (
    <>
      <PageHeader
        title={existing ? `Edit ${existing.name}` : "Customize widget"}
        description="Everything you change shows in the preview and the embed code."
        actions={
          <>
            <NavButton href="/dashboard/widgets" variant="secondary">{dirty ? "Cancel" : "Back to widgets"}</NavButton>
            {dirty ? (
              <Button leadingIcon={RiSaveLine} onClick={save}>{savedId ? "Save changes" : "Save widget"}</Button>
            ) : (
              <Chip color="lime" variant="subtle" className="gap-1"><RiCheckLine className="size-4" aria-hidden />Saved</Chip>
            )}
          </>
        }
      />
      <div className="grid grid-cols-12 items-start gap-3 @3xl:gap-4">
        <div className="col-span-12 grid min-w-0 grid-cols-12 gap-3 @3xl:gap-4 @4xl:col-span-7">
          <Panel title="Identity" className="col-span-12">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
              <Input label="Widget name" hint="For you. Customers see it as the order title." value={draft.name} onChange={(value) => { set("name", value); setNameError(false); }} isRequired isInvalid={nameError} errorMessage="Give the widget a name." />
              <Input label="Site (optional)" inputDir="ltr" placeholder="shop.yoursite.com" value={draft.site} onChange={(value) => set("site", value)} />
              <Input label="Display name (optional)" placeholder={settings.businessName} hint="Replaces your business name at checkout." value={draft.displayName} onChange={(value) => set("displayName", value)} />
              <LogoField value={draft.logo} onChange={(logo) => set("logo", logo)} />
            </div>
          </Panel>

          <Panel title="Amount and assets" className="col-span-12">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Choice label="Amount" value={fixed ? "fixed" : "dynamic"} onChange={(mode) => set("amount", mode === "fixed" ? fixedAmount : null)} options={[["dynamic", "Customer sets"], ["fixed", "Fixed"]]} />
                {fixed ? (
                  <NumberField aria-label="Fixed amount in USD" value={draft.amount ?? fixedAmount} onChange={(value) => { setFixedAmount(value); set("amount", value); }} minValue={1} formatOptions={{ style: "currency", currency: "USD" }} />
                ) : (
                  <Input label="Suggested amounts" placeholder="10, 25, 50" hint="Up to four, in USD." value={presetText} onChange={(value) => { setPresetText(value); set("presets", parsePresets(value)); }} />
                )}
                <AssetSelect label="Receive as" value={draft.receiveAsset} onChange={(asset) => set("receiveAsset", asset)} />
              </div>
              <AssetPicker value={draft.acceptedAssets} onChange={(assets) => set("acceptedAssets", assets)} />
            </div>
          </Panel>

          <Panel title="Look" className="col-span-12">
            <div className="grid grid-cols-1 gap-5 @xl:grid-cols-2">
              <Choice label="Theme" value={draft.theme} onChange={(value: WidgetTheme) => set("theme", value)} options={[["light", "Light"], ["dark", "Dark"], ["auto", "Match page"]]} />
              <Choice label="Corners" value={draft.radius} onChange={(value: WidgetRadius) => set("radius", value)} options={[["rounded", "Rounded"], ["soft", "Soft"], ["sharp", "Sharp"]]} />
              <div className="flex flex-col gap-2">
                <Label>Accent color</Label>
                <div className="flex items-center gap-3">
                  <ColorWell aria-label="Accent color" value={draft.accent} onChange={(color) => set("accent", color.toString("hex"))} swatches={SWATCHES} />
                  <span dir="ltr" className="text-body-medium tabular-nums text-text-secondary">{draft.accent}</span>
                </div>
              </div>
              <Input label="Button label" value={draft.buttonLabel} onChange={(value) => set("buttonLabel", value)} />
              <SwitchCard title="Show branding" description="Adds a small non-custodial note under the checkout." isSelected={draft.showBranding} onChange={(value) => set("showBranding", value)} />
              <SwitchCard title="Ask for email" description="Adds a receipt email field. Nothing is sent in this demo." isSelected={draft.collectEmail} onChange={(value) => set("collectEmail", value)} />
            </div>
          </Panel>

          <Panel title="After payment" description="Pay in the preview to see this step." className="col-span-12">
            <Choice label="Customers see" value={draft.success.mode} onChange={(mode: WidgetSuccessMode) => { setSuccess({ mode }); setUrlError(false); }} options={[["receipt", "Receipt"], ["message", "Your message"], ["redirect", "Redirect"]]} />
            {draft.success.mode === "message" && <Textarea label="Message" placeholder="Thanks. Your order is on its way." value={draft.success.message} onChange={(value) => setSuccess({ message: value })} rows={2} />}
            {draft.success.mode === "redirect" && <Input label="Redirect URL" inputDir="ltr" type="url" placeholder="https://yoursite.com/thanks" value={draft.success.url} onChange={(value) => { setSuccess({ url: value }); setUrlError(false); }} isInvalid={urlError} errorMessage="Enter a full https:// URL." />}
          </Panel>

          <Panel title="Embed code" description={savedId ? "Paste this where the checkout should appear." : "Save the widget to get its embed code."} className="col-span-12">
            <Tabs>
              <TabList aria-label="Embed format">
                <Tab id="html">HTML</Tab>
                <Tab id="react">React</Tab>
              </TabList>
              {(["html", "react"] as const).map((kind) => {
                const code = embedSnippet(origin, savedId ?? "wgt_unsaved", kind, embedOptions);
                return (
                  <TabPanel key={kind} id={kind} className="flex flex-col gap-3 pt-3">
                    <pre dir="ltr" className="dash-well overflow-x-auto rounded-xl p-3 text-caption-1-regular"><code>{code}</code></pre>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={code} label="Embed code" disabled={!savedId || dirty}>Copy code</CopyButton>
                      {dirty && savedId && <Hint>Save first, so the code matches.</Hint>}
                    </div>
                  </TabPanel>
                );
              })}
            </Tabs>
          </Panel>
        </div>

        <div className="dash-plate col-span-12 flex min-w-0 flex-col gap-3 rounded-3xl p-3 @4xl:sticky @4xl:top-[4.5rem] @4xl:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl aria-label="Preview page colour" selectedKeys={[ground]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setGround(next as "light" | "dark"); }}>
              <SegmentedControlItem id="light" aria-label="On a light page"><RiSunLine className="size-4" aria-hidden /></SegmentedControlItem>
              <SegmentedControlItem id="dark" aria-label="On a dark page"><RiMoonLine className="size-4" aria-hidden /></SegmentedControlItem>
            </SegmentedControl>
            <SimulatedTag>Preview, illustrative prices</SimulatedTag>
            <SegmentedControl aria-label="Preview size" selectedKeys={[device]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setDevice(next as "desktop" | "phone"); }}>
              <SegmentedControlItem id="desktop" aria-label="Desktop width"><RiComputerLine className="size-4" aria-hidden /></SegmentedControlItem>
              <SegmentedControlItem id="phone" aria-label="Phone width"><RiSmartphoneLine className="size-4" aria-hidden /></SegmentedControlItem>
            </SegmentedControl>
          </div>
          {/* The ground is the merchant's page, not ours, so it ignores the dashboard's theme. */}
          <div className={cx("flex justify-center rounded-2xl p-4 text-text-primary transition-colors duration-200", ground === "dark" ? "dark bg-background-full" : "theme-scope-light bg-background-secondary-default")}>
            <CheckoutWidget
              merchant={merchant}
              title={draft.name || "Checkout"}
              amount={fixed ? draft.amount || 0 : null}
              receiveAsset={draft.receiveAsset}
              theme={draft.theme}
              accent={draft.accent}
              radius={draft.radius}
              buttonLabel={draft.buttonLabel || undefined}
              showBranding={draft.showBranding}
              acceptedAssets={draft.acceptedAssets}
              presets={draft.presets}
              logo={draft.logo}
              collectEmail={draft.collectEmail}
              success={draft.success}
              className={device === "phone" ? "max-w-[320px]" : undefined}
            />
          </div>
        </div>
      </div>
      {unsavedDialog}
    </>
  );
}

export function WidgetNewView() {
  return <WidgetBuilder />;
}

export function WidgetEditView() {
  const { id } = useParams<{ id: string }>();
  const { widgets } = useGateway();
  const widget = widgets.find((item) => item.id === id);
  if (!widget) {
    return (
      <>
        <PageHeader title="Edit widget" />
        <Panel><EmptyState icon={RiLayoutMasonryLine} title="This widget doesn't exist" description="It may have been deleted." action={<NavButton href="/dashboard/widgets">Back to widgets</NavButton>} /></Panel>
      </>
    );
  }
  return <WidgetBuilder key={widget.id} existing={widget} />;
}

"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { RiCheckLine, RiLayoutMasonryLine, RiSaveLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { ColorWell } from "@/components/base/color-picker/color-picker";
import { Label } from "@/components/base/input/label";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { toast } from "@/components/base/toast/toast";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { embedSnippet } from "@/lib/embed";
import { actions, newId, useGateway } from "@/lib/store";
import type { Widget, WidgetRadius, WidgetTheme } from "@/lib/types";
import { useOrigin } from "@/lib/use-origin";
import { AssetSelect } from "../asset-select";
import { CopyButton, EmptyState, PageHeader, Panel } from "../ui";

const SWATCHES = ["#00EC97", "#7c3aed", "#db2777", "#ea580c", "#2563eb", "#171717"];

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

type Draft = Pick<Widget, "name" | "site" | "theme" | "accent" | "radius" | "amount" | "receiveAsset" | "buttonLabel" | "showBranding">;

const draftOf = ({ name, site, theme, accent, radius, amount, receiveAsset, buttonLabel, showBranding }: Draft): Draft => ({ name, site, theme, accent, radius, amount, receiveAsset, buttonLabel, showBranding });

function WidgetBuilder({ existing }: { existing?: Widget }) {
  const { settings } = useGateway();
  const origin = useOrigin();
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? draftOf(existing)
      : { name: "Website checkout", site: "", theme: "light", accent: settings.branding.accent, radius: "rounded", amount: null, receiveAsset: settings.receiveAsset, buttonLabel: "Pay now", showBranding: true },
  );
  const [fixedAmount, setFixedAmount] = useState(existing?.amount ?? 49);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [savedDraft, setSavedDraft] = useState<string | null>(existing ? JSON.stringify(draftOf(existing)) : null);
  const [nameError, setNameError] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fixed = draft.amount !== null;
  const dirty = savedDraft !== JSON.stringify(draft);

  const save = () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    const clean = { ...draft, name, site: draft.site.trim() };
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
        description="Changes show in the preview as you make them."
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
          <Panel title="Identity" className="col-span-12 @xl:col-span-6">
            <Input label="Name" value={draft.name} onChange={(value) => { set("name", value); setNameError(false); }} isRequired isInvalid={nameError} errorMessage="Give the widget a name." />
            <Input label="Site (optional)" placeholder="shop.yoursite.com" value={draft.site} onChange={(value) => set("site", value)} />
            <Input label="Button label" value={draft.buttonLabel} onChange={(value) => set("buttonLabel", value)} />
          </Panel>
          <Panel title="Payment" className="col-span-12 @xl:col-span-6">
            <Choice label="Amount" value={fixed ? "fixed" : "dynamic"} onChange={(mode) => set("amount", mode === "fixed" ? fixedAmount : null)} options={[["dynamic", "Customer sets"], ["fixed", "Fixed"]]} />
            {fixed && <NumberField aria-label="Fixed amount in USD" value={draft.amount ?? fixedAmount} onChange={(value) => { setFixedAmount(value); set("amount", value); }} minValue={1} formatOptions={{ style: "currency", currency: "USD" }} />}
            <AssetSelect label="Receive as" value={draft.receiveAsset} onChange={(asset) => set("receiveAsset", asset)} />
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
              <SwitchCard title="Show branding" description="Adds a small non-custodial note under the checkout." isSelected={draft.showBranding} onChange={(value) => set("showBranding", value)} />
            </div>
          </Panel>
          <Panel title="Embed code" description={savedId ? "Paste this where the checkout should appear." : "Save the widget to get its embed code."} className="col-span-12">
            <Tabs>
              <TabList aria-label="Embed format">
                <Tab id="html">HTML</Tab>
                <Tab id="react">React</Tab>
              </TabList>
              {(["html", "react"] as const).map((kind) => {
                const code = embedSnippet(origin, savedId ?? "wgt_unsaved", kind);
                return (
                  <TabPanel key={kind} id={kind} className="flex flex-col gap-3 pt-3">
                    <pre dir="ltr" className="overflow-x-auto rounded-xl bg-background-secondary-default p-3 text-caption-1-regular"><code>{code}</code></pre>
                    <div><CopyButton text={code} label="Embed code" disabled={!savedId}>Copy code</CopyButton></div>
                  </TabPanel>
                );
              })}
            </Tabs>
          </Panel>
        </div>
        <div className="col-span-12 flex min-w-0 justify-center rounded-3xl border border-border-button-default bg-background-inner-default p-5 @4xl:sticky @4xl:top-6 @4xl:col-span-5">
          <CheckoutWidget
            merchant={settings.businessName}
            title={draft.name || "Checkout"}
            amount={fixed ? draft.amount || 0 : null}
            receiveAsset={draft.receiveAsset}
            theme={draft.theme}
            accent={draft.accent}
            radius={draft.radius}
            buttonLabel={draft.buttonLabel || undefined}
            showBranding={draft.showBranding}
          />
        </div>
      </div>
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

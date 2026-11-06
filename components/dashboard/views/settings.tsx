"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { RiAddLine, RiArrowRightLine, RiDeleteBin6Line, RiGroupLine, RiKey2Line, RiWebhookLine } from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { ColorWell } from "@/components/base/color-picker/color-picker";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Modal, ModalBody, ModalFooter, ModalHeader, AlertDialog } from "@/components/base/modal/modal";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { toast } from "@/components/base/toast/toast";
import { NavButton } from "@/components/nav-button";
import { formatDate, shortAddress } from "@/lib/format";
import { actions, getGateway, newId, useGateway } from "@/lib/store";
import type { ApiKey, AssetSymbol, NotificationPrefs, Settings, TeamRole, Webhook, WebhookEvent } from "@/lib/types";
import { AssetSelect } from "../asset-select";
import { Bento, CopyButton, EmptyState, MAIN_ULTRA, PageHeader, Panel, useMainAtLeast } from "../ui";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENTS: WebhookEvent[] = ["payment.processing", "payment.settled", "payment.refunded", "payment.expired", "link.created"];
const ROLES: [TeamRole, string][] = [["admin", "Admin"], ["finance", "Finance"], ["viewer", "Viewer"]];
const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", finance: "Finance", viewer: "Viewer" };
const ALERTS: [keyof NotificationPrefs, string, string][] = [
  ["settled", "Payment settled", "Each time funds reach your wallet"],
  ["processing", "Payment processing", "When a customer's funds are detected"],
  ["refunded", "Payment refunded", "When a payment is marked as refunded"],
  ["expired", "Quote expired", "When a customer doesn't finish paying"],
  ["links", "Link expiring", "A week before a link's end date"],
];

const TABS = [["business", "Business"], ["developers", "Developers"], ["team", "Team and alerts"], ["workspace", "Workspace"]];

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export function SettingsView() {
  const { settings, links, widgets, payments } = useGateway();
  const [clearing, setClearing] = useState(false);
  const hasData = links.length > 0 || widgets.length > 0 || payments.length > 0;
  // Keyed on the saved values, so restoring demo data can't leave a form showing the old ones.
  const payoutKey = `${settings.businessName}|${settings.receiveAsset}`;
  const brandKey = JSON.stringify(settings.branding);
  const initial = useSearchParams().get("tab");

  // Past 135rem there's room for all of it at once, so the tabs would only hide things.
  const everything = useMainAtLeast(MAIN_ULTRA);
  const appearance = (
    <Panel title="Appearance" description="Choose light or dark for the dashboard." className="col-span-12 @2xl:col-span-6">
      <ThemeToggle appearance="segmented" />
    </Panel>
  );
  const demoData = (
    <Panel title="Demo data" description="This is a mock product. Data is kept in this browser only." className="col-span-12 @2xl:col-span-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!hasData} onClick={() => setClearing(true)}>Clear data</Button>
        <Button variant="ghost" onClick={() => { const before = getGateway(); actions.restoreDemoData(); toast.success("Demo data restored", { id: "demo-data", actions: [{ label: "Undo", onClick: () => actions.restoreSnapshot(before) }] }); }}>Restore demo data</Button>
      </div>
    </Panel>
  );

  return (
    <>
      <PageHeader title="Settings" description="Your business, developer access, team and this demo." />
      {everything ? (
        <Bento className="dash-masonry [--masonry-columns:3]">
          <ProfileCard key={payoutKey} settings={settings} />
          <BrandingCard key={brandKey} settings={settings} />
          <TeamCard team={settings.team} />
          <WebhooksCard hooks={settings.webhooks} />
          <ApiKeys keys={settings.apiKeys} />
          <NotificationsCard prefs={settings.notifications} />
          {appearance}
          {demoData}
        </Bento>
      ) : (
      <Tabs defaultSelectedKey={initial && TABS.some(([id]) => id === initial) ? initial : "business"}>
        <TabList aria-label="Settings sections">
          {TABS.map(([id, label]) => <Tab key={id} id={id}>{id === "team" ? <>Team<span className="hidden sm:inline"> and alerts</span></> : label}</Tab>)}
        </TabList>
        <TabPanel id="business" className="pt-4">
          <Bento>
            <ProfileCard key={payoutKey} settings={settings} />
            <BrandingCard key={brandKey} settings={settings} />
          </Bento>
        </TabPanel>
        <TabPanel id="developers" className="pt-4">
          <Bento>
            <WebhooksCard hooks={settings.webhooks} />
            <ApiKeys keys={settings.apiKeys} />
          </Bento>
        </TabPanel>
        <TabPanel id="team" className="pt-4">
          <Bento>
            <TeamCard team={settings.team} />
            <NotificationsCard prefs={settings.notifications} />
          </Bento>
        </TabPanel>
        <TabPanel id="workspace" className="pt-4">
          <Bento>
            {appearance}
            {demoData}
          </Bento>
        </TabPanel>
      </Tabs>
      )}
      <AlertDialog
        isOpen={clearing}
        onOpenChange={setClearing}
        title="Clear demo data?"
        description="Removes every link, widget and payment so you can see the empty states. You can restore them here."
        confirmLabel="Clear data"
        onConfirm={() => {
          const before = getGateway();
          actions.clearDemoData();
          setClearing(false);
          toast.success("Demo data cleared", { id: "demo-data", actions: [{ label: "Undo", onClick: () => actions.restoreSnapshot(before) }] });
        }}
      />
    </>
  );
}

function ProfileCard({ settings }: { settings: Settings }) {
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>(settings.receiveAsset);
  const [nameInvalid, setNameInvalid] = useState(false);
  const dirty = businessName !== settings.businessName || receiveAsset !== settings.receiveAsset;

  const save = () => {
    const badName = businessName.trim() === "";
    setNameInvalid(badName);
    if (badName) return;
    actions.updateSettings({ businessName: businessName.trim(), receiveAsset });
    toast.success("Settings saved");
  };

  return (
    <Panel title="Business" description="New links and widgets default to these." className="col-span-12 @5xl:col-span-7">
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <Input label="Business name" value={businessName} onChange={(value) => { setBusinessName(value); setNameInvalid(false); }} isInvalid={nameInvalid} errorMessage="Enter a business name." hint="Shown to customers at checkout." />
        <AssetSelect label="Preferred receive asset" value={receiveAsset} onChange={setReceiveAsset} />
      </div>
      <div className="dash-well flex flex-wrap items-center justify-between gap-2 rounded-xl p-2.5">
        <span className="flex min-w-0 flex-col">
          <span className="text-body-medium">Payout destination</span>
          <span dir="ltr" className="truncate text-start text-caption-1-regular text-text-secondary">{shortAddress(settings.walletAddress)}</span>
        </span>
        <NavButton href="/dashboard/payouts" variant="secondary" size="small" trailingIcon={RiArrowRightLine}>Manage payouts</NavButton>
      </div>
      <div className="flex justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => { setBusinessName(settings.businessName); setReceiveAsset(settings.receiveAsset); setNameInvalid(false); }}>Discard</Button>}
        <Button disabled={!dirty} onClick={save}>Save changes</Button>
      </div>
    </Panel>
  );
}

function BrandingCard({ settings }: { settings: Settings }) {
  const [accent, setAccent] = useState(settings.branding.accent);
  const [supportEmail, setSupportEmail] = useState(settings.branding.supportEmail);
  const [statementName, setStatementName] = useState(settings.branding.statementName);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const dirty = accent !== settings.branding.accent || supportEmail !== settings.branding.supportEmail || statementName !== settings.branding.statementName;

  const save = () => {
    if (!EMAIL_PATTERN.test(supportEmail.trim())) {
      setEmailInvalid(true);
      return;
    }
    actions.updateSettings({ branding: { accent, supportEmail: supportEmail.trim(), statementName: statementName.trim() } });
    toast.success("Branding saved");
  };

  return (
    <Panel title="Branding" description="The accent is the default for new widgets." className="col-span-12 @5xl:col-span-5">
      <div className="flex flex-col gap-2">
        <Label>Accent color</Label>
        <div className="flex items-center gap-3">
          <ColorWell aria-label="Brand accent color" value={accent} onChange={(color) => setAccent(color.toString("hex"))} />
          <span dir="ltr" className="text-body-medium tabular-nums text-text-secondary">{accent}</span>
        </div>
      </div>
      <Input label="Support email" type="email" inputDir="ltr" value={supportEmail} onChange={(value) => { setSupportEmail(value); setEmailInvalid(false); }} isInvalid={emailInvalid} errorMessage="Enter a valid email address." />
      <Input label="Statement name" value={statementName} onChange={setStatementName} />
      <div className="flex justify-end"><Button variant="secondary" disabled={!dirty} onClick={save}>Save branding</Button></div>
    </Panel>
  );
}

function WebhooksCard({ hooks }: { hooks: Webhook[] }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["payment.settled"]);
  const [invalid, setInvalid] = useState(false);
  const close = () => { setAdding(false); setUrl(""); setEvents(["payment.settled"]); setInvalid(false); };
  const create = () => {
    if (!isHttps(url) || events.length === 0) {
      setInvalid(true);
      return;
    }
    actions.addWebhook({ id: newId("whk_"), url, events, enabled: true, createdAt: new Date().toISOString() });
    toast.success("Webhook added");
    close();
  };

  return (
    <Panel title="Webhooks" description="Mock endpoints. Nothing is sent." actions={<Button variant="secondary" size="small" leadingIcon={RiAddLine} onClick={() => setAdding(true)}>Add endpoint</Button>} className="col-span-12 @5xl:col-span-7">
      {hooks.length === 0 ? <EmptyState icon={RiWebhookLine} title="No webhooks" description="Add an endpoint to hear about payments on your server." /> : (
        <ul className="flex flex-col divide-y divide-separator-border">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span dir="ltr" className="text-body-medium [overflow-wrap:anywhere]">{hook.url}</span>
                <span className="truncate text-caption-1-regular text-text-secondary">{hook.events.length} events, added {formatDate(hook.createdAt)}</span>
              </div>
              <Switch size="sm" isSelected={hook.enabled} onChange={(enabled) => { actions.updateWebhook(hook.id, { enabled }); toast.success(enabled ? "Webhook turned on" : "Webhook turned off", { id: `webhook-${hook.id}`, description: "Mock endpoint. Nothing is sent." }); }} aria-label={`Enable ${hook.url}`} />
              <Button variant="ghost" size="small" iconOnly leadingIcon={RiDeleteBin6Line} aria-label={`Remove ${hook.url}`} onClick={() => { actions.removeWebhook(hook.id); toast.success("Webhook removed", { actions: [{ label: "Undo", onClick: () => actions.addWebhook(hook) }] }); }} />
            </li>
          ))}
        </ul>
      )}
      <Modal isOpen={adding} onOpenChange={(open) => !open && close()} size="sm">
        <ModalHeader title="Add endpoint" />
        <ModalBody className="flex flex-col gap-3 pb-1">
          <Input label="Endpoint URL" inputDir="ltr" placeholder="https://api.yoursite.com/hooks" value={url} onChange={(value) => { setUrl(value); setInvalid(false); }} isInvalid={invalid && !isHttps(url)} errorMessage="Enter a full https:// URL." autoFocus />
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1 text-body-medium">Events</legend>
            {EVENTS.map((event) => (
              <Checkbox key={event} size="sm" isSelected={events.includes(event)} onChange={(on) => setEvents(on ? [...events, event] : events.filter((item) => item !== event))}>{event}</Checkbox>
            ))}
            {invalid && events.length === 0 && <p className="text-caption-1-regular text-text-error-primary">Pick at least one event.</p>}
          </fieldset>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={create}>Add endpoint</Button>
        </ModalFooter>
      </Modal>
    </Panel>
  );
}

function TeamCard({ team }: { team: Settings["team"] }) {
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("viewer");
  const [invalid, setInvalid] = useState(false);
  const close = () => { setInviting(false); setEmail(""); setRole("viewer"); setInvalid(false); };
  const duplicate = team.some((member) => member.email.toLowerCase() === email.trim().toLowerCase());
  const invite = () => {
    if (!EMAIL_PATTERN.test(email.trim()) || duplicate) {
      setInvalid(true);
      return;
    }
    actions.inviteMember({ id: newId("mem_"), name: "Invited teammate", email: email.trim(), role, status: "invited", createdAt: new Date().toISOString() });
    toast.success("Invitation added");
    close();
  };

  return (
    <Panel title="Team" description="Mock seats. No invitations are sent." actions={<Button variant="secondary" size="small" leadingIcon={RiAddLine} onClick={() => setInviting(true)}>Invite</Button>} className="col-span-12 @2xl:col-span-6">
      {team.length === 0 ? <EmptyState icon={RiGroupLine} title="No teammates" description="Invite someone to help run the account." /> : (
        <ul className="flex flex-col divide-y divide-separator-border">
          {team.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <Avatar initials={member.name.slice(0, 2).toUpperCase()} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-medium">{member.name}</span>
                <span dir="ltr" className="text-caption-1-regular text-text-secondary [overflow-wrap:anywhere]">{member.email}</span>
              </div>
              {member.status === "invited" && <Chip color="yellow" variant="caption">Invited</Chip>}
              <Chip color="soft" variant="caption">{ROLE_LABEL[member.role]}</Chip>
              {member.role !== "owner" && <Button variant="ghost" size="small" iconOnly leadingIcon={RiDeleteBin6Line} aria-label={`Remove ${member.email}`} onClick={() => { actions.removeMember(member.id); toast.success("Teammate removed", { actions: [{ label: "Undo", onClick: () => actions.inviteMember(member) }] }); }} />}
            </li>
          ))}
        </ul>
      )}
      <Modal isOpen={inviting} onOpenChange={(open) => !open && close()} size="sm">
        <ModalHeader title="Invite a teammate" />
        <ModalBody className="flex flex-col gap-3 pb-1">
          <Input label="Email" type="email" inputDir="ltr" value={email} onChange={(value) => { setEmail(value); setInvalid(false); }} isInvalid={invalid} errorMessage={duplicate ? "This person is already on the team." : "Enter a valid email address."} autoFocus />
          <Select label="Role" selectedKey={role} onSelectionChange={(key) => setRole(key as TeamRole)} className="w-full" triggerClassName="w-full">
            {ROLES.map(([id, label]) => <SelectItem key={id} id={id} textValue={label}>{label}</SelectItem>)}
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={invite}>Add invitation</Button>
        </ModalFooter>
      </Modal>
    </Panel>
  );
}

function NotificationsCard({ prefs }: { prefs: NotificationPrefs }) {
  return (
    <Panel title="Email alerts" description="Mock preferences. They save, but no email is sent." className="col-span-12 @2xl:col-span-6">
      <ul className="flex flex-col divide-y divide-separator-border">
        {ALERTS.map(([key, title, detail]) => (
          <li key={key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <span className="flex min-w-0 flex-col">
              <span className="text-body-medium">{title}</span>
              <span className="text-caption-1-regular text-text-secondary">{detail}</span>
            </span>
            <Switch size="sm" isSelected={prefs[key]} onChange={(value) => { actions.updateNotifications({ [key]: value }); toast.success("Alert preferences saved", { id: "alerts", description: "Mock preferences. No email is sent." }); }} aria-label={title} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ApiKeys({ keys }: { keys: ApiKey[] }) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const close = () => {
    setCreating(false);
    setLabel("");
    setSecret(null);
  };

  const create = () => {
    const value = newId("gw_test_", 32);
    actions.addApiKey({ id: newId("key_"), label: label.trim() || "Untitled key", prefix: value.slice(0, 12), createdAt: new Date().toISOString() });
    setSecret(value);
  };

  return (
    <Panel title="API keys" description="Mock keys for testing the flow." actions={<Button variant="secondary" size="small" leadingIcon={RiAddLine} onClick={() => setCreating(true)}>New key</Button>} className="col-span-12 @5xl:col-span-5">
      {keys.length === 0 ? (
        <EmptyState icon={RiKey2Line} title="No API keys" description="Create a key to connect your server." />
      ) : (
        <ul className="flex flex-col divide-y divide-separator-border">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-medium">{key.label}</span>
                <span dir="ltr" className="truncate text-caption-1-regular text-text-secondary">{key.prefix}… created {formatDate(key.createdAt)}</span>
              </div>
              <Button variant="ghost" size="small" iconOnly leadingIcon={RiDeleteBin6Line} aria-label={`Revoke ${key.label}`} onClick={() => setRevoking(key)} />
            </li>
          ))}
        </ul>
      )}
      <Modal isOpen={creating} onOpenChange={(open) => !open && close()} size="sm">
        <ModalHeader title={secret ? "Copy your key" : "New API key"} description={secret ? "This is the only time you'll see the full key." : undefined} />
        <ModalBody className="pb-1">
          {secret ? (
            <pre dir="ltr" className="overflow-x-auto rounded-xl bg-background-secondary-default p-3 text-caption-1-regular">{secret}</pre>
          ) : (
            <Input label="Label" placeholder="Production server" value={label} onChange={setLabel} autoFocus />
          )}
        </ModalBody>
        <ModalFooter>
          {secret ? (
            <>
              <CopyButton text={secret} label="API key" />
              <Button onClick={close}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={create}>Create key</Button>
            </>
          )}
        </ModalFooter>
      </Modal>
      <AlertDialog
        isOpen={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this key?"
        description={`Anything using "${revoking?.label}" stops authenticating right away. A revoked key can't be restored.`}
        confirmLabel="Revoke key"
        onConfirm={() => {
          if (revoking) actions.revokeApiKey(revoking.id);
          setRevoking(null);
          toast.success("Key revoked");
        }}
      />
    </Panel>
  );
}

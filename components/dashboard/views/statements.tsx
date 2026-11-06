"use client";

import { useMemo, useState } from "react";
import { RiDownload2Line, RiFileList3Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { toast } from "@/components/base/toast/toast";
import { formatUsd } from "@/lib/format";
import { useGateway } from "@/lib/store";
import type { Payment, Payout } from "@/lib/types";
import { csvCell, saveCsv } from "../csv";
import { formatCount } from "../fmt";
import { EmptyState, ModeTag, PageHeader, Panel } from "../ui";

interface Month {
  key: string;
  gross: number;
  refunded: number;
  fees: number;
  paidOut: number;
  count: number;
  payments: Payment[];
  payouts: Payout[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (key: string) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;

/** One row per taxable event, in the merchant's own records' terms. Their accountant decides what it means. */
function statementCsv(month: Month) {
  const header = "date_utc,type,reference,source,gross_usd,customer_fee_usd,asset,amount,customer_wallet,tx_hash,test_mode";
  const rows = [
    ...month.payments.flatMap((p) => {
      const tx = p.detail?.destinationTxs[0]?.hash ?? p.detail?.originTxs[0]?.hash ?? "";
      const paid = [p.createdAt, "payment", p.id, p.sourceName, p.usd, p.feeUsd ?? 0, p.receiveAsset, p.receiveAmount, p.payer, tx, Boolean(p.simulated)];
      const refund = p.status === "refunded" ? [[p.refundedAt ?? p.createdAt, "refund", p.id, p.sourceName, -p.usd, 0, p.receiveAsset, -p.receiveAmount, p.payer, "", Boolean(p.simulated)]] : [];
      return [paid, ...refund];
    }),
    ...month.payouts.map((p) => [p.createdAt, "payout", p.id, p.destinationLabel, -p.usd, p.feeUsd, p.asset, -p.amount, p.destinationAddress, p.reference, Boolean(p.simulated)]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [header, ...rows.map((row) => row.map((cell) => csvCell(cell as string | number)).join(","))].join("\n");
}

export function StatementsView() {
  const { payments, payouts, settings } = useGateway();
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const months = useMemo(() => {
    const byMonth = new Map<string, Month>();
    const of = (iso: string) => {
      const key = iso.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { key, gross: 0, refunded: 0, fees: 0, paidOut: 0, count: 0, payments: [], payouts: [] });
      return byMonth.get(key) as Month;
    };
    for (const payment of payments) {
      if (payment.status !== "settled" && payment.status !== "refunded") continue;
      const month = of(payment.createdAt);
      month.gross += payment.usd;
      month.fees += payment.feeUsd ?? 0;
      month.count += 1;
      if (payment.status === "refunded") month.refunded += payment.usd;
      month.payments.push(payment);
    }
    for (const payout of payouts) {
      if (payout.status !== "sent") continue;
      const month = of(payout.createdAt);
      month.paidOut += payout.usd;
      month.payouts.push(payout);
    }
    return [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [payments, payouts]);

  const download = (month: Month) => {
    const name = `statement-${month.key}.csv`;
    saveCsv(statementCsv(month), name);
    setDownloaded(month.key);
    toast.success("Statement downloaded", { id: "statement", description: `${name} is in your downloads.` });
  };

  return (
    <>
      <PageHeader title="Statements" description={`Monthly records for ${settings.businessName || "your business"}, for your own tax and accounting. All times are UTC. USD values are as quoted at the time of each payment.`} meta={<ModeTag />} />
      <Panel className="p-2 @3xl:p-2">
        {months.length === 0 ? (
          <EmptyState icon={RiFileList3Line} title="No statements yet" description="A statement appears here after your first settled payment." />
        ) : (
          <Table aria-label="Monthly statements" className="min-w-[640px]">
            <TableHeader>
              <TableColumn isRowHeader>Month</TableColumn>
              <TableColumn>Payments</TableColumn>
              <TableColumn>Gross</TableColumn>
              <TableColumn>Refunded</TableColumn>
              <TableColumn>Paid out</TableColumn>
              <TableColumn aria-label="Download" />
            </TableHeader>
            <TableBody>
              {months.map((month) => (
                <TableRow key={month.key} id={month.key}>
                  <TableCell>{label(month.key)}</TableCell>
                  <TableCell className="tabular-nums">{formatCount(month.count)}</TableCell>
                  <TableCell className="tabular-nums">{formatUsd(month.gross)}</TableCell>
                  <TableCell className="tabular-nums">{formatUsd(month.refunded)}</TableCell>
                  <TableCell className="tabular-nums">{formatUsd(month.paidOut)}</TableCell>
                  <TableCell><Button variant={downloaded === month.key ? "ghost" : "secondary"} size="small" leadingIcon={RiDownload2Line} onClick={() => download(month)}>CSV</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}

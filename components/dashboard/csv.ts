import type { Payment } from "@/lib/types";

/**
 * Source names are merchant-entered, so a leading formula character could run in a spreadsheet.
 * A leading apostrophe makes Excel, Sheets and Numbers read the cell as text.
 */
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function paymentsCsv(rows: Payment[]) {
  const header = "id,created_at_utc,source,status,pay_amount,pay_asset,receive_amount,receive_asset,usd,payer";
  const body = rows.map((p) => [p.id, p.createdAt, p.sourceName, p.status, p.payAmount, p.payAsset, p.receiveAmount, p.receiveAsset, p.usd, p.payer].map(csvCell).join(","));
  return [header, ...body].join("\n");
}

export function downloadCsv(rows: Payment[], filename = "payments.csv") {
  const url = URL.createObjectURL(new Blob([paymentsCsv(rows)], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

import "server-only";
import { appendFile } from "node:fs/promises";
import { env } from "../env";
import { log } from "../log";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** `console` is for local work only: it prints the message, sign-in links included. */
export async function sendEmail(message: Email) {
  const config = env();
  if (config.EMAIL_PROVIDER === "file") {
    if (!config.EMAIL_FILE) throw new Error("EMAIL_FILE is required with EMAIL_PROVIDER=file");
    await appendFile(config.EMAIL_FILE, `${JSON.stringify(message)}\n`);
    return;
  }
  if (config.EMAIL_PROVIDER === "console") {
    if (config.NODE_ENV === "production") log("warn", "EMAIL_PROVIDER=console in production: this email was not delivered", { subject: message.subject });
    else console.log(`\n--- email to ${message.to}: ${message.subject}\n${message.text}\n---\n`);
    return;
  }
  if (!config.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required with EMAIL_PROVIDER=resend");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

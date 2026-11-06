"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { api, errorMessage } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next";
import { AuthCard } from "./auth-card";

export function LoginForm() {
  const params = useSearchParams();
  const isNew = params.get("new") === "1";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/request-link", { body: { email } });
      // Where to go after the link is opened survives in this browser.
      const next = safeNextPath(params.get("next"), window.location.origin);
      if (next) window.sessionStorage.setItem("gateway:next", next);
      setSent(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email" description={<>We sent a sign-in link to <span dir="ltr" className="text-text-primary">{email}</span>. It works once and expires in 15 minutes.</>}>
        <Button variant="secondary" onClick={() => setSent(false)}>Use a different email</Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={isNew ? "Create your account" : "Sign in"} description="We'll email you a link. There's no password to remember.">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <Input label="Email" type="email" inputDir="ltr" autoComplete="email" autoFocus isRequired value={email} onChange={setEmail} />
        {error && <p role="alert" className="text-body-regular text-text-error-primary">{error}</p>}
        <Button type="submit" disabled={busy || !email.includes("@")}>{busy ? "Sending" : "Email me a link"}</Button>
      </form>
    </AuthCard>
  );
}

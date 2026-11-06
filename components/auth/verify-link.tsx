"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Spinner } from "@/components/base/spinner/spinner";
import { NavButton } from "@/components/nav-button";
import { api, ApiError, errorMessage } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next";
import { AuthCard } from "./auth-card";

function nextPath() {
  try {
    const next = window.sessionStorage.getItem("gateway:next");
    window.sessionStorage.removeItem("gateway:next");
    return safeNextPath(next, window.location.origin);
  } catch {
    return null;
  }
}

/** Posts from the browser, so a mail scanner that fetches the link can't use up the one-time token. */
export function VerifyLink() {
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its code.");
  const [confirmAs, setConfirmAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);

  const submit = useCallback((confirmed: boolean) => {
    if (!token) return;
    setBusy(confirmed);
    api<{ needsOnboarding: boolean }>("/api/auth/verify", { body: { token, confirmed } })
      .then(({ needsOnboarding }) => window.location.assign(needsOnboarding ? "/onboarding" : (nextPath() ?? "/dashboard")))
      .catch((failure: unknown) => {
        setBusy(false);
        if (failure instanceof ApiError && failure.code === "confirm_needed") setConfirmAs(String(failure.extra.email));
        else setError(errorMessage(failure));
      });
  }, [token]);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    submit(false);
  }, [submit]);

  if (error) {
    return (
      <AuthCard title="This link didn't work" description={error}>
        <NavButton href="/login">Get a new link</NavButton>
      </AuthCard>
    );
  }
  if (confirmAs) {
    return (
      <AuthCard title="Is this your account?" description={<>This link signs you in as <span dir="ltr" className="text-text-primary">{confirmAs}</span>. It was requested in a different browser. Only continue if that was you. Someone could have sent you their own link.</>}>
        <Button disabled={busy} onClick={() => submit(true)}>{busy ? "Signing in" : `Continue as ${confirmAs}`}</Button>
        <NavButton href="/" variant="secondary">That wasn&apos;t me</NavButton>
      </AuthCard>
    );
  }
  return <AuthCard title="Signing you in"><div className="flex justify-center p-4"><Spinner /></div></AuthCard>;
}

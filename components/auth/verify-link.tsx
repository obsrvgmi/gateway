"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NavButton } from "@/components/nav-button";
import { Spinner } from "@/components/base/spinner/spinner";
import { api, errorMessage } from "@/lib/api";
import { AuthCard } from "./auth-card";

function nextPath() {
  try {
    const next = window.sessionStorage.getItem("gateway:next");
    window.sessionStorage.removeItem("gateway:next");
    return next?.startsWith("/") && !next.startsWith("//") ? next : null;
  } catch {
    return null;
  }
}

/** Posts from the browser, so a mail scanner that fetches the link can't use up the one-time token. */
export function VerifyLink() {
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its code.");
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api<{ needsOnboarding: boolean }>("/api/auth/verify", { body: { token } })
      .then(({ needsOnboarding }) => window.location.assign(needsOnboarding ? "/onboarding" : (nextPath() ?? "/dashboard")))
      .catch((failure: unknown) => setError(errorMessage(failure)));
  }, [token]);

  if (error) {
    return (
      <AuthCard title="This link didn't work" description={error}>
        <NavButton href="/login">Get a new link</NavButton>
      </AuthCard>
    );
  }
  return <AuthCard title="Signing you in"><div className="flex justify-center p-4"><Spinner /></div></AuthCard>;
}

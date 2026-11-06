"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { NavButton } from "@/components/nav-button";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AuthCard } from "./auth-card";

export function AcceptInvite({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/invites/accept", { body: { token } });
      window.location.assign("/dashboard");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setNeedsLogin(true);
      else setError(errorMessage(failure));
      setBusy(false);
    }
  };

  if (needsLogin) {
    return (
      <AuthCard title="Sign in to accept" description="Use the email address this invitation was sent to, then open the invitation again.">
        <NavButton href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</NavButton>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="You've been invited" description="Join this workspace on Gateway.">
      {error && <p role="alert" className="text-body-regular text-text-error-primary">{error}</p>}
      <Button disabled={busy} onClick={() => void accept()}>{busy ? "Joining" : "Accept invitation"}</Button>
    </AuthCard>
  );
}

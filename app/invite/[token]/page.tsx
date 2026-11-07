import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvite } from "@/components/auth/accept-invite";

export const metadata: Metadata = { title: "Join a workspace", robots: { index: false } };

async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return <Suspense><Invite params={params} /></Suspense>;
}

import { z } from "zod";
import { db, schema } from "@/server/db";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { assertSameOrigin, clientIp, json, publicRoute, readJson } from "@/server/http/route";
import { rateLimit } from "@/server/http/rate-limit";
import { hashSecret, newSecret } from "@/server/ids";
import { log } from "@/server/log";
import { email } from "@/server/schemas";

const LINK_MINUTES = 15;

/** Always answers the same way, so it can't be used to learn who has an account. */
export const POST = publicRoute(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request, z.object({ email }));
  await rateLimit(`login:email:${body.email}`, 5, 900);
  const ip = clientIp(request);
  if (ip) await rateLimit(`login:ip:${ip}`, 30, 900);

  const token = newSecret();
  await db().insert(schema.loginTokens).values({
    tokenHash: hashSecret(token),
    email: body.email,
    expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000),
  });
  const link = `${env().APP_URL}/login/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendEmail({
      to: body.email,
      subject: "Your sign-in link",
      text: `Sign in to Gateway:\n\n${link}\n\nThis link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    });
  } catch (error) {
    log("error", "login email failed", { error });
  }
  return json({ ok: true });
});

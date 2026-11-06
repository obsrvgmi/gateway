import { sessionCookie } from "@/server/auth/cookie";
import { destroySession, SESSION_COOKIE } from "@/server/auth/session";
import { assertSameOrigin, json, publicRoute } from "@/server/http/route";

export const POST = publicRoute(async (request) => {
  assertSameOrigin(request);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  const response = json({ ok: true });
  response.cookies.set({ ...sessionCookie("", new Date(0)) });
  return response;
});

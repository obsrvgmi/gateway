import { env } from "../env";
import { SESSION_COOKIE } from "./session";

export const LOGIN_NONCE_COOKIE = "gw_login";

export function sessionCookie(token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

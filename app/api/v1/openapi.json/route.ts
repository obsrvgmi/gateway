import { openapiFor } from "@/lib/openapi";
import { env } from "@/server/env";
import { json, publicRoute } from "@/server/http/route";

/**
 * No key needed: it describes the API, and any site or tool (Postman, a client generator) may fetch it.
 * Reading the request keeps it out of the build's prerender, where there's no APP_URL to name the server.
 */
export const GET = publicRoute(async (request) => {
  const accept = request.headers.get("accept");
  void accept;
  return json(openapiFor(new URL(env().APP_URL).origin), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
});

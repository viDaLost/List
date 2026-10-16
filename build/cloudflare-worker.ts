import handler from "vinext/server/fetch-handler";
import { standaloneRequest } from "../lib/standalone-auth";
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const authenticated = await standaloneRequest(request, env);
    if (authenticated instanceof Response) return authenticated;
    return handler.fetch(authenticated, env, ctx);
  },
};

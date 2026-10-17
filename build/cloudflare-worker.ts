import { standaloneRequest } from "../lib/standalone-auth";
import {publicDelivery,drainResponse} from '../lib/public-delivery';
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const render=async(input:Request)=>{
      const authenticated=await standaloneRequest(input,env);
      if(authenticated instanceof Response)return authenticated;
      const {default:handler}=await import('vinext/server/fetch-handler');
      return handler.fetch(authenticated,env,ctx);
    };
    const cached=await publicDelivery(request,env,ctx,render);
    if(cached)return cached;
    const response=await render(request),warm=response.headers.get('X-List-Warm-Path');
    if(!warm)return response;
    if(env.BUCKET)ctx.waitUntil((async()=>{
      const target=new Request(new URL('/'+warm,new URL(request.url).origin),{headers:{Accept:'text/html'}});
      await drainResponse(await publicDelivery(target,env,ctx,render));
    })().catch(()=>console.error('Publication warm-up failed; it will be retried by the first reader')));
    const headers=new Headers(response.headers);headers.delete('X-List-Warm-Path');
    return new Response(response.body,{status:response.status,headers});
  },
};

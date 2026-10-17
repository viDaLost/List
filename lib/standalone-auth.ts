import { managementAuthor, requestAuthor } from "./browser-access";
export async function standaloneRequest(request:Request,_env?:unknown):Promise<Request|Response>{
 const url=new URL(request.url);
 if(["/signin-with-chatgpt","/signout-with-chatgpt","/callback"].includes(url.pathname))return new Response(null,{status:303,headers:{Location:"/access","Cache-Control":"no-store"}});
 const headers=new Headers(request.headers);
 for(const name of [...headers.keys()])if(name.startsWith("oai-authenticated-user-"))headers.delete(name);
 const pathname=url.pathname.replace(/\/+$/,'');
 const management=pathname==='/_list/admin'||pathname==='/_list/telegram'||pathname==='/api/admin'||pathname.startsWith('/api/admin/');
 const user=(management?await managementAuthor(request):null)||await requestAuthor(request);
 if(user){headers.set("oai-authenticated-user-id",user.id);headers.set("oai-authenticated-user-admin",user.is_admin?"1":"0");}
 return new Request(request,{headers});
}

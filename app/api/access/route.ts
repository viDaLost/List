import { endpoint,readBody,HttpError,sql } from "@/lib/server";
import { authorCookie,cookieHeader,createAuthor,lookupAccessKey,limitAccess,publicAuthor,redeemAccessLink } from "@/lib/browser-access";
export async function GET(request:Request){return endpoint(async()=>{const author=await lookupAccessKey(authorCookie(request));const bot=await sql().prepare("SELECT value FROM settings WHERE key='telegram_username'").first<{value:string}>();return Response.json({user:author?publicAuthor(author):null,telegram:bot?.value||null,linked:!!author?.telegram_id},{headers:{"Cache-Control":"private, no-store"}});});}
export async function POST(request:Request){return endpoint(async()=>{const body=await readBody(request),existing=await lookupAccessKey(authorCookie(request));let result;
 if(body.action==="create"){if(existing)return Response.json({user:publicAuthor(existing)},{headers:{"Cache-Control":"no-store"}});await limitAccess(request);result=await createAuthor();}
 else if(body.action==="ticket"){await limitAccess(request);result=await redeemAccessLink(String(body.ticket||""));}
 else if(body.action==="recover"){await limitAccess(request);const key=String(body.key||"").trim(),author=await lookupAccessKey(key);if(!author)throw new HttpError(400,"Ключ не найден. Проверьте его или запросите ссылку у бота.");result={key,author};}
 else if(body.action==="export"){if(!existing)throw new HttpError(401,"В этом браузере пока нет ключа автора.");return Response.json({key:authorCookie(request)},{headers:{"Cache-Control":"private, no-store"}});}
 else throw new HttpError(400,"Неизвестное действие.");
 return Response.json({user:publicAuthor(result.author)},{headers:{"Set-Cookie":cookieHeader(result.key),"Cache-Control":"private, no-store"}});
});}

import {env} from "cloudflare:workers";
import {timingSafeEqual} from "node:crypto";
import {Buffer} from "node:buffer";
import {endpoint,sql,HttpError} from "@/lib/server";
import {hashKey,issueAccessLink,type AuthorRecord} from "@/lib/browser-access";
import {rateLimit} from "@/lib/operations";
export async function POST(request:Request){return endpoint(async()=>{
 const expected=env.TELEGRAM_BRIDGE_SECRET||"",actual=request.headers.get("x-list-bridge")||"";
 if(expected.length<32||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new HttpError(403,"Forbidden");
 const raw=await request.text();if(raw.length>8000)throw new HttpError(413,"Payload too large");let body;try{body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("Invalid object");}catch{throw new HttpError(400,"Invalid JSON");}
 if(body.action==="configure"){if(!/^[A-Za-z0-9_]{5,32}$/.test(body.username))throw new HttpError(400,"Invalid bot username");await sql().prepare("INSERT INTO settings (key,value) VALUES ('telegram_username',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(body.username).run();return Response.json({ok:true});}
 const tg=String(body.telegramId||"");if(!/^[1-9][0-9]{0,15}$/.test(tg))throw new HttpError(400,"Invalid user");await rateLimit("tg-bridge:"+tg,10,60000);
 let author:AuthorRecord|null=null;
 if(body.action==="bind"){
  const hash=await hashKey(String(body.token||""));const grant=await sql().prepare("SELECT author_id FROM access_links WHERE key_hash=? AND kind='connect' AND expires_at>?").bind(hash,Date.now()).first<{author_id:string}>();if(!grant)throw new HttpError(400,"Ссылка привязки истекла. Создайте новую на сайте.");
  const existing=await sql().prepare("SELECT id FROM authors WHERE telegram_id=?").bind(tg).first<{id:string}>();if(existing&&existing.id!==grant.author_id)throw new HttpError(409,"Telegram уже связан с другими статьями. Отправьте /start, чтобы открыть их. Для этого браузера сохраните отдельный ключ.");
  const result=await sql().batch([sql().prepare("UPDATE authors SET telegram_id=? WHERE id=? AND (telegram_id IS NULL OR telegram_id=?)").bind(tg,grant.author_id,tg),sql().prepare("DELETE FROM access_links WHERE key_hash=?").bind(hash)]);if(!result[0].meta.changes)throw new HttpError(409,"Этот доступ уже привязан к другому Telegram.");
 }
 author=await sql().prepare("SELECT id,is_admin,telegram_id FROM authors WHERE telegram_id=?").bind(tg).first<AuthorRecord>();if(!author)throw new HttpError(404,"Сначала откройте на сайте «Доступ к статьям» и привяжите этот браузер к боту.");
 if(body.action==="articles"){const articles=await sql().prepare("SELECT title,slug,published FROM articles WHERE owner_id=? ORDER BY updated_at DESC LIMIT 20").bind(author.id).all();return Response.json({authorId:author.id,articles:articles.results},{headers:{"Cache-Control":"no-store"}});}
 if(!["restore","bind"].includes(body.action))throw new HttpError(400,"Invalid action");
 const ticket=await issueAccessLink(author.id,"restore",600000);return Response.json({authorId:author.id,url:new URL(request.url).origin+"/access#ticket="+ticket},{headers:{"Cache-Control":"private, no-store"}});
});}

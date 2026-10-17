import { Buffer } from "node:buffer";
import { sql, HttpError } from "./server";
import { rateLimit } from "./operations";
export const accessCookieName = "__Host-list-author";
export const telegramCookieName = "__Host-list-telegram-author";
export const ownerCookieName = "__Host-list-owner";
export type AccessMode = 'browser'|'telegram';
export function accessMode(request:Request):AccessMode{return request.headers.get('x-list-context')==='telegram'?'telegram':'browser';}
export type AuthorRecord = { id: string; is_admin: number; telegram_id: string | null };
export function randomKey() { return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"); }
export async function hashKey(value: string) { return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex"); }
function readCookie(request: Request,name:string) { const values=(request.headers.get("cookie")||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(name+"=")); return values.length===1?values[0].slice(name.length+1):""; }
export function authorCookie(request: Request,mode=accessMode(request)) { return readCookie(request,mode==='telegram'?telegramCookieName:accessCookieName); }
export function cookieHeader(value: string,mode:AccessMode='browser') { return (mode==='telegram'?telegramCookieName:accessCookieName)+"="+value+"; Path=/; Secure; HttpOnly; SameSite="+(mode==='telegram'?'None':'Lax')+"; Max-Age="+(value?31536000:0); }
export function ownerCookieHeader(value:string) { return ownerCookieName+"="+value+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+(value?31536000:0); }
async function lookupKey(key:string,ownerOnly=false):Promise<AuthorRecord|null> {
 if(!/^[A-Za-z0-9_-]{43}$/.test(key))return null;
 // Domain separation prevents an owner session from becoming an article session,
 // even if somebody moves its value into a different cookie.
 return sql().prepare("SELECT a.id,a.is_admin,a.telegram_id FROM access_keys k JOIN authors a ON a.id=k.author_id WHERE k.key_hash=?").bind((ownerOnly?'owner:':'')+await hashKey(key)).first<AuthorRecord>();
}
export async function lookupAccessKey(key:string){return lookupKey(key);}
export async function requestAuthor(request:Request){const a=await lookupAccessKey(authorCookie(request));return a&&Boolean(a.telegram_id)===(accessMode(request)==='telegram')?a:null;}
export async function managementAuthor(request:Request):Promise<AuthorRecord|null> {
 const owner=await lookupKey(readCookie(request,ownerCookieName),true);
 if(owner?.is_admin)return owner;
 // Preserve an existing owner's browser session after a Telegram link. This
 // exception is only used by management routes, never the article APIs.
 const legacy=await lookupAccessKey(authorCookie(request,'browser'));
 return legacy?.is_admin?legacy:null;
}
export async function limitAccess(request: Request) { const ip=await hashKey("access:"+(request.headers.get("cf-connecting-ip")||"local")); await rateLimit("access:m:"+ip,12,60000); await rateLimit("access:d:"+ip,60,86400000); }
export async function createAuthor() { const id=crypto.randomUUID(),key=randomKey(),now=Date.now(); await sql().batch([sql().prepare("INSERT INTO authors (id,is_admin,created_at) VALUES (?,0,?)").bind(id,now),sql().prepare("INSERT INTO access_keys (key_hash,author_id,created_at) VALUES (?,?,?)").bind(await hashKey(key),id,now)]); return {key,author:{id,is_admin:0,telegram_id:null} as AuthorRecord}; }
export async function issueAccessLink(authorId:string,kind="restore",duration=900000){const key=randomKey(),now=Date.now();await sql().prepare("DELETE FROM access_links WHERE expires_at<?").bind(now).run();await sql().prepare("INSERT INTO access_links (key_hash,author_id,kind,expires_at) VALUES (?,?,?,?)").bind(await hashKey(key),authorId,kind,now+duration).run();return key;}
async function redeemLink(token:string,ownerOnly=false){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new HttpError(400,"Неверная ссылка доступа.");
 const key=randomKey(),hash=(ownerOnly?'owner:':'')+await hashKey(key),now=Date.now(),ticketHash=await hashKey(token);
 const predicate="key_hash=? AND kind='restore' AND expires_at>?"+(ownerOnly?" AND author_id IN (SELECT id FROM authors WHERE is_admin=1)":"");
 const results=await sql().batch([
  sql().prepare("INSERT INTO access_keys (key_hash,author_id,created_at) SELECT ?,author_id,? FROM access_links WHERE "+predicate).bind(hash,now,ticketHash,now),
  sql().prepare("DELETE FROM access_links WHERE "+predicate).bind(ticketHash,now)
 ]);
 if(!results[0].meta.changes)throw new HttpError(400,"Ссылка уже использована, истекла или не даёт доступа владельца.");
 return {key,author:(await lookupKey(key,ownerOnly))!};
}
export async function redeemAccessLink(token:string){return redeemLink(token);}
export async function redeemOwnerLink(token:string){return redeemLink(token,true);}
export function publicAuthor(a:AuthorRecord){return {userId:a.id,fullName:null,displayName:"Ваши статьи",email:"",isAdmin:!!a.is_admin};}

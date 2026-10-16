import {endpoint,readBody,HttpError,sql} from '@/lib/server';
import {requestAuthor,accessMode,cookieHeader,createAuthor,limitAccess,publicAuthor,redeemAccessLink,hashKey} from '@/lib/browser-access';
export async function GET(request:Request){return endpoint(async()=>{const author=await requestAuthor(request),bot=await sql().prepare("SELECT value FROM settings WHERE key='telegram_username'").first<{value:string}>();return Response.json({user:author?publicAuthor(author):null,telegram:bot?.value||null,mode:accessMode(request)},{headers:{'Cache-Control':'private, no-store'}});});}
export async function POST(request:Request){return endpoint(async()=>{
 const body=await readBody(request),existing=await requestAuthor(request);let result;
 if(body.action==='create'){
  if(accessMode(request)==='telegram')throw new HttpError(401,'Откройте редактор кнопкой в боте: доступ создаётся по Telegram ID.');
  if(existing)return Response.json({user:publicAuthor(existing)},{headers:{'Cache-Control':'no-store'}});
  await limitAccess(request);result=await createAuthor();
 }else if(body.action==='ticket'){
  // One-time owner handoff only; regular authors never move between contexts.
  await limitAccess(request);
  const grant=await sql().prepare("SELECT a.is_admin FROM access_links l JOIN authors a ON a.id=l.author_id WHERE l.key_hash=? AND l.kind='restore' AND a.is_admin=1 AND a.telegram_id IS NULL").bind(await hashKey(String(body.ticket||''))).first();
  if(!grant)throw new HttpError(400,'Ссылка владельца недействительна.');
  result=await redeemAccessLink(String(body.ticket||''));
 }else throw new HttpError(400,'Доступ к статьям сохраняется в этом браузере. В Telegram используйте кнопки бота.');
 return Response.json({user:publicAuthor(result.author)},{headers:{'Set-Cookie':cookieHeader(result.key),'Cache-Control':'private, no-store'}});
});}

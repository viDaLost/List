import {endpoint,readBody,HttpError,sql} from '@/lib/server';
import {requestAuthor,managementAuthor,accessMode,cookieHeader,ownerCookieHeader,createAuthor,limitAccess,publicAuthor,redeemOwnerLink} from '@/lib/browser-access';
export async function GET(request:Request){return endpoint(async()=>{const author=await requestAuthor(request),owner=await managementAuthor(request),bot=await sql().prepare("SELECT value FROM settings WHERE key='telegram_username'").first<{value:string}>();return Response.json({user:author?publicAuthor(author):null,owner:!!owner,telegram:bot?.value||null,mode:accessMode(request)},{headers:{'Cache-Control':'private, no-store'}});});}
export async function POST(request:Request){return endpoint(async()=>{
 const body=await readBody(request),existing=await requestAuthor(request);let result;
 if(body.action==='create'){
  if(accessMode(request)==='telegram')throw new HttpError(401,'Откройте редактор кнопкой в боте: доступ создаётся по Telegram ID.');
  if(existing)return Response.json({user:publicAuthor(existing)},{headers:{'Cache-Control':'no-store'}});
  await limitAccess(request);result=await createAuthor();
 }else if(body.action==='ticket'){
  // Management-only handoff: it never replaces the browser's article identity.
  await limitAccess(request);
  result=await redeemOwnerLink(String(body.ticket||''));
  return Response.json({owner:true},{headers:{'Set-Cookie':ownerCookieHeader(result.key),'Cache-Control':'private, no-store'}});
 }else throw new HttpError(400,'Доступ к статьям сохраняется в этом браузере. В Telegram используйте кнопки бота.');
 return Response.json({user:publicAuthor(result.author)},{headers:{'Set-Cookie':cookieHeader(result.key),'Cache-Control':'private, no-store'}});
});}

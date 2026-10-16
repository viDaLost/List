import {endpoint,readBody,sql,HttpError} from '@/lib/server';
import {verifyTelegramData,telegramAuthor,telegramSession} from '@/lib/telegram-identity';
import {cookieHeader,publicAuthor,hashKey,requestAuthor} from '@/lib/browser-access';
import {rateLimit} from '@/lib/operations';
export async function POST(request:Request){return endpoint(async()=>{
 const body=await readBody(request);await rateLimit('tg-auth-ip:'+await hashKey(request.headers.get('cf-connecting-ip')||'local'),120,60000);
 const config=await sql().prepare("SELECT value FROM settings WHERE key='telegram_bot_id'").first<{value:string}>();
 if(!config?.value)throw new HttpError(503,'Владелец ещё обновляет Telegram-бота. Пока можно писать через обычный браузер.');
 const id=await verifyTelegramData(body.initData,config.value),author=await telegramAuthor(id);
 await rateLimit('tg-auth:'+id,180,3600000);
 const current=request.headers.get('x-list-context')==='telegram'?await requestAuthor(request):null;
 if(current?.id===author.id)return Response.json({user:publicAuthor(author)},{headers:{'Cache-Control':'private, no-store'}});
 return Response.json({user:publicAuthor(author)},{headers:{'Set-Cookie':cookieHeader(await telegramSession(author),'telegram'),'Cache-Control':'private, no-store'}});
});}

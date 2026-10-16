import {env} from 'cloudflare:workers';
import {admin,rateLimit} from '@/lib/operations';
import {endpoint,readBody,HttpError,sql} from '@/lib/server';
import {deployTelegramBot,TelegramSetupError} from '@/lib/telegram-deploy';
export async function POST(request:Request){return endpoint(async()=>{
 const user=await admin();await rateLimit('tg-setup:'+user.userId,3,3600000);
 if(Number(request.headers.get('content-length')||0)>2000)throw new HttpError(413,'Токен слишком длинный.');
 const body=await readBody(request);if(typeof body.token!=='string'||body.token.length>512)throw new HttpError(400,'Вставьте CLI Access token.');
 let result;try{result=await deployTelegramBot(body.token,env.TELEGRAM_BRIDGE_SECRET||'');}catch(error){if(error instanceof TelegramSetupError)throw new HttpError(400,error.message);throw new HttpError(502,'Подключение Telegram прервано. Попробуйте ещё раз.');}
 await sql().prepare("INSERT INTO settings (key,value) VALUES ('telegram_username',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(result.username).run();
 return Response.json({ok:true,username:result.username},{headers:{'Cache-Control':'private, no-store'}});
});}

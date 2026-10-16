import {author,endpoint,readBody,sql,HttpError} from "@/lib/server";
import {issueAccessLink} from "@/lib/browser-access";
import {rateLimit} from "@/lib/operations";
export async function POST(request:Request){return endpoint(async()=>{const user=await author();await readBody(request);await rateLimit("tg-connect:"+user.userId,5,60000);const bot=await sql().prepare("SELECT value FROM settings WHERE key='telegram_username'").first<{value:string}>();if(!bot?.value)throw new HttpError(503,"Telegram-бот ещё не подключён. Сохраните секретный ключ на странице доступа.");const token=await issueAccessLink(user.userId,"connect");return Response.json({url:"https://t.me/"+bot.value+"?start=bind_"+token},{headers:{"Cache-Control":"no-store"}});});}

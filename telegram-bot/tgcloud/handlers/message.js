import {api,db} from 'sdk';
import {bridge} from '../lib/bridge.js';
import {showMenu,showArticles,appUrl} from '../lib/menu.js';
export default async function(message){
 if(message.chat?.type!=='private'||!message.from||message.from.is_bot)return;
 const text=(message.text||'').trim(),telegramId=message.from.id;
 try{
  const account=await bridge({action:'start',telegramId});
  await db.run('INSERT INTO users (telegram_id,author_id,updated_at) VALUES (:tg,:author,:now) ON CONFLICT(telegram_id) DO UPDATE SET author_id=excluded.author_id,updated_at=excluded.updated_at',{':tg':telegramId,':author':account.authorId,':now':Date.now()});
  if(/^\/articles(?:@\w+)?(?:\s|$)/.test(text)){await showArticles(message.chat.id,telegramId);return;}
  if(/^\/delete(?:@\w+)?(?:\s|$)/.test(text)){await showArticles(message.chat.id,telegramId,'delete');return;}
  if(/^\/new(?:@\w+)?(?:\s|$)/.test(text)){await api.sendMessage({chat_id:message.chat.id,text:'Откройте редактор. Черновик и публикация будут принадлежать вам в Telegram.',reply_markup:{inline_keyboard:[[{text:'Начать новую статью',web_app:{url:appUrl('new')}}]]}});return;}
  await showMenu(message.chat.id);
 }catch(error){await api.sendMessage({chat_id:message.chat.id,text:error instanceof Error?error.message:'Не удалось открыть статьи. Попробуйте ещё раз.'});}
}

import {api,db} from 'sdk';
import {bridge,SITE} from '../lib/bridge.js';
export default async function(message){
 if(message.chat?.type!=='private'||!message.from||message.from.is_bot)return;
 const text=(message.text||'').trim(),telegramId=message.from.id;
 if(!/^\/(start|articles)(?:@\w+)?(?:\s|$)/.test(text)){await api.sendMessage({chat_id:message.chat.id,text:'Лист — статьи без паролей. /start — открыть свои статьи, /articles — список публикаций. Для первой привязки нажмите «Доступ к статьям» на сайте: '+SITE});return;}
 try{
  const binding=text.match(/^\/start(?:@\w+)?\s+bind_([A-Za-z0-9_-]{43})$/);
  const action=text.startsWith('/articles')?'articles':binding?'bind':'restore';
  const data=await bridge({action,telegramId,...(binding?{token:binding[1]}:{})});
  await db.run('INSERT INTO users (telegram_id,author_id,updated_at) VALUES (:tg,:author,:now) ON CONFLICT(telegram_id) DO UPDATE SET author_id=excluded.author_id,updated_at=excluded.updated_at',{':tg':telegramId,':author':data.authorId,':now':Date.now()});
  if(action==='articles'){const lines=data.articles.map(a=>(a.published?'Опубликовано: ':'Черновик: ')+a.title+(a.published?'\n'+SITE+'/'+a.slug.split('/').map(encodeURIComponent).join('/'):'')).join('\n\n');await api.sendMessage({chat_id:message.chat.id,text:(lines||'Ваших статей пока нет.').slice(0,3900)});return;}
  await api.sendMessage({chat_id:message.chat.id,text:(binding?'Доступ привязан к Telegram. ':'')+'Ссылка откроет ваши статьи. Она действует 10 минут и используется один раз. Не пересылайте её.',reply_markup:{inline_keyboard:[[{text:'Открыть мои статьи',url:data.url}]]}});
 }catch(error){await api.sendMessage({chat_id:message.chat.id,text:error instanceof Error?error.message:'Не удалось открыть статьи. Попробуйте ещё раз.'});}
}

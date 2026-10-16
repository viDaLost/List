import {api} from 'sdk';
import {bridge} from '../lib/bridge.js';
import {showMenu,showArticles} from '../lib/menu.js';
export default async function(query){
 if(query.message?.chat?.type!=='private'||!query.from||query.from.is_bot)return;
 await api.answerCallbackQuery({callback_query_id:query.id});
 const chatId=query.message.chat.id,telegramId=query.from.id,data=query.data||'';
 try{
  if(data==='menu'){await showMenu(chatId);return;}
  const list=/^(articles|delete):(\d{1,3})$/.exec(data);
  if(list){await showArticles(chatId,telegramId,list[1],Number(list[2]));return;}
  const remove=/^remove:([a-f0-9-]{36})$/.exec(data);
  if(remove){const result=await bridge({action:'article',telegramId,articleId:remove[1]}),article=result.article;await api.sendMessage({chat_id:chatId,text:'Удалить «'+article.title.slice(0,200)+'»? Статья и все её адреса перестанут открываться.',reply_markup:{inline_keyboard:[[{text:'Да, удалить',callback_data:'confirm:'+article.id+':'+article.version}],[{text:'Отмена',callback_data:'delete:0'}]]}});return;}
  const confirm=/^confirm:([a-f0-9-]{36}):(\d{1,10})$/.exec(data);
  if(confirm){await bridge({action:'delete',telegramId,articleId:confirm[1],version:Number(confirm[2])});await api.sendMessage({chat_id:chatId,text:'Статья удалена.'});await showArticles(chatId,telegramId,'delete');return;}
  await showMenu(chatId);
 }catch(error){await api.sendMessage({chat_id:chatId,text:error instanceof Error?error.message:'Не удалось выполнить действие. Обновите список.'});}
}

import {api} from 'sdk';
import {bridge,SITE} from './bridge.js';
export function appUrl(screen='articles',article){return SITE+'/_list/app?screen='+encodeURIComponent(screen)+(article?'&article='+encodeURIComponent(article):'');}
export const menu={inline_keyboard:[[{text:'Мои статьи',callback_data:'articles:0'}],[{text:'Новая статья',web_app:{url:appUrl('new')}}],[{text:'Удалить статью',callback_data:'delete:0'}]]};
export async function showMenu(chatId){await api.sendMessage({chat_id:chatId,text:'Лист — ваши статьи. Пишите, возвращайтесь к черновикам и редактируйте публикации. Доступ в Telegram определяется автоматически.',reply_markup:menu});}
export async function showArticles(chatId,telegramId,mode='articles',page=0){
 const data=await bridge({action:'articles',telegramId}),all=data.articles||[],start=Math.max(0,Math.min(Number(page)||0,Math.max(0,Math.ceil(all.length/8)-1)))*8;
 const rows=[];
 for(const article of all.slice(start,start+8)){
  const label=(article.published?'✓ ':'✎ ')+(article.title||'Без названия').slice(0,44);
  if(mode==='delete')rows.push([{text:label,callback_data:'remove:'+article.id}]);
  else {rows.push([{text:label,web_app:{url:appUrl('edit',article.id)}}]);if(article.published)rows.push([{text:'Предпросмотр',web_app:{url:appUrl('read',article.id)}}]);}
 }
 const paging=[];if(start>0)paging.push({text:'← Назад',callback_data:mode+':'+(start/8-1)});if(start+8<all.length)paging.push({text:'Далее →',callback_data:mode+':'+(start/8+1)});if(paging.length)rows.push(paging);
 rows.push([{text:'Новая статья',web_app:{url:appUrl('new')}},{text:'Меню',callback_data:'menu'}]);
 await api.sendMessage({chat_id:chatId,text:all.length?(mode==='delete'?'Выберите статью для удаления. Перед удалением будет подтверждение.':'Ваши статьи: ✓ опубликовано, ✎ черновик. Нажмите название, чтобы редактировать.'):'Статей пока нет. Создайте первую — черновик будет сохраняться автоматически.',reply_markup:{inline_keyboard:rows}});
}

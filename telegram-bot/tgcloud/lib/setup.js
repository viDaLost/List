// Executed only by the authenticated management API; never a public endpoint.
import {api,db,fetch} from 'sdk';
import {SITE} from './bridge.js';
import {appUrl} from './menu.js';
export default async function(input){
 if(typeof input?.bridgeSecret!=='string'||input.bridgeSecret.length<32)throw new Error('A bridge secret is required');
 const me=await api.getMe({});
 const response=await fetch(SITE+'/api/telegram/bridge',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'List-Telegram-Serverless/1.0','X-List-Bridge':input.bridgeSecret},body:JSON.stringify({action:'configure',username:me.username,botId:me.id})});
 if(!response.ok)throw new Error('Website setup failed');
 await db.run('INSERT INTO settings (key,value) VALUES (:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value',{':key':'bridge_secret',':value':input.bridgeSecret});
 try{await api.setChatMenuButton({menu_button:{type:'web_app',text:'Мои статьи',web_app:{url:appUrl('articles')}}});await api.setMyCommands({commands:[{command:'start',description:'Открыть меню'},{command:'articles',description:'Мои статьи и черновики'},{command:'new',description:'Начать новую статью'},{command:'delete',description:'Удалить свою статью'}]});}catch{}
 return {ready:true,username:me.username};
}

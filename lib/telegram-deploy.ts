import {telegramSources} from './telegram-sources';
export class TelegramSetupError extends Error {}
type Change={status:string;kind:string;table:string;column?:string;index?:string};
type State={revision:number;canonical_modules?:Record<string,string>;static?:unknown};
export async function deployTelegramBot(rawToken:string,bridgeSecret:string,transport:typeof fetch=fetch){
 const token=rawToken.trim();
 if(!/^app\d+:[A-Za-z0-9_-]{1,400}$/.test(token))throw new TelegramSetupError('Нужен CLI Access token вида app123:… из раздела Serverless. Обычный API-токен не подходит.');
 if(bridgeSecret.length<32)throw new TelegramSetupError('Серверный ключ связи с ботом не настроен.');
 const appId=token.split(':')[0],base='https://cloud.telegram.org/'+appId+'/manage';
 async function call<T>(path:string,method='GET',body?:object):Promise<T>{
  let response:Response;
  try{response=await transport(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'List-Serverless-Setup/1.0'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new TelegramSetupError('Не удалось связаться с Telegram Serverless. Попробуйте ещё раз.');}
  if(response.status===401||response.status===403)throw new TelegramSetupError('Telegram не принял CLI-токен. Проверьте его и включите Serverless в BotFather.');
  if(response.status===409)throw new TelegramSetupError('Бот изменён в другом окне. Обновите страницу и повторите подключение.');
  const reader=response.body?.getReader();if(!reader)throw new TelegramSetupError('Telegram вернул пустой ответ.');
  const decoder=new TextDecoder();let text='',bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw new TelegramSetupError('Проект этого бота слишком большой для автоматического подключения. Выберите отдельного бота.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch(error){if(error instanceof TelegramSetupError)throw error;throw new TelegramSetupError('Ответ Telegram прерван. Повторите подключение.');}
  let data:{ok?:boolean;result?:T};try{data=JSON.parse(text);}catch{throw new TelegramSetupError('Telegram Serverless временно вернул некорректный ответ.');}
  if(!response.ok||data.ok!==true||data.result===undefined)throw new TelegramSetupError('Telegram не выполнил шаг '+path+'. Проверьте, что для бота включён Serverless.');
  return data.result;
 }
 const remote=await call<State>('/get');
 if(!Number.isSafeInteger(remote.revision))throw new TelegramSetupError('Не удалось проверить версию проекта Telegram.');
 const modules=remote.canonical_modules||{};
 if(remote.static||Object.entries(modules).some(([name,source])=>!telegramSources[name]||source.trim().replaceAll('\r\n','\n')!==telegramSources[name].trim().replaceAll('\r\n','\n')))throw new TelegramSetupError('В этом боте уже есть другой проект. Его код не изменён. Создайте отдельного бота для Листа.');
 const planned=await call<{db_changes?:Change[]}>('/migrate','POST',{schema:telegramSources.schema,dry_run:true});
 const changes=planned.db_changes||[];
 if(changes.some(c=>c.status!=='good'||!['create_table','create_column','create_index'].includes(c.kind)))throw new TelegramSetupError('База бота содержит несовместимые данные. Ничего не изменено. Используйте отдельного бота.');
 await call('/deploy','POST',{expected_revision:remote.revision,manifest:Object.keys(telegramSources),changed_sources:telegramSources});
 if(changes.length)await call('/migrate','POST',{schema:telegramSources.schema,apply:changes.map(c=>c.kind+':'+c.table+(c.column?'.'+c.column:c.index?'.'+c.index:''))});
 const setupSources={...telegramSources,'handlers/message':"import setup from '../lib/setup.js'; export default async function(input){return setup(input);}"};
 const setup=await call<{result?:{ready?:boolean;username?:string}}>('/run','POST',{module:'handlers/message',sources:setupSources,args:{bridgeSecret},ctx:{}});
 if(!setup.result?.ready||!setup.result.username)throw new TelegramSetupError('Код бота загружен, но связь с сайтом не подтверждена. Повторите подключение.');
 await call('/webhook/sync','POST',{});
 const webhook=await call<{in_sync?:boolean}>('/webhook');
 if(!webhook.in_sync)throw new TelegramSetupError('Код загружен, но обработчик Telegram ещё не активен. Повторите подключение.');
 return {username:setup.result.username,appId};
}

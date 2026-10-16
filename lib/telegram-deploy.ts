import {telegramSources} from './telegram-sources';
export class TelegramSetupError extends Error {
 constructor(message:string,public status?:number,public phase?:string){super(message);}
}
type Change={status:string;kind:string;table:string;column?:string;index?:string};
type State={revision:number;canonical_modules?:Record<string,string>;static?:unknown};
type Migration={db_changes:Change[]};
type Webhook={in_sync?:boolean};
export async function deployTelegramBot(rawToken:string,bridgeSecret:string,transport:typeof fetch=fetch){
 const token=rawToken.trim();
 if(!/^app\d+:[A-Za-z0-9_-]{1,400}$/.test(token))throw new TelegramSetupError('Нужен CLI Access token вида app123:… из раздела Serverless. Обычный API-токен не подходит.');
 if(bridgeSecret.length<32)throw new TelegramSetupError('Серверный ключ связи с ботом не настроен.');
 const appId=token.split(':')[0],base='https://cloud.telegram.org/'+appId+'/manage';
 async function call<T>(path:string,method='GET',body?:object,allowEmpty=false):Promise<T>{
  let response:Response;
  // Workers supports only manual/follow redirects. Reject 3xx ourselves so the
  // bearer credential never follows a Location header to another destination.
  try{response=await transport(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'List-Serverless-Setup/1.0'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw new TelegramSetupError('Не удалось связаться с Telegram Serverless. Попробуйте ещё раз.');}
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new TelegramSetupError('Telegram вернул перенаправление. Подключение остановлено; токен не отправлен на другой адрес.');}
  if(response.status===401||response.status===403)throw new TelegramSetupError('Telegram не принял CLI-токен. Проверьте его и включите Serverless в BotFather.');
  if(response.status===409)throw new TelegramSetupError('Бот изменён в другом окне. Обновите страницу и повторите подключение.');
  const reader=response.body?.getReader();if(!reader)throw new TelegramSetupError('Telegram вернул пустой ответ.');
  const decoder=new TextDecoder();let text='',bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw new TelegramSetupError('Проект этого бота слишком большой для автоматического подключения. Выберите отдельного бота.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch(error){if(error instanceof TelegramSetupError)throw error;throw new TelegramSetupError('Ответ Telegram прерван. Повторите подключение.');}
  let data:{ok?:boolean;result?:T};try{data=JSON.parse(text);}catch{throw new TelegramSetupError('Telegram Serverless временно вернул некорректный ответ.');}
  if(!response.ok||data.ok!==true||(!allowEmpty&&data.result===undefined))throw new TelegramSetupError('Telegram не выполнил шаг '+path+' (HTTP '+response.status+'). Повторите подключение; уже загруженный код и данные сохранятся.',response.status,path);
  return data.result as T;
 }
 const remote=await call<State>('/get');
 if(!Number.isSafeInteger(remote.revision))throw new TelegramSetupError('Не удалось проверить версию проекта Telegram.');
 const modules=remote.canonical_modules||{};
 if(remote.static||Object.entries(modules).some(([name,source])=>!telegramSources[name]||source.trim().replaceAll('\r\n','\n')!==telegramSources[name].trim().replaceAll('\r\n','\n')))throw new TelegramSetupError('В этом боте уже есть другой проект. Его код не изменён. Создайте отдельного бота для Листа.');
 function safeChanges(result:Migration){
  if(!Array.isArray(result?.db_changes))throw new TelegramSetupError('Telegram не подтвердил состояние таблиц. Настройка остановлена до запуска бота.');
  if(result.db_changes.some(c=>c.status!=='good'||!['create_table','create_column','create_index'].includes(c.kind)||typeof c.table!=='string'))throw new TelegramSetupError('База бота содержит несовместимые данные. Опасные изменения не применены. Используйте отдельного бота.');
  return result.db_changes;
 }
 safeChanges(await call<Migration>('/migrate','POST',{schema:telegramSources.schema,dry_run:true}));
 await call('/deploy','POST',{expected_revision:remote.revision,manifest:Object.keys(telegramSources),changed_sources:telegramSources});
 // Apply the deployed schema, then verify the live database, rather than
 // assuming a successful dry-run or code deploy has created the tables.
 const changes=safeChanges(await call<Migration>('/migrate'));
 if(changes.length)await call('/migrate','POST',{apply:changes.map(c=>c.kind+':'+c.table+(c.column?'.'+c.column:c.index?'.'+c.index:''))});
 if(safeChanges(await call<Migration>('/migrate')).length)throw new TelegramSetupError('Telegram ещё не создал таблицы settings и users. Код сохранён. Повторите подключение для завершения миграции.');
 const setupSources={...telegramSources,'handlers/message':"import setup from '../lib/setup.js'; export default async function(input){return setup(input);}"};
 const setup=await call<{result?:{ready?:boolean;username?:string}}>('/run','POST',{module:'handlers/message',sources:setupSources,args:{bridgeSecret},ctx:{}});
 if(!setup.result?.ready||!setup.result.username)throw new TelegramSetupError('Код бота загружен, но связь с сайтом не подтверждена. Повторите подключение.');
 const verifySources={...telegramSources,'handlers/message':"import {db} from 'sdk'; export default async function(input){const config=await db.get('SELECT value FROM settings WHERE key=:key',{':key':'bridge_secret'});await db.get('SELECT count(*) AS count FROM users');return {ready:config?.value===input.bridgeSecret};}"};
 const verified=await call<{result?:{ready?:boolean}}>('/run','POST',{module:'handlers/message',sources:verifySources,args:{bridgeSecret},ctx:{}});
 if(!verified.result?.ready)throw new TelegramSetupError('Telegram не подтвердил сохранение настроек бота. Повторите подключение.');
 // BotFather may already have installed the right webhook. A redundant sync
 // can fail even though updates are enabled; the read-back is authoritative.
 let webhook=await call<Webhook>('/webhook');
 for(let attempt=0;!webhook.in_sync&&attempt<2;attempt++){
  let failure:unknown;
  try{await call('/webhook/sync','POST',{},true);}catch(error){failure=error;}
  webhook=await call<Webhook>('/webhook');
  if(!webhook.in_sync&&failure){
   if(!(failure instanceof TelegramSetupError)||failure.status===undefined||failure.status<500)throw failure;
   if(attempt===1)throw failure;
  }
 }
 if(!webhook.in_sync)throw new TelegramSetupError('Таблицы и код готовы, но Telegram не включил доставку сообщений. Откройте Serverless → Handlers в BotFather и повторите подключение.');
 return {username:setup.result.username,appId};
}

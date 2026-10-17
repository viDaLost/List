import {Buffer} from 'node:buffer';
import {sql,HttpError} from './server';
import {type AuthorRecord,randomKey,hashKey} from './browser-access';
// Official production public key: core.telegram.org/bots/webapps#validating-data-for-third-party-use
export const TELEGRAM_PUBLIC_KEY='e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
export async function verifyTelegramData(raw:string,botId:string,now=Date.now(),publicKey=TELEGRAM_PUBLIC_KEY){
 const invalid=()=>new HttpError(401,'Откройте редактор кнопкой в Telegram-боте. Данные Telegram не подтверждены.');
 if(typeof raw!=='string'||raw.length>8192||!raw||!/^\d{1,16}$/.test(botId))throw invalid();
 const data=new URLSearchParams(raw),seen=new Set<string>();
 for(const [key] of data){if(seen.has(key))throw invalid();seen.add(key);}
 const authDate=Number(data.get('auth_date')),signature=data.get('signature')||'';
 if(!Number.isSafeInteger(authDate)||authDate*1000<now-86400000||authDate*1000>now+60000||!/^[A-Za-z0-9_-]{86}={0,2}$/.test(signature))throw invalid();
 const pairs=[...data].filter(([key])=>!['hash','signature'].includes(key)).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>key+'='+value);
 const check=botId+':WebAppData\n'+pairs.join('\n');
 let valid=false;
 try{const key=await crypto.subtle.importKey('raw',new Uint8Array(Buffer.from(publicKey,'hex')),{name:'Ed25519'},false,['verify']);valid=await crypto.subtle.verify('Ed25519',key,new Uint8Array(Buffer.from(signature,'base64url')),new TextEncoder().encode(check));}catch{}
 if(!valid)throw invalid();
 let user;try{user=JSON.parse(data.get('user')||'');}catch{throw invalid();}
 if(!Number.isSafeInteger(user?.id)||user.id<=0||user.is_bot)throw invalid();
 return String(user.id);
}
export async function telegramAuthor(telegramId:string):Promise<AuthorRecord>{
 if(!/^[1-9][0-9]{0,15}$/.test(telegramId))throw new HttpError(400,'Неверные данные Telegram.');
 await sql().prepare('INSERT INTO authors (id,telegram_id,is_admin,created_at) VALUES (?,?,0,?) ON CONFLICT(telegram_id) DO NOTHING').bind(crypto.randomUUID(),telegramId,Date.now()).run();
 return (await sql().prepare('SELECT id,is_admin,telegram_id FROM authors WHERE telegram_id=?').bind(telegramId).first<AuthorRecord>())!;
}
export async function telegramSession(author:AuthorRecord){
 const key=randomKey(),now=Date.now();
 await sql().batch([sql().prepare('INSERT INTO access_keys (key_hash,author_id,created_at) VALUES (?,?,?)').bind(await hashKey(key),author.id,now),sql().prepare("DELETE FROM access_keys WHERE author_id=? AND key_hash NOT LIKE 'owner:%' AND key_hash NOT IN (SELECT key_hash FROM access_keys WHERE author_id=? AND key_hash NOT LIKE 'owner:%' ORDER BY created_at DESC,rowid DESC LIMIT 20)").bind(author.id,author.id)]);
 return key;
}

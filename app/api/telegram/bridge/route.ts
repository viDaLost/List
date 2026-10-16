import {env} from 'cloudflare:workers';
import {timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {endpoint,sql,HttpError,ownedArticle} from '@/lib/server';
import {telegramAuthor} from '@/lib/telegram-identity';
import {rateLimit,backupArticle,audit} from '@/lib/operations';
export async function POST(request:Request){return endpoint(async()=>{
 const expected=env.TELEGRAM_BRIDGE_SECRET||'',actual=request.headers.get('x-list-bridge')||'';
 const a=Buffer.from(actual),b=Buffer.from(expected);
 if(expected.length<32||a.length!==b.length||!timingSafeEqual(a,b))throw new HttpError(403,'Forbidden');
 const raw=await request.text();if(raw.length>8000)throw new HttpError(413,'Payload too large');let body;
 try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{throw new HttpError(400,'Invalid JSON');}
 if(body.action==='configure'){
  if(!/^[A-Za-z0-9_]{5,32}$/.test(body.username))throw new HttpError(400,'Invalid bot username');
  if(body.botId!==undefined&&(!Number.isSafeInteger(body.botId)||body.botId<=0))throw new HttpError(400,'Invalid bot ID');
  const statements=[sql().prepare("INSERT INTO settings (key,value) VALUES ('telegram_username',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(body.username)];
  if(body.botId)statements.push(sql().prepare("INSERT INTO settings (key,value) VALUES ('telegram_bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(body.botId)));
  await sql().batch(statements);return Response.json({ok:true});
 }
 if(!['start','articles','article','delete'].includes(body.action))throw new HttpError(400,'Откройте обновлённое меню бота командой /start. Привязка по ключам больше не используется.');
 const tg=String(body.telegramId||'');if(!/^[1-9][0-9]{0,15}$/.test(tg))throw new HttpError(400,'Invalid user');
 await rateLimit('tg-bridge:'+tg,30,60000);
 const author=await telegramAuthor(tg);
 if(body.action==='start')return Response.json({authorId:author.id},{headers:{'Cache-Control':'private, no-store'}});
 if(body.action==='articles'){
  const articles=await sql().prepare('SELECT id,title,slug,published,version FROM articles WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').bind(author.id).all();
  return Response.json({authorId:author.id,articles:articles.results},{headers:{'Cache-Control':'private, no-store'}});
 }
 if(typeof body.articleId!=='string')throw new HttpError(400,'Неверная статья.');
 const article=await ownedArticle(body.articleId,author.id);
 if(body.action==='article')return Response.json({article:{id:article.id,title:article.title,published:!!article.published,version:article.version}},{headers:{'Cache-Control':'private, no-store'}});
 if(!Number.isInteger(body.version)||body.version!==article.version)throw new HttpError(409,'Статья изменилась. Выберите её заново перед удалением.');
 await rateLimit('tg-delete:'+author.id,20,60000);await backupArticle(article,'telegram-delete');
 const result=await sql().prepare('DELETE FROM articles WHERE id=? AND owner_id=? AND version=?').bind(article.id,author.id,body.version).run();
 if(!result.meta.changes)throw new HttpError(409,'Статья изменилась. Обновите список.');
 await audit(author.id,'telegram-delete',article.id);
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});
});}

import {env} from 'cloudflare:workers';
import {legacyObject} from './object-storage';
import {sql,HttpError} from './server';
import {hashKey} from './browser-access';

async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function storageStatus(){
  const legacy=await sql().prepare('SELECT COUNT(DISTINCT object_key) objects,COUNT(*) chunks,COALESCE(SUM(length(data)),0) encodedBytes FROM object_chunks').first();
  const transferred=await sql().prepare('SELECT COUNT(*) objects,COALESCE(SUM(bytes),0) bytes FROM object_transfers').first();
  return {r2:!!env.BUCKET,legacy,transferred};
}
export async function transferObject(key:string,clean=false){
  const bucket=env.BUCKET;if(!bucket)throw new HttpError(503,'Хранилище R2 не подключено.');
  const source=await legacyObject(key);
  if(!source)return {skipped:true};
  const sha=await digest(source.data);
  if(!clean){
    const existing=await bucket.head(key);
    // Never overwrite a new R2 object with a different legacy copy.
    if(existing){
      if(existing.size!==source.data.length)throw new HttpError(409,'Копии файла различаются. Перенос остановлен.');
    }else await bucket.put(key,source.data,{sha256:sha,httpMetadata:{contentType:source.mime},customMetadata:{migrationSha256:sha}});
  }
  const destination=await bucket.get(key);
  if(!destination||destination.size!==source.data.length||destination.size>9*1024*1024)throw new HttpError(409,'Размер перенесённого файла не подтверждён.');
  const copied=await digest(new Uint8Array(await destination.arrayBuffer()));
  if(copied!==sha)throw new HttpError(409,'Проверка целостности файла не пройдена. Исходные данные сохранены.');
  if(clean){
    const record=await sql().prepare('SELECT sha256 FROM object_transfers WHERE object_key=?').bind(key).first<{sha256:string}>();
    if(record?.sha256!==sha)throw new HttpError(409,'Нет подтверждения предыдущего копирования.');
    const latest=await legacyObject(key);
    if(!latest||await digest(latest.data)!==sha)throw new HttpError(409,'Исходный файл изменился. Повторите перенос.');
    await sql().batch([
      sql().prepare('DELETE FROM object_chunks WHERE object_key=?').bind(key),
      sql().prepare('UPDATE object_transfers SET cleaned_at=? WHERE object_key=? AND sha256=?').bind(Date.now(),key,sha),
    ]);
  }else await sql().prepare('INSERT INTO object_transfers (object_key,sha256,bytes,verified_at) VALUES (?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET sha256=excluded.sha256,bytes=excluded.bytes,verified_at=excluded.verified_at').bind(key,sha,source.data.length,Date.now()).run();
  return {verified:true,bytes:source.data.length,fingerprint:(await hashKey(key)).slice(0,12),cleaned:clean};
}
export async function transferBatch(cursor:string,clean:boolean){
  const batch=await sql().prepare('SELECT DISTINCT object_key FROM object_chunks WHERE object_key>? ORDER BY object_key LIMIT 1').bind(cursor).all<{object_key:string}>();
  const key=batch.results[0]?.object_key;
  if(!key)return {done:true,cursor,results:[]};
  return {done:false,cursor:key,results:[await transferObject(key,clean)]};
}

import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";

// R2 is preferred when enabled. D1 chunks keep uploads and private snapshots
// available on accounts which have not activated R2 billing.
export async function legacyObject(key:string, db=env.DB) {
  if(!db)return null;
  const size=await db.prepare('SELECT COALESCE(SUM(length(data)),0) AS bytes FROM object_chunks WHERE object_key=?').bind(key).first<{bytes:number}>();
  if(!size?.bytes)return null;
  if(size.bytes>12*1024*1024)throw new Error('Legacy object exceeds the migration memory limit');
  const result=await db.prepare('SELECT data,mime FROM object_chunks WHERE object_key=? ORDER BY part').bind(key).all<{data:string;mime:string}>();
  if(!result.results.length)return null;
  const data=Buffer.concat(result.results.map(row=>Buffer.from(row.data,'base64')));
  return {data,mime:result.results[0].mime,parts:result.results.length};
}
export function objectStorage() {
  const db = env.DB;
  if (!db) throw new Error("Object storage is unavailable");
  return {
    async put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      if(env.BUCKET){await env.BUCKET.put(key,value,options);return;}
      const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
      const batch = [db.prepare("DELETE FROM object_chunks WHERE object_key=?").bind(key)];
      const mime = options?.httpMetadata?.contentType || "application/octet-stream";
      for (let i = 0; i < data.length || i === 0; i += 384000) {
        batch.push(db.prepare("INSERT INTO object_chunks (object_key, part, data, mime) VALUES (?, ?, ?, ?)").bind(key, i / 384000, Buffer.from(data.slice(i, i + 384000)).toString("base64"), mime));
      }
      await db.batch(batch);
    },
    async delete(key: string) {
      if(env.BUCKET)await env.BUCKET.delete(key);
      await db.prepare("DELETE FROM object_chunks WHERE object_key=?").bind(key).run();
      await db.prepare('DELETE FROM object_transfers WHERE object_key=?').bind(key).run();
    },
    async get(key: string) {
      if(env.BUCKET){const object=await env.BUCKET.get(key);if(object)return object;}
      const legacy=await legacyObject(key,db);
      if(!legacy)return null;
      const {data,mime}=legacy;
      return {
        body: data, size:data.length,httpEtag: '"' + key.split("/").pop() + '"',
        async json<T>(): Promise<T> { return JSON.parse(data.toString("utf8")); },
        writeHttpMetadata(headers: Headers) { headers.set("Content-Type", mime); },
      };
    },
  };
}

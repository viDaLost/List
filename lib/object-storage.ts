import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";

// R2 is preferred when enabled. D1 chunks keep uploads and private snapshots
// available on accounts which have not activated R2 billing.
export function objectStorage() {
  if (env.BUCKET) return env.BUCKET;
  const db = env.DB;
  if (!db) throw new Error("Object storage is unavailable");
  return {
    async put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
      const batch = [db.prepare("DELETE FROM object_chunks WHERE object_key=?").bind(key)];
      const mime = options?.httpMetadata?.contentType || "application/octet-stream";
      for (let i = 0; i < data.length || i === 0; i += 384000) {
        batch.push(db.prepare("INSERT INTO object_chunks (object_key, part, data, mime) VALUES (?, ?, ?, ?)").bind(key, i / 384000, Buffer.from(data.slice(i, i + 384000)).toString("base64"), mime));
      }
      await db.batch(batch);
    },
    async delete(key: string) { await db.prepare("DELETE FROM object_chunks WHERE object_key=?").bind(key).run(); },
    async get(key: string) {
      const result = await db.prepare("SELECT data, mime FROM object_chunks WHERE object_key=? ORDER BY part").bind(key).all<{ data: string; mime: string }>();
      if (!result.results.length) return null;
      const data = Buffer.concat(result.results.map(row => Buffer.from(row.data, "base64")));
      return {
        body: data, httpEtag: '"' + key.split("/").pop() + '"',
        async json<T>(): Promise<T> { return JSON.parse(data.toString("utf8")); },
        writeHttpMetadata(headers: Headers) { headers.set("Content-Type", result.results[0].mime); },
      };
    },
  };
}

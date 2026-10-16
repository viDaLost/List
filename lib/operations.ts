import { env } from "cloudflare:workers";
import { objectStorage } from "./object-storage";
import { author, sql, HttpError, type ArticleRow } from "./server";
export const REPORT_REASONS: Record<string, string> = {
  spam: "Спам или обман", harmful: "Опасный или оскорбительный контент", rights: "Нарушение авторских прав", other: "Другое",
};
export function isAdminUser(user: { isAdmin?: boolean } | null): boolean { return user?.isAdmin === true; }
export async function admin() {
  const user = await author();
  if (!isAdminUser(user)) throw new HttpError(403, "Этот раздел доступен только владельцу сервиса.");
  return user;
}
export async function rateLimit(key: string, limit: number, period: number) {
  const now = Date.now(), cutoff = now - period;
  const result = await sql().prepare("INSERT INTO request_limits (key, starts_at, hits) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN request_limits.starts_at<=? THEN 1 ELSE request_limits.hits+1 END, starts_at=CASE WHEN request_limits.starts_at<=? THEN excluded.starts_at ELSE request_limits.starts_at END RETURNING hits, starts_at").bind(key, now, cutoff, cutoff).first<{ hits: number; starts_at: number }>();
  if (result && result.hits > limit) throw new HttpError(429, "Слишком много действий подряд. Немного подождите и попробуйте снова.", Math.max(1, Math.ceil((result.starts_at + period - now) / 1000)));
}
export async function audit(actorId: string, action: string, articleId: string | null, details = "") {
  await sql().prepare("INSERT INTO audit_log (id, actor_id, article_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorId, articleId, action, details.slice(0,1000), Date.now()).run();
}
export async function backupArticle(article: ArticleRow, action: string) {
  const storage = objectStorage();
  const id = crypto.randomUUID(), now = Date.now(), key = "backups/" + article.id + "/" + id + ".json";
  const paths = await sql().prepare("SELECT slug FROM paths WHERE article_id=?").bind(article.id).all<{ slug: string }>();
  await storage.put(key, JSON.stringify({ format: 1, article, paths: paths.results.map((p) => p.slug), createdAt: now }), { httpMetadata: { contentType: "application/json" } });
  try {
    await sql().prepare("INSERT INTO backups (id, article_id, owner_id, title, object_key, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, article.id, article.owner_id, article.title, key, action, now).run();
  } catch (e) { await storage.delete(key); throw e; }
  // Retain the last ten recoverable versions of each article.
  try {
    const old = await sql().prepare("SELECT id, object_key FROM backups WHERE article_id=? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 10").bind(article.id).all<{ id: string; object_key: string }>();
    for (const entry of old.results) { await storage.delete(entry.object_key); await sql().prepare("DELETE FROM backups WHERE id=?").bind(entry.id).run(); }
  } catch { console.error("Backup retention cleanup will be retried on the next save"); }
}

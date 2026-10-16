import { admin, audit, backupArticle, rateLimit } from "@/lib/operations";
import { endpoint, sql, readBody, HttpError, type ArticleRow } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    await admin();
    const db = sql();
    const [counts, articles, reports, backups] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(published),0) AS published, COALESCE(SUM(moderation_blocked),0) AS blocked FROM articles").first(),
      db.prepare("SELECT id,title,author,slug,published,moderation_blocked,moderation_reason,updated_at FROM articles WHERE published=1 OR moderation_blocked=1 ORDER BY updated_at DESC LIMIT 100").all(),
      db.prepare("SELECT id,article_id,article_title,article_slug,reason,details,status,created_at FROM reports ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100").all(),
      db.prepare("SELECT id,article_id,title,action,created_at FROM backups ORDER BY created_at DESC, rowid DESC LIMIT 100").all(),
    ]);
    return Response.json({ counts, articles: articles.results, reports: reports.results, backups: backups.results }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await admin(), body = await readBody(request);
    await rateLimit("admin:" + user.userId, 40, 60000);
    if (body.action === "resolve" || body.action === "dismiss") {
      if (typeof body.reportId !== "string") throw new HttpError(400, "Не выбрана жалоба.");
      const changed = await sql().prepare("UPDATE reports SET status=?, resolved_at=? WHERE id=? AND status='open'").bind(body.action === "resolve" ? "resolved" : "dismissed", Date.now(), body.reportId).run();
      if (!changed.meta.changes) throw new HttpError(404, "Открытая жалоба не найдена.");
      await audit(user.userId, body.action, null, body.reportId);
      return Response.json({ ok: true });
    }
    if (!["block", "unblock"].includes(body.action) || typeof body.articleId !== "string") throw new HttpError(400, "Неизвестное действие.");
    const article = await sql().prepare("SELECT * FROM articles WHERE id=?").bind(body.articleId).first<ArticleRow>();
    if (!article) throw new HttpError(404, "Статья не найдена.");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0,500) : "";
    if (body.action === "block" && !reason) throw new HttpError(400, "Укажите причину снятия с публикации.");
    await backupArticle(article, body.action);
    const result = await sql().prepare("UPDATE articles SET published=0, moderation_blocked=?, moderation_reason=?, version=version+1, updated_at=? WHERE id=? AND version=?").bind(body.action === "block" ? 1 : 0, body.action === "block" ? reason : "", Date.now(), article.id, article.version).run();
    if (!result.meta.changes) throw new HttpError(409, "Статья изменилась. Обновите список.");
    await audit(user.userId, body.action, article.id, reason);
    return Response.json({ ok: true });
  });
}

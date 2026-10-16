import { author, endpoint, sql, readBody, HttpError, type ArticleRow } from "@/lib/server";
import { REPORT_REASONS, rateLimit } from "@/lib/operations";
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await author(), body = await readBody(request);
    if (typeof body.website === "string" && body.website) return Response.json({ ok: true });
    if (typeof body.articleId !== "string" || !Object.hasOwn(REPORT_REASONS, body.reason)) throw new HttpError(400, "Выберите причину жалобы.");
    if (typeof body.details !== "string" || body.details.length > 1500) throw new HttpError(400, "Комментарий должен быть короче 1500 символов.");
    await rateLimit("report:minute:" + user.userId, 3, 60000);
    await rateLimit("report:day:" + user.userId, 15, 86400000);
    const article = await sql().prepare("SELECT * FROM articles WHERE id=? AND published=1 AND moderation_blocked=0").bind(body.articleId).first<ArticleRow>();
    if (!article) throw new HttpError(404, "Опубликованная статья не найдена.");
    const existing = await sql().prepare("SELECT id FROM reports WHERE article_id=? AND reporter_id=? AND status='open'").bind(article.id, user.userId).first();
    if (existing) return Response.json({ ok: true, duplicate: true });
    await sql().prepare("INSERT INTO reports (id, article_id, article_title, article_slug, reporter_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), article.id, article.title, article.slug, user.userId, body.reason, body.details.trim(), Date.now()).run();
    return Response.json({ ok: true }, { status: 201 });
  });
}

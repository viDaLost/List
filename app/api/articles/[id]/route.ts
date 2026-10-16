import { normalizeArticle } from "@/lib/article";
import { author, endpoint, sql, readBody, articleValues, ownedArticle, HttpError, checkOrigin, fromRow } from "@/lib/server";
import { backupArticle, rateLimit } from "@/lib/operations";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  return endpoint(async () => {
    const user = await author(), { id } = await context.params, current = await ownedArticle(id, user.userId);
    const body = await readBody(request);
    if (body.version !== current.version) throw new HttpError(409, "Эта статья уже изменена в другом окне. Скопируйте свой текст и откройте статью заново.");
    const article = normalizeArticle(body), now = Date.now();
    if (current.moderation_blocked && article.published) throw new HttpError(403, "Статья снята модератором: " + (current.moderation_reason || "проверьте содержание") + ". Можно сохранить изменения как черновик.");
    await rateLimit("edit:" + user.userId, 40, 60000);
    const conflict = await sql().prepare("SELECT article_id FROM paths WHERE slug = ?").bind(article.slug).first<{ article_id: string }>();
    if (conflict && conflict.article_id !== id) throw new HttpError(409, "Этот адрес уже занят. Выберите другой.");
    await backupArticle(current, "edit");
    const results = await sql().batch([
      sql().prepare("INSERT INTO paths (slug, article_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id=? AND owner_id=? AND version=?) ON CONFLICT(slug) DO NOTHING").bind(article.slug, id, now, id, user.userId, current.version),
      sql().prepare("UPDATE articles SET title=?, author=?, subtitle=?, slug=?, blocks=?, cover=?, theme=?, font=?, accent=?, alignment=?, wide=?, share_title=?, share_description=?, share_image=?, published=?, updated_at=?, version=version+1 WHERE id=? AND owner_id=? AND version=? AND EXISTS (SELECT 1 FROM paths WHERE slug=? AND article_id=articles.id)").bind(...articleValues(article), now, id, user.userId, current.version, article.slug),
    ]);
    if (!results[1].meta.changes) throw new HttpError(409, "Статья была изменена в другом окне. Откройте её заново.");
    return Response.json({ article: { ...fromRow(current), ...article, updatedAt: now, version: current.version + 1 } });
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    checkOrigin(request);
    const user = await author(), { id } = await context.params;
    const current = await ownedArticle(id, user.userId);
    await rateLimit("delete:" + user.userId, 20, 60000);
    await backupArticle(current, "delete");
    await sql().prepare("DELETE FROM articles WHERE id=? AND owner_id=?").bind(id, user.userId).run();
    return Response.json({ ok: true });
  });
}

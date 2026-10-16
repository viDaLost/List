import { normalizeArticle } from "@/lib/article";
import { author, endpoint, sql, readBody, articleValues, fromRow, type ArticleRow, HttpError } from "@/lib/server";
import { rateLimit } from "@/lib/operations";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    const user = await author();
    const { results } = await sql().prepare("SELECT * FROM articles WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100").bind(user.userId).all<ArticleRow>();
    return Response.json({ articles: results.map(fromRow) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await author(), article = normalizeArticle(await readBody(request));
    await rateLimit("create:minute:" + user.userId, 10, 60000);
    await rateLimit("create:day:" + user.userId, 50, 86400000);
    const count = await sql().prepare("SELECT COUNT(*) AS n FROM articles WHERE owner_id = ?").bind(user.userId).first<{ n: number }>();
    if ((count?.n ?? 0) >= 100) throw new HttpError(429, "В первой версии можно сохранить до 100 статей.");
    const id = crypto.randomUUID(), now = Date.now();
    await sql().batch([
      sql().prepare("INSERT INTO articles (id, owner_id, title, author, subtitle, slug, blocks, cover, theme, font, accent, alignment, wide, share_title, share_description, share_image, published, appearance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.userId, ...articleValues(article), now, now),
      sql().prepare("INSERT INTO paths (slug, article_id, created_at) VALUES (?, ?, ?)").bind(article.slug, id, now),
    ]);
    return Response.json({ article: { ...article, id, views: 0, version: 1, createdAt: now, updatedAt: now } }, { status: 201 });
  });
}

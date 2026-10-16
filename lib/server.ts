import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { type Article, InputError } from "./article";
export class HttpError extends Error { constructor(public status: number, message: string, public retryAfter?: number) { super(message); } }
export function sql() { if (!env.DB) throw new HttpError(503, "Хранилище временно недоступно."); return env.DB; }
export async function author() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, "Войдите, чтобы сохранить статью и открывать её на других устройствах.");
  return user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Запрос с другого сайта запрещён.");
}
export async function readBody(request: Request) {
  checkOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "Ожидается JSON.");
  const body = await request.text();
  if (body.length > 260000) throw new HttpError(413, "Статья слишком большая.");
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid object");
    return parsed;
  } catch { throw new HttpError(400, "Не удалось прочитать данные."); }
}
export async function endpoint(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store", ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
    if (e instanceof InputError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof Error && /UNIQUE constraint failed.*paths.slug/i.test(e.message)) return Response.json({ error: "Этот адрес уже занят. Выберите другой." }, { status: 409 });
    console.error("Article operation failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "Не удалось выполнить действие. Попробуйте ещё раз." }, { status: 500 });
  }
}
export type ArticleRow = {
  id: string; owner_id: string; title: string; author: string; subtitle: string; slug: string; blocks: string; cover: string;
  theme: Article["theme"]; font: Article["font"]; accent: string; alignment: Article["alignment"]; wide: number;
  share_title: string; share_description: string; share_image: string; published: number; views: number; version: number; created_at: number; updated_at: number;
  moderation_blocked: number; moderation_reason: string;
};
export function fromRow(r: ArticleRow): Article {
  return { id: r.id, title: r.title, author: r.author, subtitle: r.subtitle, slug: r.slug, blocks: JSON.parse(r.blocks), cover: r.cover, theme: r.theme, font: r.font, accent: r.accent, alignment: r.alignment, wide: !!r.wide, shareTitle: r.share_title, shareDescription: r.share_description, shareImage: r.share_image, published: !!r.published, views: r.views, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, blocked: !!r.moderation_blocked, blockedReason: r.moderation_reason || "" };
}
export function articleValues(a: Article) { return [a.title, a.author, a.subtitle, a.slug, JSON.stringify(a.blocks), a.cover, a.theme, a.font, a.accent, a.alignment, Number(a.wide), a.shareTitle, a.shareDescription, a.shareImage, Number(a.published)]; }
export async function ownedArticle(id: string, ownerId: string): Promise<ArticleRow> {
  const row = await sql().prepare("SELECT * FROM articles WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<ArticleRow>();
  if (!row) throw new HttpError(404, "Статья не найдена.");
  return row;
}
export async function publishedArticle(slug: string): Promise<Article | null> {
  const row = await sql().prepare("SELECT a.* FROM paths p JOIN articles a ON a.id = p.article_id WHERE p.slug = ? AND a.published = 1 AND a.moderation_blocked = 0").bind(slug).first<ArticleRow>();
  return row ? fromRow(row) : null;
}

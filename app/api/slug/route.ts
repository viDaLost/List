import { normalizeSlug } from "@/lib/article";
import { endpoint, author, sql } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(async () => {
    const user = await author(), url = new URL(request.url), slug = normalizeSlug(url.searchParams.get("path") || "");
    const row = await sql().prepare("SELECT p.article_id, a.owner_id FROM paths p JOIN articles a ON a.id=p.article_id WHERE p.slug=?").bind(slug).first<{ article_id: string; owner_id: string }>();
    return Response.json({ slug, available: !row || (row.article_id === url.searchParams.get("id") && row.owner_id === user.userId) }, { headers: { "Cache-Control": "no-store" } });
  });
}

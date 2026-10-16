import { sql, endpoint, checkOrigin } from "@/lib/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    checkOrigin(request);
    const { id } = await params;
    await sql().prepare("UPDATE articles SET views=MIN(views+1, 100000000) WHERE id=? AND published=1 AND moderation_blocked=0").bind(id).run();
    return Response.json({ ok: true });
  });
}

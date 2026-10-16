import { env } from "cloudflare:workers";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id) || !env.BUCKET) return new Response("Not found", { status: 404 });
  const object = await env.BUCKET.get(id);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

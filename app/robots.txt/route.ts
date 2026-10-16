export function GET() {
  return new Response("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /_list/admin\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

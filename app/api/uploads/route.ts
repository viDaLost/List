import { objectStorage } from "@/lib/object-storage";
import { author, endpoint, sql, HttpError, checkOrigin } from "@/lib/server";
import { rateLimit } from "@/lib/operations";
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const user = await author();
    await rateLimit("upload:minute:" + user.userId, 10, 60000);
    await rateLimit("upload:day:" + user.userId, 100, 86400000);
    const storage = objectStorage();
    if (Number(request.headers.get("content-length") || 0) > 9 * 1024 * 1024) throw new HttpError(413, "Максимальный размер изображения — 8 МБ.");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Выберите изображение.");
    if (!file.size || file.size > 8 * 1024 * 1024) throw new HttpError(413, "Максимальный размер изображения — 8 МБ.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime = "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = "image/jpeg";
    else if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) mime = "image/png";
    else if (new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") mime = "image/webp";
    else if (/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6)))) mime = "image/gif";
    if (!mime) throw new HttpError(400, "Поддерживаются JPG, PNG, WebP и GIF.");
    const usage = await sql().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM uploads WHERE owner_id=?").bind(user.userId).first<{ n: number; bytes: number }>();
    if ((usage?.n ?? 0) >= 300 || (usage?.bytes ?? 0) + bytes.length > 200 * 1024 * 1024) throw new HttpError(429, "Достигнут лимит изображений первой версии.");
    const id = crypto.randomUUID();
    await storage.put(id, bytes, { httpMetadata: { contentType: mime } });
    try { await sql().prepare("INSERT INTO uploads (id, owner_id, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, user.userId, mime, bytes.length, Date.now()).run(); }
    catch (e) { await storage.delete(id); throw e; }
    return Response.json({ url: "/media/" + id }, { status: 201 });
  });
}

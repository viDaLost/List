// A reproducible API deployment package for connectors without an asset-upload
// Authorization override. Standard Wrangler deployment uses native static assets.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
function files(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name), prefix + e.name + "/") : [prefix + e.name]);
}
const modules = files("dist/server").filter(f => /\.(m?js)$/.test(f)).map(name => ({ name, content: readFileSync("dist/server/" + name, "utf8"), type: "application/javascript+module" }));
const mime = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const assets = Object.fromEntries(files("dist/client").filter(f => !f.startsWith(".") && !f.startsWith("_") || f.startsWith("_next/")).filter(f => f !== "_headers").map(f => ["/" + f, { data: readFileSync("dist/client/" + f).toString("base64"), mime: mime[path.extname(f)] || "application/octet-stream" }]));
modules.push({ name: "static-assets.js", type: "application/javascript+module", content: "export default " + JSON.stringify(assets) + ";\n" });
modules.push({ name: "entry.js", type: "application/javascript+module", content: `import app from './index.js';
import assets from './static-assets.js';
import { Buffer } from 'node:buffer';
export default { async fetch(request,env,ctx) {
  const pathname = new URL(request.url).pathname;
  const asset = assets[pathname];
  if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
    const headers = {'Content-Type':asset.mime,'X-Content-Type-Options':'nosniff','Cache-Control': pathname.startsWith('/_next/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'};
    return new Response(request.method === 'HEAD' ? null : Buffer.from(asset.data,'base64'),{headers});
  }
  const response = await app.fetch(request,env,ctx);
  const headers = new Headers(response.headers);
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','SAMEORIGIN');
  if (request.headers.has('Cookie') || response.headers.has('Set-Cookie') || pathname === '/' || pathname.startsWith('/api/') || pathname.startsWith('/_list/')) headers.set('Cache-Control','private, no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
} };` });
const output = process.argv[2];
if (!output) throw new Error("Provide an absolute output JSON path");
const payload=JSON.stringify(modules);
writeFileSync(output, output.endsWith(".gz") ? gzipSync(payload) : payload);
console.log(JSON.stringify({ modules: modules.length, assets: Object.keys(assets).length, compressedBytes: modules.reduce((n,m) => n + gzipSync(m.content).length, 0) }));

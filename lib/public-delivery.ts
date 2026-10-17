import {normalizeSlug} from './article';
import {objectStorage} from './object-storage';

type Context=Pick<ExecutionContext,'waitUntil'>;
type Render=(request:Request)=>Promise<Response>;
type PublishedMeta={id:string;slug:string;version:number;created_at:number;updated_at:number};
const pageLimit=8*1024*1024;
type EdgeCache={match(key:Request):Promise<Response|undefined>;put(key:Request,response:Response):Promise<void>};
function edgeCache(){return typeof caches==='undefined'?null:(caches as unknown as {default?:EdgeCache}).default??null;}
async function cacheMatch(cache:EdgeCache|null,key:Request){try{return await cache?.match(key);}catch{return undefined;}}
function background(ctx:Context,promise:Promise<unknown>){ctx.waitUntil(promise.catch(()=>{console.error('Public delivery cache operation failed');}));}
function internalKey(request:Request,key:string){return new Request(new URL('/_list/cache/'+key,new URL(request.url).origin));}
function clientResponse(request:Request,response:Response,label:string,html=false){
  const headers=new Headers(response.headers);headers.set('X-List-Cache',label);
  // HTML always revalidates visibility; only immutable versioned copies are cached.
  if(html){headers.set('Cache-Control','public, max-age=0, must-revalidate');headers.set('Vary','RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Url');}
  const unchanged=response.headers.get('ETag')&&request.headers.get('if-none-match')?.split(',').map(value=>value.trim()).includes(response.headers.get('ETag')!);
  if(unchanged||request.method==='HEAD'){
    void response.body?.cancel().catch(()=>{});
    return new Response(null,{status:unchanged?304:response.status,headers});
  }
  return new Response(response.body,{status:response.status,headers});
}
async function snapshotBytes(body:ReadableStream<Uint8Array>){
  // R2 requires a known-length body. Buffer only this bounded, infrequent
  // publication snapshot; normal readers and media remain streamed.
  let bytes=0;const chunks:Uint8Array[]=[],reader=body.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>pageLimit){void reader.cancel().catch(()=>{});throw new Error('Public page exceeds cache size limit');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}
async function mediaResponse(request:Request,ctx:Context,id:string){
  const cache=edgeCache(),key=internalKey(request,'media/'+id);
  const hit=await cacheMatch(cache,key);
  if(hit)return clientResponse(request,hit,'media-hit');
  const object=await objectStorage().get(id);
  if(!object)return new Response('Not found',{status:404});
  const headers=new Headers();object.writeHttpMetadata(headers);
  headers.set('Cache-Control','public, max-age=31536000, immutable');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Disposition','inline');headers.set('ETag',object.httpEtag);
  if(typeof object.size==='number')headers.set('Content-Length',String(object.size));
  const response=new Response(object.body,{headers});
  if(cache)background(ctx,cache.put(key,response.clone()));
  return clientResponse(request,response,'media-r2');
}
export async function publicDelivery(request:Request,environment:Cloudflare.Env,ctx:Context,render:Render):Promise<Response|null>{
  if(!['GET','HEAD'].includes(request.method))return null;
  const url=new URL(request.url),media=/^\/media\/([a-f0-9-]{36})$/.exec(url.pathname);
  if(media&&!request.headers.has('range'))return mediaResponse(request,ctx,media[1]);
  if(!environment.BUCKET||!environment.DB||url.pathname==='/'||url.search||request.headers.has('cookie')||request.headers.has('authorization')||request.headers.has('range'))return null;
  if([...request.headers.keys()].some(name=>name==='rsc'||name.startsWith('next-')||name==='x-list-context'))return null;
  if(request.headers.get('accept')&&!/text\/html|\*\/\*/i.test(request.headers.get('accept')!))return null;
  let slug:string,requested:string;
  try{requested=decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g,'');slug=normalizeSlug(requested);}catch{return null;}
  const meta=await environment.DB.prepare('SELECT a.id,a.slug,a.version,a.created_at,a.updated_at FROM paths p JOIN articles a ON a.id=p.article_id WHERE p.slug=? AND a.published=1 AND a.moderation_blocked=0').bind(slug).first<PublishedMeta>();
  if(!meta)return null;
  if(meta.slug!==requested)return new Response(null,{status:307,headers:{Location:'/'+meta.slug.split('/').map(encodeURIComponent).join('/'),'Cache-Control':'no-store'}});
  const configured='LIST_BUILD_ID' in environment&&typeof environment.LIST_BUILD_ID==='string'?environment.LIST_BUILD_ID:'public-v1';
  const build=configured.replace(/[^a-z0-9_-]/gi,'').slice(0,80)||'public-v1';
  const objectKey='rendered-pages/'+build+'/'+meta.id+'/'+meta.created_at+'-'+meta.version+'-'+meta.updated_at+'.html';
  const key=internalKey(request,objectKey),cache=edgeCache();
  const hit=await cacheMatch(cache,key);
  if(hit)return clientResponse(request,hit,'page-hit',true);
  try{
    const saved=await environment.BUCKET.get(objectKey);
    if(saved&&saved.size<=pageLimit){
      const response=new Response(saved.body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=604800',ETag:'"'+meta.id+'-'+meta.version+'-'+meta.updated_at+'-'+build+'"'}});
      if(cache)background(ctx,cache.put(key,response.clone()));
      return clientResponse(request,response,'page-r2',true);
    }
    if(saved)void saved.body.cancel().catch(()=>{});
  }catch{console.error('Public snapshot read failed; rendering current publication');}
  if(request.method==='HEAD')return null;
  // Only a canonical anonymous request may populate shared HTML. In particular,
  // untrusted internal/user headers cannot poison a later reader's snapshot.
  const rendered=await render(new Request(request.url,{headers:{Accept:'text/html'}}));
  if(rendered.status===200&&rendered.body&&rendered.headers.get('content-type')?.includes('text/html')&&!rendered.headers.has('set-cookie')&&rendered.headers.get('vary')!=='*'){
    const copy=rendered.clone();
    background(ctx,snapshotBytes(copy.body!).then(bytes=>environment.BUCKET!.put(objectKey,bytes,{httpMetadata:{contentType:'text/html; charset=utf-8'}})));
    return clientResponse(request,rendered,'page-render',true);
  }
  return rendered;
}
export async function drainResponse(response:Response|null){
  if(!response?.body)return;
  const reader=response.body.getReader();
  try{while(!(await reader.read()).done){/* Consume the warm-up response without buffering it. */}}finally{reader.releaseLock();}
}

import {admin,rateLimit,audit} from '@/lib/operations';
import {endpoint,readBody,HttpError} from '@/lib/server';
import {storageStatus,transferBatch} from '@/lib/storage-migration';
export async function GET(){return endpoint(async()=>{await admin();return Response.json(await storageStatus(),{headers:{'Cache-Control':'private, no-store'}});});}
export async function POST(request:Request){return endpoint(async()=>{
  const user=await admin(),body=await readBody(request);
  if(!['copy','clean'].includes(body.action)||typeof body.cursor!=='string'||body.cursor.length>500)throw new HttpError(400,'Неизвестный шаг переноса.');
  await rateLimit('storage-transfer:'+user.userId,120,60000);
  const result=await transferBatch(body.cursor,body.action==='clean');
  if(result.done)await audit(user.userId,'storage-'+body.action,null);
  return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
});}

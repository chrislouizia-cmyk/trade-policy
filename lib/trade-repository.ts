import { createClient } from '@/lib/supabase/client';

export async function uploadDataUrl(userId:string, dataUrl:string, label:string){
  const match=dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if(!match) throw new Error('Unsupported image format. Use PNG, JPG, or WEBP.');
  const mime=match[1]; const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
  const ext=mime==='image/jpeg'?'jpg':mime.split('/')[1];
  const path=`${userId}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${label}.${ext}`;
  const {error}=await createClient().storage.from('trade-charts').upload(path,bytes,{contentType:mime,upsert:false});
  if(error) throw error;
  return path;
}

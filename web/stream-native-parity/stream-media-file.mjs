/* Stream HLS/VOD segments without copying the entire MPEG-TS payload into
 * Bun's JS heap. Paths are constructed by the authenticated media worker from
 * validated resource IDs; never accept a browser-provided arbitrary pathname.
 *
 * A completed HLS .ts is atomically renamed into place by FFmpeg's temp_file
 * flag, so existence/size are safe preliminary readiness checks. Returning a
 * Blob-backed Response preserves streaming backpressure and lowers memory
 * spikes when several viewers request the same large 4K segment.
 */
export async function streamMediaFile(path,mime,cache,extra={},openFile=(name)=>Bun.file(name)){
 try{
  if(typeof path!=='string'||!path.length||
     !['video/mp2t','application/vnd.apple.mpegurl'].includes(mime))return null;
  const file=openFile(path);
  if(!file||typeof file.exists!=='function'||!await file.exists()||
     !Number.isSafeInteger(file.size)||file.size<=0)return null;
  return new Response(file,{status:200,headers:{
   'Content-Type':mime,
   'Cache-Control':cache==='private, max-age=3600'?'private, max-age=3600':'no-store, private',
   'X-Content-Type-Options':'nosniff',
   ...extra
  }})
 }catch{return null}
}

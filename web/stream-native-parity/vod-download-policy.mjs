// Browser VOD download policy. Only authenticated, explicitly enabled,
// single-file movie/episode transfers. Never offer LIVE or HLS segment downloads.
export function vodDownloadPath(kind,id,extension){
 const type=String(kind||''),number=String(id||''),ext=String(extension||'').toLowerCase();
 if(!['movie','series'].includes(type)||!/^[1-9][0-9]{0,14}$/.test(number)||
    !['mp4','mkv','avi','mov','ts'].includes(ext))return null;
 return '/api/download/'+type+'/'+number+'.'+ext;
}
export function downloadableResponse(status,contentType){
 // No Range was requested. A partial 206 response would create a corrupt file.
 if(status!==200)return false;
 const type=String(contentType||'').split(';')[0].trim().toLowerCase();
 return type==='application/octet-stream'||type==='video/mp4'||
   type==='video/x-matroska'||type==='video/x-msvideo'||
   type==='video/quicktime'||type==='video/mp2t';
}
export function attachmentFilename(kind,id,ext){
 const path=vodDownloadPath(kind,id,ext);
 if(!path)throw Error('invalid_download_asset');
 return 'BLOFY-STREAM-'+kind+'-'+id+'.'+ext;
}

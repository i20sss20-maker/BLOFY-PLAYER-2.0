// A manually configured M3U URL is a separate secret, not an Xtream host.
// The full URL may contain source credentials in its query string. Never
// return it through the admin API, logs, or an error response.
export function validateM3uPlaylistUrl(raw,xtreamBaseUrl){
  const value=String(raw??'').trim();
  if(!value||value.length>4096||/[\x00-\x1F\x7F\\]/.test(value)||
     !/^https?:\/\//i.test(value))
    throw new Error('xtream_m3u_url_invalid');
  let url,base;
  try{
    url=new URL(value);
    base=new URL(xtreamBaseUrl);
  }catch{throw new Error('xtream_m3u_url_invalid')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
     url.hash||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||
     url.hostname.endsWith('.local'))
    throw new Error('xtream_m3u_url_invalid');
  // Insecure cross-domain links can expose a playlist's credentials. Permit
  // HTTP only on the original source origin; external M3U hosts require TLS.
  if(url.protocol==='http:'&&url.origin!==base.origin)
    throw new Error('xtream_m3u_https_required');
  return url.toString();
}

export function isM3uPlaylistPrefix(bytes){
  const first=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
  const head=first.toString('utf8',0,Math.min(first.byteLength,256)).replace(/^\uFEFF/,'').trimStart();
  return head.startsWith('#EXTM3U')&&(!head[7]||/\s/.test(head[7]));
}

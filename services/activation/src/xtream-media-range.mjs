// Some standards-adjacent Xtream providers reject "Range: bytes=0-..." with
// HTTP 404/416, despite working for plain GET. Only remove a *first-byte*
// range and only once, never for an arbitrary seek or a source-side 401/403.
export function firstByteXtreamRange(range){
  const text=typeof range==='string'?range.trim():'';
  return /^bytes=0-(?:[0-9]{0,12})$/i.test(text);
}

export function shouldRetryXtreamWithoutRange({status,range,method='GET',alreadyRetried=false}={}){
  return method==='GET' && !alreadyRetried && firstByteXtreamRange(range) &&
    (status===404 || status===416);
}

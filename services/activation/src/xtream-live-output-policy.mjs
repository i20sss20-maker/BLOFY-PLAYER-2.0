// Only diagnose Xtream output types the source advertises for this account.
// A non-standard provider rejection (e.g. 456) must never trigger a search
// for alternate accounts, hosts, IPs or hidden media endpoints.
export function xtreamAllowedLiveFormats(accountInfo) {
  const formats=accountInfo?.allowedOutputFormats;
  if(!Array.isArray(formats)||formats.length===0) {
    return {formats:['ts'],declared:false};
  }
  const declared=new Set(formats
    .filter(x=>typeof x==='string')
    .slice(0,20)
    .map(x=>x.trim().toLowerCase()));
  const outputs=[];
  if(declared.has('ts')||declared.has('mpegts')||declared.has('mpeg-ts'))outputs.push('ts');
  if(declared.has('m3u8')||declared.has('hls'))outputs.push('m3u8');
  return {formats:outputs,declared:true};
}
export function shouldStopXtreamFormatComparison(status) {
  return [401,403,456,429].includes(Number(status));
}
export function outputFormatDescription({declared,formats}) {
  if(!declared)return 'المزود لم يعلن صيغ إخراج محددة؛ جرى اختبار TS فقط دون افتراض دعم HLS.';
  if(!formats.length)return 'الحساب لا يعلن TS أو M3U8 ضمن صيغ البث المسموحة. راجع المزود.';
  return 'صيغ البث التي يعلن المصدر السماح بها: '+formats.map(x=>x.toUpperCase()).join('، ')+'.';
}

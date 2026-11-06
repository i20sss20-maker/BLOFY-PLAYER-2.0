// Read-only sample insights for organizing owned Xtream catalogs.
// This does not move or delete titles and never changes playback routes.
const ARABIC_DIGITS='٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS='۰۱۲۳۴۵۶۷۸۹';
const convertDigits=input=>String(input??'').replace(/[٠-٩]/g,c=>String(ARABIC_DIGITS.indexOf(c)))
  .replace(/[۰-۹]/g,c=>String(PERSIAN_DIGITS.indexOf(c)));

export function xtreamTitleKey(input){
  const text=convertDigits(input).normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/(^|[^0-9])(19[5-9][0-9]|20[0-9]{2})(?=$|[^0-9])/g,' ')
    .replace(/\b(?:2160p|1080p|720p|4k|bluray|web[- ]?dl|hdrip|brrip|webrip)\b/gi,' ')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return text.slice(0,240);
}

export function xtreamKnownYear(item){
  const raw=item?.metadata?.year??item?.metadata?.releaseDate??'';
  const value=convertDigits(raw);
  const year=value.match(/(?:^|[^0-9])(19[5-9][0-9]|20[0-9]{2})(?:$|[^0-9])/);
  const title=convertDigits(item?.name).match(/(?:^|[^0-9])(19[5-9][0-9]|20[0-9]{2})(?:$|[^0-9])/);
  const n=year?Number(year[1]):title?Number(title[1]):null;
  return n&&n<=new Date().getFullYear()+2?n:null;
}

function matchKey(row){
  const name=xtreamTitleKey(row.name);
  if(name.length<3)return '';
  return name+'|'+(xtreamKnownYear(row)??'unknown');
}

export function auditXtreamCatalogSample(primary=[],alternates=[],limit=10){
  const max=Math.max(1,Math.min(20,Number(limit)||10));
  const left=Array.isArray(primary)?primary:[];
  const other=Array.isArray(alternates)?alternates:[];
  let missingPoster=0,missingYear=0,missingPlot=0,hidden=0;
  const groups=new Map();
  for(const row of left){
    if(!row?.name)continue;
    if(!String(row.icon_url||'').trim())missingPoster++;
    if(!xtreamKnownYear(row))missingYear++;
    if(!String(row.metadata?.plot||'').trim())missingPlot++;
    if(row.enabled===false)hidden++;
    const key=matchKey(row);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const duplicateGroups=[...groups.values()].filter(group=>group.length>=2)
    .sort((a,b)=>b.length-a.length).slice(0,max)
    .map(group=>({name:String(group[0].name).slice(0,160),year:xtreamKnownYear(group[0]),
      copies:group.length}));
  const otherGroups=new Map();
  for(const row of other){
    if(!row?.name||row.enabled===false)continue;
    const key=matchKey(row);
    if(!key)continue;
    if(!otherGroups.has(key))otherGroups.set(key,[]);
    otherGroups.get(key).push(row);
  }
  const candidates=[];
  for(const [key,rows] of groups){
    const matches=(otherGroups.get(key)||[]).filter(x=>x.server_id!==rows[0].server_id);
    if(!matches.length)continue;
    const names=[...new Set(matches.map(r=>String(r.server_name||'').slice(0,80)).filter(Boolean))];
    candidates.push({name:String(rows[0].name).slice(0,160),
      year:xtreamKnownYear(rows[0]),otherSources:names.slice(0,4)});
    if(candidates.length>=max)break;
  }
  return {sampleOnly:true,
    sampledPrimary:left.length,sampledOther:other.length,
    missingPoster,missingYear,missingPlot,hidden,
    duplicateGroupCount:[...groups.values()].filter(group=>group.length>=2).length,
    duplicateGroups,candidateAlternatives:candidates,
    warning:'أرقام تقريبية من عيّنة محدودة، وليست فحصًا شاملًا. البدائل المحتملة تتطلب مطابقة المحتوى والصلاحية والتشغيل قبل استخدامها.'};
}

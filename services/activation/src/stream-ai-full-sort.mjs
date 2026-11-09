// Sort existing catalog categories only. Never invent content or release years.
// Deterministic and stable within each bucket. Source item IDs and playback
// URLs are untouched; clients must request fresh catalog after approval.
const ARABIC=/(?:[\u0621-\u064A]|arab(?:ic|ia)?|ksa|saudi|عرب|خليج|سعود)/iu;
const YEAR=/(?:^|[^\d])(20\d{2})(?=$|[^\d])/u;
const BRANDS=[
 /(?:bein|be\s*in|بي\s*إن|بي\s*ان)/iu,
 /(?:alwan|ألوان|الوان)/iu,
 /(?:thmanea|thmanyah|ثمانية)/iu,
 /(?:starz\s*play|starzplay|ستارز)/iu,
 /(?:shasha|شاشة)/iu
];
const COLLATOR=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
const numericYear=name=>{
 const m=String(name||'').match(YEAR);
 const n=m?Number(m[1]):null;
 return n>=1950&&n<=2099?n:null;
};
export function fullCatalogCategoryOrder(rows,mediaType,{cutoffYear=2026}={}){
 if(!Array.isArray(rows)||!['live','movie','series'].includes(mediaType)||
    !Number.isInteger(cutoffYear)||cutoffYear<2000||cutoffYear>2099)
  throw Error('stream_ai_full_sort_invalid');
 const indexed=rows.map((row,i)=>{
  const name=String(row.name||'');
  const year=numericYear(name);
  const brand=mediaType==='live'?BRANDS.findIndex(re=>re.test(name)):-1;
  // Sports broadcasting brands first, then Arabic channels. Existing years
  // determine order; undated content is never claimed to be a given year.
  const tier=mediaType==='live'
   ?brand>=0?0:ARABIC.test(name)?1:2
   :ARABIC.test(name)?0:1;
  const yearTier=year!==null&&year>=cutoffYear?0:year!==null?1:2;
  return {row,i,name,year,brand,tier,yearTier};
 });
 return indexed.sort((a,b)=>{
  if(a.tier!==b.tier)return a.tier-b.tier;
  if(mediaType==='live'&&a.tier===0&&a.brand!==b.brand)return a.brand-b.brand;
  if(a.yearTier!==b.yearTier)return a.yearTier-b.yearTier;
  if(a.year!==b.year)return (b.year||0)-(a.year||0);
  // Existing input sort within ties avoids disruptive reshuffle.
  return a.i-b.i;
 }).map(x=>String(x.row.source_category_id));
}
export function summarizeFullCatalogCoverage(rows,mediaType){
 const titles=rows.map(r=>String(r.name||''));
 return {mediaType,categories:titles.length,
  arabicCategories:titles.filter(x=>ARABIC.test(x)).length,
  datedAtLeast2026:titles.filter(x=>(numericYear(x)||0)>=2026).length,
  undatedCategories:titles.filter(x=>numericYear(x)===null).length,
  matchedBrandCategories:mediaType==='live'
    ?titles.filter(x=>BRANDS.some(re=>re.test(x))).length:0,
  note:'فرز الأقسام الموجودة فقط، لا يعني التحقق من تاريخ إنتاج كل فيلم أو إعادة تصنيف العناصر.'};
}

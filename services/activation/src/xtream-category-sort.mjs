// BLOFY category organizer. Changes only the display order of existing
// categories; it does not invent content years or touch hidden categories.
const arCollator = new Intl.Collator('ar', {numeric:true,sensitivity:'base'});
export const XTREAM_CATEGORY_SORT_MODES = Object.freeze(['popular','alphabetical','smart']);
const LANGUAGES=Object.freeze([
  ['arabic',/(?:عرب(?:ي|ية|ى)?|عربيه|arabic|عربيات)/iu,'عربي',0],
  ['foreign',/(?:أجنبي|اجنبي|اجنبية|انجليزي|إنجليزي|english|foreign|hollywood|american|أمريكي|امريكي)/iu,'أجنبي',1],
  ['turkish',/(?:تركي|تركية|turkish|turkey)/iu,'تركي',2],
  ['indian',/(?:هندي|هندية|indian|bollywood|hindi)/iu,'هندي',3],
  ['korean',/(?:كوري|كورية|korean)/iu,'كوري',4],
  ['anime',/(?:أنمي|انمي|anime|انيمي)/iu,'أنمي',5],
  ['kids',/(?:أطفال|اطفال|kids|children|cartoon|كرتون)/iu,'أطفال',6],
  ['documentary',/(?:وثائقي|وثائقية|documentary)/iu,'وثائقي',7]
]);
const DIGITS='٠١٢٣٤٥٦٧٨٩';
const toWestern=text=>String(text??'').replace(/[٠-٩]/g,char=>String(DIGITS.indexOf(char))).replace(/[۰-۹]/g,char=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)));

export function classifyXtreamCategory(name){
  const text=toWestern(name);
  const language=LANGUAGES.find(([,re])=>re.test(text));
  const found=text.match(/(^|[^\d])(19[5-9]\d|20\d{2})(?=$|[^\d])/u);
  const year=found?Number(found[2]):null;
  return {
    group:language?.[0]||'other',
    label:language?.[2]||'أقسام أخرى',
    priority:language?.[3]??8,
    year:year>=1950&&year<=2099?year:null
  };
}

export function sortXtreamCategories(rows,mode){
  if(!XTREAM_CATEGORY_SORT_MODES.includes(mode)||!Array.isArray(rows))
    throw new Error('xtream_category_sort_invalid');
  return rows.map((row,index)=>({...row,_originalIndex:index,_smart:classifyXtreamCategory(row.name)})).sort((a,b)=>{
    const countA=Math.max(0,Number(a.item_count)||0);
    const countB=Math.max(0,Number(b.item_count)||0);
    if(mode==='popular'&&countA!==countB)return countB-countA;
    if(mode==='smart'){
      if(a._smart.priority!==b._smart.priority)return a._smart.priority-b._smart.priority;
      // Newest known year first, then undated shelves within the same language.
      if(a._smart.year!==b._smart.year)return (b._smart.year??0)-(a._smart.year??0);
    }
    const nameOrder=arCollator.compare(String(a.name||''),String(b.name||''));
    if(nameOrder)return nameOrder;
    return a._originalIndex-b._originalIndex;
  }).map(row=>String(row.source_category_id));
}

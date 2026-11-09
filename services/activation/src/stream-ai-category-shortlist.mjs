// Bound the Gemini category choice list for large (up to 1000-category)
// sources without quietly giving up. Always include categories currently
// assigned to sampled items, then label overlap and popular existing shelves.
const TOKEN=/[\p{L}\p{N}]{3,}/gu;
const TERMS=text=>new Set(String(text||'').toLowerCase().match(TOKEN)||[]);
export function shortlistExistingCategories(categories,items,max=80){
 if(!Array.isArray(categories)||!Array.isArray(items)||!Number.isInteger(max)||max<1||max>80)
  throw Error('stream_ai_category_shortlist_invalid');
 const selectedCurrent=new Set(items.map(x=>String(x.category_id??'')).filter(Boolean));
 const content=items.flatMap(x=>[x.name,x.categoryName]).join(' ');
 const query=TERMS(content);
 const ranked=categories.map((cat,index)=>{
  const name=String(cat.name||'');
  const overlap=[...TERMS(name)].filter(x=>query.has(x)).length;
  const attached=selectedCurrent.has(String(cat.source_category_id??cat.id??''));
  const count=Number(cat.item_count)||0;
  return {cat,index,score:(attached?100000:0)+overlap*1000+Math.min(500,Math.max(0,count))};
 });
 ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
 return ranked.slice(0,max).map(x=>x.cat);
}

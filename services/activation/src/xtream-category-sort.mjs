// Deterministic, non-destructive ordering for one provider and media type.
// Never changes which categories are visible or the contents themselves.
const arCollator = new Intl.Collator('ar', {numeric:true,sensitivity:'base'});
export const XTREAM_CATEGORY_SORT_MODES = Object.freeze(['popular','alphabetical']);

export function sortXtreamCategories(rows,mode){
  if(!XTREAM_CATEGORY_SORT_MODES.includes(mode))throw new Error('xtream_category_sort_invalid');
  if(!Array.isArray(rows))throw new Error('xtream_category_sort_invalid');
  return rows.map((row,index)=>({...row,_originalIndex:index})).sort((a,b)=>{
    const countA=Math.max(0,Number(a.item_count)||0);
    const countB=Math.max(0,Number(b.item_count)||0);
    if(mode==='popular'&&countA!==countB)return countB-countA;
    const nameOrder=arCollator.compare(String(a.name||''),String(b.name||''));
    if(nameOrder)return nameOrder;
    // Ties are stable; the already selected display order wins.
    return a._originalIndex-b._originalIndex;
  }).map(row=>String(row.source_category_id));
}

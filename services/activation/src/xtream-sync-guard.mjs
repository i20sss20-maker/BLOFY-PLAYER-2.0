// Guard against a provider returning HTTP 200 with an unexpectedly empty,
// truncated or misleading catalog. Protect current subscribers' imported media.
function count(value){
  if(!Number.isSafeInteger(value)||value<0)throw new Error('xtream_catalog_count_invalid');
  return value;
}

export function assessXtreamSync({previousItems,importedItems,previousCategories,importedCategories}){
  const oldItems=count(previousItems),newItems=count(importedItems);
  const oldCategories=count(previousCategories),newCategories=count(importedCategories);
  // Treat empty "success" as an invalid import, even for a newly added source.
  if(newItems===0)throw new Error('xtream_catalog_empty_preserved');
  // A provider can return HTTP 200 with only a few items during upstream
  // throttling or a partial JSON response. This must not delete the prior
  // catalog even for a small-but-real source (50-499 items).
  // Deliberate >90% catalog reductions require an operator review instead.
  if(oldItems>=50 && newItems<Math.ceil(oldItems*0.10))
    throw new Error('xtream_catalog_suspicious_drop_preserved');
  // Some Xtream implementations omit category listings while returning playable
  // items. Keep existing categories, including manual visibility/order settings.
  const preserveCategories=oldCategories>0&&(
    newCategories===0||
    (oldCategories>=8&&newCategories<Math.ceil(oldCategories*0.15))
  );
  return{preserveCategories,items:newItems,categories:newCategories};
}

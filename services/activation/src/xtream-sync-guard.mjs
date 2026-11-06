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
  // Providers can legitimately shrink a catalog, but losing >95% of a well
  // populated type usually means an API, subscription or throttling problem.
  if(oldItems>=500 && newItems<Math.ceil(oldItems*0.05))
    throw new Error('xtream_catalog_suspicious_drop_preserved');
  // Some Xtream implementations omit category listings while returning playable
  // items. Keep existing categories, including manual visibility/order settings.
  const preserveCategories=oldCategories>0&&(
    newCategories===0||
    (oldCategories>=20&&newCategories<Math.ceil(oldCategories*0.05))
  );
  return{preserveCategories,items:newItems,categories:newCategories};
}

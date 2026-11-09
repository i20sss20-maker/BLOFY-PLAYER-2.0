// Keep BLOFY display order aligned to the actual Xtream source list.
// Provider metadata is preferred when it contains a bounded numeric order;
// otherwise preserve the position in the streamed API/M3U response.
// Never derive order from channel names, category IDs, or AI guesses.
function boundedInteger(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^(0|[1-9][0-9]{0,8})$/.test(value.trim()))return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=0&&n<=999999999?n:null;
}
export function xtreamProviderOrder(raw,position,kind='category'){
 if(!Number.isSafeInteger(position)||position<1||position>999999999)
  throw new RangeError('xtream_source_position_invalid');
 if(!['category','item'].includes(kind))throw new TypeError('xtream_source_kind_invalid');
 const object=raw&&typeof raw==='object'?raw:{};
 const candidates=kind==='category'
  ?[object.category_order,object.sort_order,object.order,object.position]
  :[object.num,object.order,object.position];
 for(const value of candidates){
  const normalized=boundedInteger(value);
  if(normalized!==null)return normalized;
 }
 return position;
}
export function withXtreamProviderPosition(row,position){
 if(!row||typeof row!=='object')return null;
 if(!Number.isSafeInteger(position)||position<1||position>999999999)
  throw new RangeError('xtream_source_position_invalid');
 return {...row,sourceSortOrder:position};
}

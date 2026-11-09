// Strictly parameterized catalog paging shared by Xtream and M3U.
// Selected source IDs always use bind placeholders, never SQL integer literals.
export function gatewayItemsPageQuery(mediaType,lastId,{sourceId=null,filter=null}={}) {
  if(!['live','movie','series'].includes(mediaType))throw new TypeError('invalid_media_type');
  if(!Number.isSafeInteger(lastId)||lastId<0)throw new TypeError('invalid_cursor');
  const values=[mediaType,lastId];
  const where=[
    'm.media_type=$1','m.gateway_id>$2','s.enabled=TRUE',
    's.publish_catalog=TRUE','i.enabled=TRUE',
    '(c.enabled IS NULL OR c.enabled=TRUE)'
  ];
  if(sourceId){
    values.push(sourceId);
    where.push('i.server_id=$'+values.length);
  }
  if(filter){
    if(sourceId && sourceId!==filter.server_id)throw new TypeError('source_category_mismatch');
    values.push(filter.server_id,filter.source_category_id);
    where.push('i.server_id=$'+(values.length-1));
    where.push('i.category_id=$'+values.length);
  }
  values.push(2000);
  const text=`SELECT m.gateway_id,i.server_id,i.source_id,i.category_id,
      COALESCE(NULLIF(i.custom_name,''),i.name) AS name,
      COALESCE(NULLIF(i.custom_icon_url,''),i.icon_url) AS icon_url,
      i.featured,i.channel_number,
      i.container_extension,i.metadata,cm.gateway_id AS category_gateway_id,s.priority
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i
      ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c
      ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    LEFT JOIN blofy_xtream_gateway_category_map cm
      ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.gateway_id ASC LIMIT $${values.length}`;
  return {text,values};
}

// Keyset pagination in upstream Xtream display order. Stable gateway IDs are
// retained as the final tie-breaker, so changing the display order never
// changes account credentials, stream IDs or URLs. Do not use OFFSET for huge
// 100k+ media catalogs: advancing follows the last fully delivered row.
const SORT_PARTS=[
  'COALESCE(s.priority,2147483647)',
  's.id',
  'COALESCE(c.sort_order,2147483647)',
  'COALESCE(i.source_sort_order,2147483647)',
  'm.gateway_id'
];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeSort=n=>Number.isSafeInteger(n)&&n>=-2147483648&&n<=2147483647;
export function gatewayOrderedItemsPageQuery(mediaType,cursor=null,{
 sourceId=null,filter=null,pageSize=2000
}={}){
 if(!['live','movie','series'].includes(mediaType))throw new TypeError('invalid_media_type');
 if(sourceId&&!UUID.test(String(sourceId)))throw new TypeError('invalid_source_id');
 if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>2000)
  throw new TypeError('invalid_page_size');
 const values=[mediaType];
 const where=[
  'm.media_type=$1','s.enabled=TRUE','s.publish_catalog=TRUE',
  'i.enabled=TRUE','(c.enabled IS NULL OR c.enabled=TRUE)'
 ];
 if(sourceId){
  values.push(sourceId);
  where.push('i.server_id=$'+values.length);
 }
 if(filter){
  if(!UUID.test(String(filter.server_id))||
     typeof filter.source_category_id!=='string'||!filter.source_category_id||
     filter.source_category_id.length>256||
     (sourceId&&sourceId!==filter.server_id))
   throw new TypeError('source_category_mismatch');
  values.push(filter.server_id,filter.source_category_id);
  where.push('i.server_id=$'+(values.length-1));
  where.push('i.category_id=$'+values.length);
 }
 if(cursor!==null){
  if(!cursor||!safeSort(cursor.priority)||
     !UUID.test(String(cursor.serverId))||
     !safeSort(cursor.categoryOrder)||!safeSort(cursor.itemOrder)||
     !Number.isSafeInteger(cursor.gatewayId)||cursor.gatewayId<1)
   throw new TypeError('invalid_order_cursor');
  const first=values.length+1;
  values.push(cursor.priority,cursor.serverId,cursor.categoryOrder,
   cursor.itemOrder,cursor.gatewayId);
  where.push('('+SORT_PARTS.join(',')+') > ('+
   [first,first+1,first+2,first+3,first+4]
    .map((index,i)=>'$'+index+'::'+(i===1?'uuid':i===4?'bigint':'integer')).join(',')+')');
 }
 values.push(pageSize);
 return {text:`SELECT m.gateway_id,i.server_id,i.source_id,i.category_id,
   COALESCE(NULLIF(i.custom_name,''),i.name) AS name,
   COALESCE(NULLIF(i.custom_icon_url,''),i.icon_url) AS icon_url,
   i.featured,i.channel_number,i.container_extension,i.metadata,
   cm.gateway_id AS category_gateway_id,c.name AS category_name,
   ${SORT_PARTS[0]} AS sort_source_priority,
   ${SORT_PARTS[1]} AS sort_server_id,
   ${SORT_PARTS[2]} AS sort_category_order,
   ${SORT_PARTS[3]} AS sort_item_order
  FROM blofy_xtream_gateway_item_map m
  JOIN blofy_xtream_items i
    ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
  JOIN blofy_xtream_servers s ON s.id=i.server_id
  LEFT JOIN blofy_xtream_categories c
    ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
  LEFT JOIN blofy_xtream_gateway_category_map cm
    ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
  WHERE ${where.join(' AND ')}
  ORDER BY ${SORT_PARTS.join(',')} LIMIT $${values.length}`,values};
}
export function gatewayOrderCursor(row){
 if(!row||!safeSort(Number(row.sort_source_priority))||
    !UUID.test(String(row.sort_server_id))||
    !safeSort(Number(row.sort_category_order))||
    !safeSort(Number(row.sort_item_order))||
    !Number.isSafeInteger(Number(row.gateway_id))||Number(row.gateway_id)<1)
  throw new TypeError('invalid_gateway_order_row');
 return {priority:Number(row.sort_source_priority),serverId:String(row.sort_server_id),
   categoryOrder:Number(row.sort_category_order),
   itemOrder:Number(row.sort_item_order),gatewayId:Number(row.gateway_id)};
}

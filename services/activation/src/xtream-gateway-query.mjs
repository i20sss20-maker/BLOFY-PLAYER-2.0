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
  if(mediaType==='movie'){
    // Only verified, expiring movie failures are hidden. Series remain in
    // the catalog while individual confirmed-bad episodes are excluded from
    // series_info and playback. Never remove the imported catalog row.
    where.push(`NOT EXISTS (SELECT 1 FROM blofy_xtream_media_quarantine q
      WHERE q.server_id=i.server_id AND q.media_type='movie'
        AND q.source_id=i.source_id AND q.expires_at>NOW())`);
  }
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

// Read-only, bounded analysis of a complete selected source+media catalog.
// Does not run an external AI model, and never alters playback, IDs, codes or catalogs.
import {xtreamTitleKey,xtreamKnownYear} from './xtream-library-insights.mjs';

export function suggestedStreamTitle(name){
  const before=String(name||'').trim().slice(0,220);
  if(!before)return null;
  const result=before.replace(/#{3,}/g,' ')
    .replace(/\s{2,}/g,' ').trim();
  return result&&result!==before?result:null;
}
const GROUPS=[
  ['رياضة',/sports?|ssc|bein|espn|رياض|مباراه|مباريات|كرة|football|soccer/i],
  ['أخبار',/news|اخبار|أخبار|إخبار|cnn|bbc/i],
  ['أطفال وأنمي',/kids|children|cartoon|أطفال|اطفال|كرتون|anime|انمي|أنمي/i],
  ['أفلام',/movies?|film|cinema|افلام|أفلام|سينما/i],
  ['مسلسلات',/series|serial|drama|مسلسل|مسلسلات|دراما/i],
  ['وثائقيات',/documentary|وثائقي|nat geo|national geographic/i]
];
export function suggestLibraryGroup(name,categoryName=''){
  const v=String(categoryName||'')+' '+String(name||'');
  for(const [group,regex] of GROUPS)if(regex.test(v))return group;
  return 'غير مصنّف';
}
function bounded(value,n=130){return String(value||'').slice(0,n)}
export function auditFullStreamCatalog(rows=[],{total=0,sourceId='',type='live',
  maxSuggestions=60,maxDuplicates=30}={}){
  const all=Array.isArray(rows)?rows:[];
  const groups=new Map(),categories=new Map();
  const suggestions=[];
  let unnamed=0,noArtwork=0,noCategory=0,hidden=0,noYear=0,noPlot=0;
  for(const row of all){
    const name=bounded(row.name,220),cat=bounded(row.category_name,100);
    if(!name.trim())unnamed++;
    if(!row.has_artwork)noArtwork++;
    if(!row.category_id)noCategory++;
    if(row.enabled===false)hidden++;
    if(type!=='live'){
      if(!xtreamKnownYear({name,metadata:{year:row.year}}))noYear++;
      if(!row.has_plot)noPlot++;
    }
    const classification=suggestLibraryGroup(name,cat);
    categories.set(classification,(categories.get(classification)||0)+1);
    const key=xtreamTitleKey(name)+(type==='live'?'':'|'+
      (xtreamKnownYear({name,metadata:{year:row.year}})||'unknown'));
    // Short titles, generic placeholders and empty normalized names are
    // not enough evidence for a duplicate suggestion.
    if(key.length>=5){
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({id:bounded(row.source_id,128),name,categoryName:cat});
    }
    const candidate=suggestedStreamTitle(name);
    if(candidate&&suggestions.length<maxSuggestions)
      suggestions.push({id:bounded(row.source_id,128),currentName:name,
        proposedName:candidate,categoryName:cat,
        reason:'إزالة رموز زخرفية مكررة',confidence:'مرتفع'});
  }
  const duplicates=[...groups.values()].filter(group=>group.length>1);
  duplicates.sort((a,b)=>b.length-a.length);
  const duplicateItems=duplicates.reduce((n,group)=>n+group.length,0);
  const orderedGroups=[...categories.entries()].sort((a,b)=>b[1]-a[1])
    .map(([name,count])=>({name,count}));
  return {ok:true,engine:'rules-v1',modelUsed:false,readOnly:true,
    sourceId,type,total:Number(total)||all.length,scanned:all.length,
    complete:Number(total)<=all.length,missingNames:unnamed,
    missingArtwork:noArtwork,missingCategory:noCategory,hidden,
    missingYear:type==='live'?null:noYear,
    missingPlot:type==='live'?null:noPlot,
    duplicateGroupCount:duplicates.length,duplicateItems,
    categoryGroups:orderedGroups,
    duplicateExamples:duplicates.slice(0,maxDuplicates).map(g=>({
      title:g[0].name,copies:g.length,items:g.slice(0,5)})),
    nameSuggestions:suggestions,
    warning:Number(total)>all.length?
      'التحليل جزئي لأن الفهرس تجاوز حد الحماية؛ راجع العدد المعروض.':
      'مقترحات للمراجعة فقط؛ التطابق بالاسم لا يثبت أن المحتوى مكرر فعليًا.'
  };
}

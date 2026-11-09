import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFullStreamCatalog,suggestedStreamTitle,suggestLibraryGroup} from '../src/stream-full-library-audit.mjs';

test('full selected catalog counts quality, duplicate candidates and safe name proposals',()=>{
  const rows=[
    {source_id:'101',name:'#### SSC SPORTS 1 ####',category_id:'sports',
      category_name:'Sports',has_artwork:true,has_plot:true,year:null,enabled:true},
    {source_id:'102',name:'SSC SPORTS 1',category_id:'sports',
      category_name:'Sports',has_artwork:false,has_plot:true,year:null,enabled:true},
    {source_id:'103',name:'World News',category_id:null,
      category_name:'',has_artwork:false,has_plot:true,year:null,enabled:false}
  ];
  const report=auditFullStreamCatalog(rows,{sourceId:'x',type:'live',total:3});
  assert.equal(report.complete,true);
  assert.equal(report.scanned,3);
  assert.equal(report.duplicateGroupCount,1);
  assert.equal(report.duplicateItems,2);
  assert.equal(report.missingArtwork,2);
  assert.equal(report.missingCategory,1);
  assert.equal(report.hidden,1);
  assert.equal(report.nameSuggestions[0].proposedName,'SSC SPORTS 1');
  assert.equal(report.categoryGroups[0].name,'رياضة');
  assert.equal(report.readOnly,true);
  assert.equal(report.modelUsed,false);
  assert.equal(JSON.stringify(report).includes('password'),false);
});
test('analysis explicitly marks oversized scan incomplete without mutating',()=>{
  const report=auditFullStreamCatalog([{source_id:'1',name:'News'}],{total:40001});
  assert.equal(report.complete,false);
  assert.match(report.warning,/جزئي/);
});
test('safe title cleanup preserves meaningful names and avoids fabricating titles',()=>{
  assert.equal(suggestedStreamTitle('#### 1001 ####'),'1001');
  assert.equal(suggestedStreamTitle('La Liga HD'),null);
  assert.equal(suggestedStreamTitle('###'),null);
  assert.equal(suggestLibraryGroup('BBC News'),'أخبار');
});

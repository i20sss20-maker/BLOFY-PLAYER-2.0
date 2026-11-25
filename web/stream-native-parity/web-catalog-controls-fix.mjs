import {readFileSync,writeFileSync} from 'node:fs';
let app=readFileSync('app.js','utf8'),server=readFileSync('server.ts','utf8');
function change(s,a,b){if(s.split(a).length!==2)throw Error('Unexpected source: '+a);return s.replace(a,b)}
const edits=[
["['commentators','🎙','المعلقين'],",""],
["else if(route==='commentators')commentatorsScreen();","else if(route==='commentators'){S.route='live';catalog('live')}"],
["xhr.timeout=40000;","xhr.timeout=method==='GET'&&endpoint.indexOf('/api/page?')===0&&endpoint.indexOf('&query=')>=0?115000:40000;"],
["function searchNow(q,token){\n var old=","function searchNow(q,token){\n if(token!==S.searchToken||S.route!=='search')return;\n if(S.searchTimer){clearTimeout(S.searchTimer);S.searchTimer=null}\n var old="],
["if(!isLive||!state.commentary)return;","if(!isLive)return;\n if(!state.commentary){showPlayerChoices('المعلقين • BLOFY',embeddedCommentaryChoices({current:function(){return ''},select:function(){}}),origin);return}"],
["var engine=S.play&&S.play.engine,list=[],native=video.textTracks;","var engine=S.play&&S.play.video===video&&S.play.engine,list=[],native=video.textTracks;"],
["  if(list.length){\n   options.push({name:'إيقاف الترجمة'","  if(list.length&&!(engine&&engine.subtitleTracks&&engine.subtitleTracks.length)){\n   options.push({name:'إيقاف الترجمة'"],
["select:function(){engine.subtitleDisplay=false;engine.subtitleTrack=-1;playerStatus('تم إيقاف الترجمة')}","select:function(){engine.subtitleDisplay=false;engine.subtitleTrack=-1;for(var n=0;n<list.length;n++)list[n].mode='disabled';playerStatus('تم إيقاف الترجمة')}"],
["  showPlayerChoices('الترجمة',options,this)","  if(!options.length){playerStatus('لا توجد ترجمة متاحة من مصدر هذا المحتوى حاليًا.');return}\n  showPlayerChoices('الترجمة',options,this)"]
];
for(const [a,b] of edits)app=change(app,a,b);
server=change(server,"(!query||normalizeSearch(item.name||item.title||'').includes(query))","(!query||query.split(/\\s+/).every(word=>normalizeSearch(item.name||item.title||'').includes(word)))");
new Function(app);
writeFileSync('app.js',app);writeFileSync('server.ts',server);

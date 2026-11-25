import {readFileSync,writeFileSync} from 'node:fs';
let app=readFileSync('app.js','utf8');
function change(a,b){if(app.split(a).length!==2)throw Error('Unexpected source '+a);app=app.replace(a,b)}
change('جار تشغيل معاينة القناة…</div><video id="live-video" playsinline webkit-playsinline autoplay muted preload="auto"','اضغط المعاينة أو ملء الشاشة لتشغيل القناة.</div><video id="live-video" playsinline webkit-playsinline muted preload="none"');
change("if(desc)desc.textContent='معاينة '+title(item)+' • التشغيل تلقائي عند التحديد';","if(desc)desc.textContent='القناة '+title(item)+' • اختر المعاينة أو ملء الشاشة للتشغيل';");
change(" if(activate)beginPreview(item)"," // Browsing or moving TV focus never starts a licensed provider feed.\n // Explicit preview and fullscreen controls remain available.\n if(S.play&&S.play.preview&&String(S.play.id)!==String(id)){\n  var box=document.getElementById('live-status');\n  if(box)box.textContent='المعاينة السابقة مستمرة حتى اختيار تشغيل القناة الجديدة.';\n }");
change(" if(isLive&&oldPreview&&oldPreview.preview&&(\n  oldPreview.hlsKey===fullKey||oldPreview.hlsKey===fullKey+'/compat'||\n  (oldPreview.hlsKey||'').indexOf(fullKey+'/sid-')===0)){"," if(isLive&&S.previewStopPending){var pendingStatus=document.getElementById('live-status');if(pendingStatus)pendingStatus.textContent='جار إنهاء اتصال المعاينة؛ أعد الضغط بعد اكتماله.';return}\n if(isLive&&oldPreview&&oldPreview.preview&&oldPreview.hlsKey){");
new Function(app);writeFileSync('app.js',app);

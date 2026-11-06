import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../web/blofy-smart-commands.js',import.meta.url),'utf8');
const context={};
vm.createContext(context);
vm.runInContext(script,context,{timeout:1500});
const parse=text=>context.BlofySmartCommands.parse(text);

test('Arabic and English commands reliably identify safe existing actions',()=>{
  assert.equal(parse('رتّب أقسام القنوات بشكل ذكي').intent,'sort');
  assert.equal(parse('رتب أقسام الأفلام بالأكثر محتوى').mode,'popular');
  assert.equal(parse('رتب الفئات ابجديا').mode,'alphabetical');
  assert.equal(parse('حدث معلومات الأفلام الناقصة').intent,'enrich');
  assert.equal(parse('حدث معلومات المسلسلات').mediaTypes.join(','),'series');
  assert.equal(parse('حدث معلومات الأفلام والمسلسلات').mediaTypes.join(','),'movie,series');
  assert.equal(parse('زامن المحتوى من المصدر').intent,'sync');
  assert.equal(parse('حدث المحتوى').intent,'sync');
  assert.equal(parse('اعمل تقرير جودة المكتبة').intent,'audit');
  assert.equal(parse('افحص تشغيل بث القنوات').intent,'probe');
  assert.equal(parse('افحص تشغيل بث القنوات').mediaTypes.join(','),'live');
  assert.equal(parse('ارفع شعار السيرفر').intent,'branding');
  assert.equal(parse('sync live channels').intent,'sync');
});

test('no vague, destructive, blocked-host or secret commands may execute',()=>{
  for(const raw of ['', 'سو كل شيء','احذف جميع القنوات','رتب وبعدها احذف المكرر',
    'تجاوز الحظر','استخرج كلمات المرور','امسح قاعدة البيانات',
    'a'.repeat(401)]){
    const out=parse(raw);
    assert.equal(out.intent,'unknown',raw);
    assert.ok(out.reason);
  }
});

test('prompt data never creates arbitrary URLs or code actions',()=>{
  const intents=['sort','enrich','sync','probe','audit','branding','unknown'];
  for(const prompt of [
    'https://fake.example/live/pass',
    'DROP TABLE blofy_xtream_items',
    'اشتراك للمستخدم الجديد',
    'بدل هوست السيرفر',
    'اعمل webhook جديد',
    'بث مباشر مجاني'
  ])assert.ok(intents.includes(parse(prompt).intent));
  assert.equal(parse('DROP TABLE blofy_xtream_items').intent,'unknown');
});

test('command center has real scoped preview and explicit confirmation',async()=>{
  const html=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../src/sources-admin-hook.mjs',import.meta.url),'utf8');
  for(const id of ['smartCommandForm','smartCommandSource','smartCommandType',
    'smartCommandText','smartCommandPreviewBtn','smartCommandExecuteBtn','smartCommandPreview',
    'smartCommandCancelBtn','smartCommandStatus'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/blofy-smart-commands\.js/);
  assert.match(router,/\/blofy-smart-commands\.js/);
  assert.match(js,/function smartInvalidate\(/);
  assert.match(js,/smartCommandPlan=null/);
  assert.match(js,/window\.confirm\('تأكيد تنفيذ/);
  assert.match(js,/\/api\/v1\/admin\/xtream\/categories\/auto-sort/);
  assert.match(js,/\/api\/v1\/admin\/xtream\/items\//);
  assert.match(js,/\/api\/v1\/admin\/xtream\/catalog\/insights/);
  assert.match(js,/\/api\/v1\/admin\/xtream\/servers\//);
  assert.match(js,/session\.cancelled=true/);
  assert.doesNotMatch(js,/eval\(/);
});

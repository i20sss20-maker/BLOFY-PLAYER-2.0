import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const login=app.slice(app.indexOf('function login(message)'),app.indexOf('// Remember the exact scroll'));
test('native entry layout keeps existing authenticated code flow',()=>{
 assert.match(login,/native-stream-login/);
 assert.match(login,/id="stream-login-form"/);
 assert.match(login,/id="activation-code"/);
 assert.match(login,/\/api\/redeem/);
 assert.match(login,/deviceKey:deviceKey\(\)/);
 assert.match(login,/if\(!btn\|\|btn.disabled\)return/);
 assert.match(login,/form.onsubmit/);
});
test('unimplemented direct provider access is not presented as operational',()=>{
 assert.match(login,/disabled aria-describedby="direct-login-notice">اكستريم/);
 assert.match(login,/disabled aria-describedby="direct-login-notice">M3U/);
 assert.doesNotMatch(login,/id="password"/);
});
test('responsive entry styling is isolated and supports older TVs',()=>{
 assert.match(css,/\.login-screen\.native-login-screen/);
 assert.match(css,/\.login-panel\.native-stream-login/);
 assert.match(css,/#143e4c,#0b2a36,#071c26/);
 assert.match(css,/data-blofy-device="tv"/);
});

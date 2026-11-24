import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const first=app.indexOf('function deviceExperience(');
const last=app.indexOf('var NAV=',first);
assert.ok(first>0&&last>first,'ES5 device capability classifier is present');

function runDevice(ua,touch,coarse){
 const root={attrs:{},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]}};
 const doc={documentElement:root,querySelector(){return null},getElementById(){return null}};
 const S={keyboardMode:false};
 const context={S,document:doc,navigator:{userAgent:ua,maxTouchPoints:touch},
  window:{matchMedia(){return {matches:coarse}}},Date,Number,String};
 const api=vm.runInNewContext(app.slice(first,last)+
  ';({deviceExperience,setDeviceInput,updateDeviceExperienceStatus,initDeviceExperience})',context);
 return {root,doc,S,api};
}

test('VIDAA TV starts in D-pad/remote mode and keeps remote focus',()=>{
 const h=runDevice('Toshiba VIDAA U3',0,false);
 assert.equal(h.root.attrs['data-blofy-device'],'tv');
 assert.equal(h.root.attrs['data-blofy-input'],'remote');
 assert.equal(h.S.keyboardMode,true);
 assert.equal(h.api.deviceExperience('Android TV 11',0,false),'tv');
 assert.equal(h.api.deviceExperience('SmartTV Tizen',0,false),'tv');
});

test('iPhone and iPadOS with desktop user agent both use touch controls',()=>{
 const iphone=runDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)',5,true);
 assert.equal(iphone.root.attrs['data-blofy-device'],'touch');
 assert.equal(iphone.root.attrs['data-blofy-input'],'touch');
 const ipad=runDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',5,true);
 assert.equal(ipad.root.attrs['data-blofy-device'],'touch');
 assert.equal(ipad.api.deviceExperience('Macintosh',0,false),'desktop');
 assert.equal(runDevice('Android Chrome',0,true).root.attrs['data-blofy-device'],'touch');
});

test('desktop pointer and real remote navigation switch mode without page reload',()=>{
 const h=runDevice('Windows NT 10.0',0,false);
 assert.equal(h.root.attrs['data-blofy-device'],'desktop');
 assert.equal(h.root.attrs['data-blofy-input'],'mouse');
 h.api.setDeviceInput('remote');
 assert.equal(h.root.attrs['data-blofy-input'],'remote');
 assert.equal(h.S.keyboardMode,true);
 h.api.setDeviceInput('touch');
 assert.equal(h.S.keyboardMode,false);
 assert.equal(h.root.attrs['data-blofy-input'],'touch');
 h.api.setDeviceInput('invalid');
 assert.equal(h.root.attrs['data-blofy-input'],'touch');
});

test('input mode is exposed locally and does not write account data or network traffic',()=>{
 const h=runDevice('Toshiba VIDAA',0,false);
 let value='';
 const label={isConnected:true,set textContent(v){value=v}};
 h.doc.getElementById=()=>label;
 h.api.setDeviceInput('remote');
 assert.match(value,/شاشة تلفزيون/);
 assert.match(value,/ريموت/);
 h.api.setDeviceInput('touch');
 assert.match(value,/اللمس/);
 assert.doesNotMatch(app.slice(first,last),/localStorage|fetch\(|XMLHttpRequest|\bapi\(/);
});

test('focus ring adapts to remote and synthetic remote clicks do not hide it',()=>{
 assert.match(css,/html\[data-blofy-input="remote"\] button:focus/);
 assert.match(css,/html\[data-blofy-device="touch"\] \.settings-grid button/);
 assert.match(app,/Date\.now\(\)-lastRemoteKeyAt<600/);
 assert.match(app,/e\.pointerType==='touch'/);
 assert.match(app,/if\(!window\.PointerEvent\)document\.addEventListener\('touchstart'/);
 assert.match(app,/if\(code===37\|\|code===38/);
});

test('iPadOS desktop-style Safari receives Add to Home Screen directions',()=>{
 const begin=app.indexOf('function webAppInstallGuide(');
 const end=app.indexOf('function installedWebApp(',begin);
 assert.ok(begin>first&&end>begin);
 const guide=vm.runInNewContext(app.slice(begin,end)+';webAppInstallGuide',{String,Number});
 assert.equal(guide('Macintosh; Intel Mac OS X 10_15',false,false,5).mode,'ios');
 assert.equal(guide('Macintosh; Intel Mac OS X 10_15',false,false,0).mode,'browser');
 assert.equal(guide('Toshiba VIDAA',false,true,0).mode,'tv');
});

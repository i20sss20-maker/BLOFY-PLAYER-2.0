import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {normalizeAnalyticsPage,cleanAnalyticsEvent} from '../src/site-analytics.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('campaign hub is part of the authenticated BLOFY commerce administration',()=>{
 const html=read('../web/store-inventory.html');
 for(const id of [
  'campaign-hub','campaign-name','campaign-platform','campaign-destination',
  'campaign-coupon','campaign-share-link','campaign-share-text','campaign-link-form',
  'campaign-copy-link','campaign-copy-text','campaign-days','campaign-report-list',
  'campaign-summary-metrics','campaign-report-status','campaign-report-refresh'
 ]){
  assert.ok(html.includes('id="'+id+'"'),'Missing campaign UI '+id);
 }
 assert.match(html,/href="#campaign-hub"/);
 assert.match(html,/لا ترسل رسائل تلقائيًا/);
 assert.match(html,/وفق موافقة الزائر/);
 assert.match(html,/ولا تعني مبيعات أو أرباحًا منسوبة للحملات/);
 const server=read('../src/server.mjs');
 assert.match(html,/src="\/admin\/store-inventory\/app\.js"/);
 assert.match(server,/siteAnalytics\(req,res,requestUrl\)/);
});

test('campaign builder allows only public permitted URLs and actual active coupons',()=>{
 const js=read('../web/store-inventory.js');
 assert.doesNotThrow(()=>new Script(js));
 assert.match(js,/const campaignSources=new Set/);
 assert.match(js,/const campaignDestinations=new Set/);
 assert.match(js,/^\s*const campaignValidName=\/\^\[a-z0-9_-\]/m);
 assert.match(js,/new URL\(destination,'https:\/\/blofyplayer\.com'\)/);
 for(const tag of ['utm_source','utm_medium','utm_campaign']){
  assert.ok(js.includes("url.searchParams.set('"+tag+"'"),'Missing attribution '+tag);
 }
 assert.match(js,/row\.active===true/);
 assert.match(js,/Date\.parse\(row\.expires_at\)>Date\.now\(\)/);
 assert.match(js,/Number\(row\.paid_uses\|\|0\)<Number\(row\.max_uses\|\|0\)/);
 assert.match(js,/activeCampaignCoupons\.find/);
 assert.match(js,/clipboard\.writeText\(value\)/);
 assert.match(js,/campaign\.textContent=String\(row\.campaign/);
 assert.doesNotMatch(js,/eval\(|new Function\(|innerHTML\s*=/);
});

test('campaign reports only use first-party consented aggregates, never invent sale attribution',()=>{
 const js=read('../web/store-inventory.js');
 assert.match(js,/\/api\/v1\/admin\/site-analytics\/summary\?days=/);
 assert.match(js,/data\.source!=='consented_first_party'/);
 assert.match(js,/جلسات وافقت على القياس/);
 assert.match(js,/إجمالي المتجر؛ ليست منسوبة لهذه الحملات/);
 assert.match(js,/textContent=String\(row\.campaign/);
 const css=read('../web/store-inventory.css');
 assert.match(css,/\.campaign-hub-grid/);
 assert.match(css,/@media\(max-width:550px\)/);
 assert.doesNotMatch(js,/\/api\/v1\/store\/checkout.*campaign|sendMarketing|massSend|bulkMail/i);
});

test('store assistant is supported by consent-only analytics and never emits private identifiers',()=>{
 assert.equal(normalizeAnalyticsPage('/store/assistant'),'/store/assistant');
 const valid={
  event:'page_view',page:'/store/assistant',source:'whatsapp',
  medium:'message',campaign:'winter_blofy',
  device:'mobile',sessionId:'d9f05130-f3d9-4e10-91f0-4f3ad46a7b82'
 };
 assert.equal(cleanAnalyticsEvent(valid)?.campaign,'winter_blofy');
 assert.equal(cleanAnalyticsEvent({...valid,page:'/store/account/private/1'}),null);
 const script=read('../src/server.mjs');
 assert.match(script,/withPublicAnalytics\(raw\.toString\('utf8'\)\)/);
 assert.match(script,/PUBLIC_ANALYTICS_CSP/);
});

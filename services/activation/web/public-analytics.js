/* BLOFY public-site analytics: no request to Google before an explicit opt-in. */
(function () {
  'use strict';
  var measurementId = 'G-2DYE5WB8BT';
  var preferenceKey = 'blofy.analytics.consent.v1';
  var publicPaths = ['/', '/shop', '/shop/', '/guide', '/guide/', '/support', '/support/', '/downloads', '/downloads/', '/releases', '/releases/', '/en', '/en/', '/es', '/es/', '/fr', '/fr/', '/products/stream', '/products/xtream', '/store/offers', '/store/offers/', '/store/cart', '/store/cart/', '/store/trial', '/store/trial/', '/store/about', '/store/about/', '/store/faq', '/store/faq/', '/store/contact', '/store/contact/', '/store/terms', '/store/terms/'];
  if (publicPaths.indexOf(window.location.pathname) === -1) return;

  var active = false;
  var banner;
  var settings;
  var pagePath = window.location.pathname === '/' ? '/' : window.location.pathname.replace(/\/$/, '');

  // Attribution is limited to explicit public campaign parameters: never forward arbitrary queries.
  function campaignQuery() {
    var allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var input = new URLSearchParams(window.location.search);
    var output = new URLSearchParams();
    allowed.forEach(function (key) {
      var value = input.get(key);
      if (value && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) output.set(key, value);
    });
    return output.toString() ? '?' + output.toString() : '';
  }
  function externalReferrerOrigin() {
    try {
      var referrer = new URL(document.referrer);
      if (referrer.protocol === 'https:' && referrer.hostname !== 'blofyplayer.com' &&
          referrer.hostname !== 'www.blofyplayer.com') return referrer.origin;
    } catch (_) { /* missing or malformed referrer */ }
    return '';
  }
  function preference() {
    try { return localStorage.getItem(preferenceKey); } catch (_) { return null; }
  }
  function remember(value) {
    try { localStorage.setItem(preferenceKey, value); } catch (_) { /* private browsing */ }
  }

  // The only persisted identifier is a random per-tab, session-scoped ID.
  // The backend stores a rotated HMAC proof, never the ID itself.
  function analyticsSession() {
    // Do not invent a fingerprint or predictable identifier on older browsers.
    if(typeof crypto==='undefined'||typeof crypto.randomUUID!=='function')return null;
    try {
      var existing = sessionStorage.getItem('blofy.analytics.tab-session.v1');
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
      var key=crypto.randomUUID();
      sessionStorage.setItem('blofy.analytics.tab-session.v1',key);
      return key;
    } catch (_) {
      try{return crypto.randomUUID();}catch(_){return null;}
    }
  }
  function safeTag(value) {
    value=String(value||'').trim().toLowerCase();
    return /^[a-z0-9_-]{1,48}$/.test(value)?value:'';
  }
  function safeAttribution() {
    var query = new URLSearchParams(window.location.search);
    var fresh={
      source:safeTag(query.get('utm_source')),
      medium:safeTag(query.get('utm_medium')),
      campaign:safeTag(query.get('utm_campaign'))
    };
    try {
      if(fresh.source)sessionStorage.setItem('blofy.analytics.campaign.v1',JSON.stringify(fresh));
      else {
        var saved=JSON.parse(sessionStorage.getItem('blofy.analytics.campaign.v1')||'{}');
        if(saved&&saved.source){
          fresh.source=safeTag(saved.source);
          fresh.medium=safeTag(saved.medium);
          fresh.campaign=safeTag(saved.campaign);
        }
      }
    } catch (_) { /* disabled session storage */ }
    if(!fresh.source){
      var host='';
      try{host=new URL(document.referrer).hostname.toLowerCase();}catch(_){}
      if(/(^|\.)google\./.test(host))fresh.source='google';
      else if(/(^|\.)bing\.com$/.test(host))fresh.source='bing';
      else if(/(^|\.)snapchat\.com$/.test(host))fresh.source='snapchat';
      else if(/(^|\.)instagram\.com$/.test(host))fresh.source='instagram';
      else if(/(^|\.)tiktok\.com$/.test(host))fresh.source='tiktok';
      else if(/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host))fresh.source='x';
      else if(/(^|\.)facebook\.com$/.test(host))fresh.source='facebook';
      else if(/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(host))fresh.source='whatsapp';
      else if(host && host!=='blofyplayer.com' && host!=='www.blofyplayer.com')fresh.source='referral';
      else fresh.source='direct';
    }
    return {source:fresh.source||'direct',medium:fresh.medium||'none',campaign:fresh.campaign||'none'};
  }
  function deviceClass(){
    var width=window.innerWidth||0;
    return width<=700?'mobile':width<=1024?'tablet':'desktop';
  }
  function sendFirstParty(name){
    if(!active||!name)return;
    var session=analyticsSession();
    if(!session)return;
    var attr=safeAttribution();
    var event={event:name,page:pagePath,sessionId:session,
      source:attr.source,medium:attr.medium,campaign:attr.campaign,device:deviceClass()};
    try{
      void fetch('/api/v1/site-analytics/collect',{
        method:'POST',headers:{'content-type':'application/json'},credentials:'omit',
        keepalive:true,body:JSON.stringify(event)
      }).catch(function(){});
    }catch(_){}
  }
  function trackPublicEvent(name){
    if(!active)return;
    sendFirstParty(name);
    if(window.gtag)window.gtag('event','blofy_'+name,{page_path:pagePath});
  }

  function startMeasurement() {
    if (active) return;
    active = true;
    window.BLOFYAnalytics={track:trackPublicEvent,attribution:function(){return active?safeAttribution():null;}};
    sendFirstParty('page_view');
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      page_location: 'https://blofyplayer.com' + pagePath + campaignQuery(),
      page_referrer: externalReferrerOrigin(),
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(script);
  }
  function sendPublicClick(event) {
    if (!active || !window.gtag || !(event.target instanceof Element)) return;
    var link = event.target.closest('a[href]');
    if (!link) {
      var button=event.target.closest('button');
      if(button && (button.hasAttribute('data-buy')||button.id==='bundle-buy'))sendFirstParty('checkout_click');
      else if(button&&button.id==='coupon-preview')sendFirstParty('coupon_check');
      return;
    }
    var href = link.getAttribute('href') || '';
    var eventName = null;
    if (/^https:\/\/play\.google\.com\/store\/apps\/details/.test(href)) eventName = 'google_play_click';
    else if (href === '/downloads' || href === 'https://blofyplayer.com/downloads') eventName = 'downloads_page_click';
    else if (/^\/(?:download\/latest\.apk|latest\.apk|apk)$/.test(href) ||
      /^https:\/\/updates\.blofyplayer\.com\/(?:d\/blofy|download\/latest\.apk|latest\.apk|apk)$/.test(href) ||
      /^https:\/\/[^/?#]+\/[^?#]+\.apk(?:\?[^#]*)?$/.test(href)) eventName = 'apk_download_click';
    else if (/^https:\/\/(api\.whatsapp\.com|wa\.me)\//.test(href)) eventName = 'whatsapp_link_click';
    else if (/^https:\/\/t\.me\/share\/url/.test(href)) eventName = 'telegram_share_click';
    else if (/^https:\/\/(?:twitter\.com|x\.com)\/intent\/tweet/.test(href)) eventName = 'x_share_click';
    if (eventName) window.gtag('event', eventName, { page_path: pagePath });
    if(eventName==='whatsapp_link_click')sendFirstParty('whatsapp_click');
    else if(eventName==='apk_download_click'||eventName==='downloads_page_click')sendFirstParty('download_click');
    var targetPath=href.split('?')[0].split('#')[0];
    if(targetPath.endsWith('/')&&targetPath!=='/')targetPath=targetPath.slice(0,-1);
    if(targetPath==='/store/cart'&&href.indexOf('add=')!==-1)sendFirstParty('cart_add');
    else if(targetPath==='/store/offers')sendFirstParty('offer_click');
    else if(targetPath==='/products/stream'||targetPath==='/products/xtream')sendFirstParty('product_click');
    else if(targetPath==='/store/trial')sendFirstParty('trial_click');
    // Device identifiers, credentials, URL parameters and form values are never forwarded.
  }
  function setChoice(value) {
    remember(value);
    if (banner) { banner.remove(); banner = null; }
    if (settings) settings.hidden = false;
    if (value === 'accepted') startMeasurement();
    else if (active) {
      try{sessionStorage.removeItem('blofy.analytics.tab-session.v1');sessionStorage.removeItem('blofy.analytics.campaign.v1');}catch(_){}
      window.location.reload(); // Withdraw analytics consent and remove in-tab attribution.
    }
  }
  function showChoice() {
    if (banner) return;
    banner = document.createElement('section');
    banner.setAttribute('aria-label', ['/en','/es','/fr'].indexOf(pagePath) >= 0 ? 'Website analytics consent' : 'التحكم في إحصاءات الموقع');
    banner.setAttribute('role', 'region');
    banner.dir = ['/en', '/es', '/fr'].indexOf(pagePath) >= 0 ? 'ltr' : 'rtl';
    banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;max-width:470px;z-index:99999;background:#181322;color:#fff;border:1px solid #8652c4;border-radius:16px;padding:16px;box-shadow:0 15px 42px #0008;font:14px/1.8 system-ui,Tahoma,sans-serif';
    if (pagePath === '/es') banner.innerHTML = "<strong>Estadísticas del sitio BLOFY PLAYER</strong><p style=\"margin:8px 0 12px\">Solo con tu permiso registramos visitas, campañas y clics agregados en BLOFY, además de Google Analytics. No guardamos IP, datos de identificación ni códigos de vinculación. <a href=\"/privacy\" style=\"color:#d7baff\">Privacidad</a></p><div style=\"display:flex;gap:10px;flex-wrap:wrap\"><button type=\"button\" data-ga-accept style=\"cursor:pointer;padding:8px 18px;border:0;border-radius:9px;background:#a36bff;color:#111;font:inherit\">Aceptar</button><button type=\"button\" data-ga-reject style=\"cursor:pointer;padding:8px 18px;border:1px solid #7d6992;border-radius:9px;background:transparent;color:#fff;font:inherit\">Rechazar</button></div>";
    else if (pagePath === '/fr') banner.innerHTML = "<strong>Statistiques du site BLOFY PLAYER</strong><p style=\"margin:8px 0 12px\">Avec votre accord, nous mesurons les visites, campagnes et clics agrégés chez BLOFY ainsi que dans Google Analytics. Aucune IP ni donnée d'identification ou code d'association n'est conservé. <a href=\"/privacy\" style=\"color:#d7baff\">Confidentialité</a></p><div style=\"display:flex;gap:10px;flex-wrap:wrap\"><button type=\"button\" data-ga-accept style=\"cursor:pointer;padding:8px 18px;border:0;border-radius:9px;background:#a36bff;color:#111;font:inherit\">Accepter</button><button type=\"button\" data-ga-reject style=\"cursor:pointer;padding:8px 18px;border:1px solid #7d6992;border-radius:9px;background:transparent;color:#fff;font:inherit\">Refuser</button></div>";
    else if (pagePath === '/en') banner.innerHTML = "<strong>BLOFY PLAYER site analytics</strong><p style=\"margin:8px 0 12px\">Only with consent we measure aggregated page visits, campaign sources and clicks on BLOFY servers, plus Google Analytics. No IP, device ID, pairing code or playlist credentials are stored. You can withdraw consent. <a href=\"/privacy\" style=\"color:#d7baff\">Privacy</a></p><div style=\"display:flex;gap:10px;flex-wrap:wrap\"><button type=\"button\" data-ga-accept style=\"cursor:pointer;padding:8px 18px;border:0;border-radius:9px;background:#a36bff;color:#111;font:inherit\">Accept</button><button type=\"button\" data-ga-reject style=\"cursor:pointer;padding:8px 18px;border:1px solid #7d6992;border-radius:9px;background:transparent;color:#fff;font:inherit\">Reject</button></div>";
    else banner.innerHTML = '<strong>إحصاءات BLOFY PLAYER</strong><p style="margin:8px 0 12px">بموافقتك فقط نجمع أعداد الزيارات والتفاعلات ومصادر الحملات بشكل مجمّع على خادم BLOFY، ونستخدم Google Analytics لصفحات الموقع العامة. لا نحفظ IP أو معلومات التعريف أو رموز الربط. يمكنك سحب موافقتك من الإعدادات. <a href="/privacy" style="color:#d7baff">الخصوصية</a></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-ga-accept style="cursor:pointer;padding:8px 18px;border:0;border-radius:9px;background:#a36bff;color:#111;font:inherit">موافق</button><button type="button" data-ga-reject style="cursor:pointer;padding:8px 18px;border:1px solid #7d6992;border-radius:9px;background:transparent;color:#fff;font:inherit">رفض</button></div>';
    document.body.appendChild(banner);
    banner.querySelector('[data-ga-accept]').addEventListener('click', function () { setChoice('accepted'); });
    banner.querySelector('[data-ga-reject]').addEventListener('click', function () { setChoice('rejected'); });
  }
  function init() {
    settings = document.createElement('button');
    settings.type = 'button';
    settings.textContent = pagePath === '/es' ? 'Opciones de analítica' : pagePath === '/fr' ? 'Paramètres statistiques' : pagePath === '/en' ? 'Analytics settings' : 'إعدادات الإحصاءات';
    settings.setAttribute('aria-label', ['/en','/es','/fr'].indexOf(pagePath) >= 0 ? 'Change consent for website analytics' : 'تغيير الموافقة على إحصاءات الموقع');
    settings.style.cssText = 'position:fixed;left:10px;bottom:8px;z-index:99998;cursor:pointer;border:1px solid #6f557f;border-radius:9px;background:#171322;color:#e7d9ff;padding:5px 9px;font:11px system-ui,Tahoma,sans-serif';
    settings.addEventListener('click', showChoice);
    document.body.appendChild(settings);
    var choice = preference();
    settings.hidden = choice !== 'accepted' && choice !== 'rejected';
    if (choice === 'accepted') startMeasurement();
    else if (choice !== 'rejected') showChoice();
    document.addEventListener('click', sendPublicClick);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

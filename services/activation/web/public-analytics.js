/* BLOFY public-site analytics: no request to Google before an explicit opt-in. */
(function () {
  'use strict';
  var measurementId = 'G-2DYE5WB8BT';
  var preferenceKey = 'blofy.analytics.consent.v1';
  var publicPaths = ['/', '/guide', '/guide/', '/support', '/support/'];
  if (publicPaths.indexOf(window.location.pathname) === -1) return;

  var active = false;
  var banner;
  var settings;
  var pagePath = window.location.pathname === '/' ? '/' : window.location.pathname.replace(/\/$/, '');

  function preference() {
    try { return localStorage.getItem(preferenceKey); } catch (_) { return null; }
  }
  function remember(value) {
    try { localStorage.setItem(preferenceKey, value); } catch (_) { /* private browsing */ }
  }
  function startMeasurement() {
    if (active) return;
    active = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      page_location: 'https://blofyplayer.com' + pagePath,
      page_referrer: '',
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
    if (!link) return;
    var href = link.getAttribute('href') || '';
    var eventName = null;
    if (/^https:\/\/play\.google\.com\/store\/apps\/details/.test(href)) eventName = 'google_play_click';
    else if (href === '/downloads' || href === 'https://blofyplayer.com/downloads') eventName = 'downloads_page_click';
    else if (/^https:\/\/(api\.whatsapp\.com|wa\.me)\//.test(href)) eventName = 'whatsapp_link_click';
    if (eventName) window.gtag('event', eventName, { page_path: pagePath });
    // Device identifiers, credentials, URL parameters and form values are never forwarded.
  }
  function setChoice(value) {
    remember(value);
    if (banner) { banner.remove(); banner = null; }
    if (settings) settings.hidden = false;
    if (value === 'accepted') startMeasurement();
    else if (active) window.location.reload(); // Withdraw previously granted consent.
  }
  function showChoice() {
    if (banner) return;
    banner = document.createElement('section');
    banner.setAttribute('aria-label', 'التحكم في إحصاءات الموقع');
    banner.setAttribute('role', 'region');
    banner.dir = 'rtl';
    banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;max-width:470px;z-index:99999;background:#181322;color:#fff;border:1px solid #8652c4;border-radius:16px;padding:16px;box-shadow:0 15px 42px #0008;font:14px/1.8 system-ui,Tahoma,sans-serif';
    banner.innerHTML = '<strong>إحصاءات BLOFY PLAYER</strong><p style="margin:8px 0 12px">نستخدم Google Analytics بعد موافقتك فقط لمعرفة أداء صفحات الموقع العامة. لا نرسل بيانات الجهاز أو رموز الربط. <a href="/privacy" style="color:#d7baff">الخصوصية</a></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-ga-accept style="cursor:pointer;padding:8px 18px;border:0;border-radius:9px;background:#a36bff;color:#111;font:inherit">موافق</button><button type="button" data-ga-reject style="cursor:pointer;padding:8px 18px;border:1px solid #7d6992;border-radius:9px;background:transparent;color:#fff;font:inherit">رفض</button></div>';
    document.body.appendChild(banner);
    banner.querySelector('[data-ga-accept]').addEventListener('click', function () { setChoice('accepted'); });
    banner.querySelector('[data-ga-reject]').addEventListener('click', function () { setChoice('rejected'); });
  }
  function init() {
    settings = document.createElement('button');
    settings.type = 'button';
    settings.textContent = 'إعدادات الإحصاءات';
    settings.setAttribute('aria-label', 'تغيير الموافقة على إحصاءات الموقع');
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

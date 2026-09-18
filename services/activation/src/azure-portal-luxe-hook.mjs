import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal', '/connect']);
const MARKER = 'data-blofy-azure-luxe="1"';

const luxeStyles = String.raw`
<style data-blofy-azure-luxe="1">
  :root{
    --azure-luxe-purple:#9f5cff;
    --azure-luxe-violet:#6f32e8;
    --azure-luxe-line:rgba(194,156,255,.24);
    --azure-luxe-glow:rgba(139,55,255,.22);
    --azure-luxe-deep:#08060d;
  }
  html{background:#07060b!important}
  body{
    background:
      radial-gradient(circle at 78% -14%,rgba(129,54,232,.34),transparent 35rem),
      radial-gradient(circle at -8% 76%,rgba(52,48,180,.16),transparent 32rem),
      linear-gradient(145deg,#07060b 0%,#0b0812 50%,#08070d 100%)!important;
  }
  body::before{
    opacity:.82!important;
    background:
      radial-gradient(circle at 88% 19%,rgba(166,86,255,.17),transparent 24rem),
      radial-gradient(circle at 8% 84%,rgba(72,73,224,.10),transparent 28rem)!important;
  }
  body::after{
    content:"";
    position:fixed;
    inset:0;
    z-index:-1;
    pointer-events:none;
    opacity:.11;
    background-image:
      linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
    background-size:48px 48px;
    mask-image:linear-gradient(to bottom,rgba(0,0,0,.9),transparent 78%);
  }
  .topbar{
    position:sticky!important;
    top:0;
    z-index:60;
    width:100%!important;
    min-height:76px!important;
    padding-inline:max(20px,calc((100vw - 1180px)/2))!important;
    background:linear-gradient(180deg,rgba(10,8,16,.94),rgba(10,8,16,.72))!important;
    border-bottom:1px solid rgba(255,255,255,.07)!important;
    box-shadow:0 12px 45px rgba(0,0,0,.18)!important;
    backdrop-filter:blur(22px) saturate(135%);
    -webkit-backdrop-filter:blur(22px) saturate(135%);
  }
  .brand{gap:13px!important}
  .brand-logo{
    width:50px!important;height:50px!important;
    filter:drop-shadow(0 10px 28px rgba(151,72,255,.42))!important;
  }
  .brand-copy strong{font-size:18px!important;letter-spacing:.11em!important}
  .brand-copy span{color:#bd86ff!important;letter-spacing:.30em!important}
  .language-control{
    border-color:rgba(183,137,255,.23)!important;
    background:rgba(20,16,31,.74)!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 30px rgba(0,0,0,.16)!important;
  }
  .portal{padding-top:46px!important}
  .login-layout{gap:clamp(48px,7.5vw,108px)!important}
  .hero-panel{position:relative}
  .hero-panel::before{
    content:"BLOFY";
    position:absolute;
    inset-inline-start:-10px;
    top:-58px;
    z-index:-1;
    color:rgba(255,255,255,.018);
    font:900 clamp(90px,14vw,170px)/1 "Segoe UI",sans-serif;
    letter-spacing:-.06em;
    pointer-events:none;
  }
  .eyebrow{
    border-color:rgba(181,128,255,.34)!important;
    background:linear-gradient(110deg,rgba(125,51,224,.16),rgba(74,33,130,.07))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 9px 28px rgba(77,31,148,.12)!important;
  }
  .eyebrow-dot{box-shadow:0 0 0 5px rgba(82,223,154,.09),0 0 22px rgba(82,223,154,.38)!important}
  .hero-panel h1{
    font-size:clamp(48px,6.35vw,80px)!important;
    line-height:1.04!important;
    text-wrap:balance;
    text-shadow:0 18px 55px rgba(99,41,190,.14);
  }
  .hero-panel h1 span{
    background:linear-gradient(180deg,#fff 0%,#fff 35%,#e7d9ff 62%,#b16cff 100%)!important;
    -webkit-background-clip:text!important;background-clip:text!important;
  }
  .hero-panel>p{color:#bbb5c6!important;font-size:17px!important;max-width:540px!important}
  .flow-steps{gap:9px!important;margin-top:30px!important}
  .flow-step{
    padding:9px 14px!important;
    border-color:rgba(172,115,255,.21)!important;
    background:rgba(22,16,33,.58)!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
    backdrop-filter:blur(10px);
  }
  .flow-step strong{color:#e2dcec!important;font-size:11.8px!important}
  .auth-card{
    isolation:isolate;
    border-color:rgba(185,139,255,.28)!important;
    background:
      radial-gradient(circle at 90% 0,rgba(151,67,255,.17),transparent 18rem),
      linear-gradient(155deg,rgba(28,22,43,.96),rgba(11,9,17,.965))!important;
    box-shadow:
      0 42px 105px rgba(0,0,0,.48),
      0 0 0 1px rgba(255,255,255,.015) inset,
      0 1px 0 rgba(255,255,255,.055) inset!important;
  }
  .auth-card::before{
    height:1px!important;
    background:linear-gradient(90deg,transparent,rgba(195,143,255,.95),rgba(127,64,239,.7),transparent)!important;
  }
  .auth-card::after{
    content:"";
    position:absolute;
    width:210px;height:210px;
    border-radius:50%;
    inset-inline-end:-112px;bottom:-125px;
    z-index:-1;
    background:rgba(133,52,229,.15);
    filter:blur(2px);
    pointer-events:none;
  }
  .device-illustration{
    border-color:rgba(186,132,255,.32)!important;
    background:linear-gradient(145deg,rgba(148,67,255,.19),rgba(64,32,123,.08))!important;
    box-shadow:0 14px 38px rgba(85,40,166,.28),inset 0 1px 0 rgba(255,255,255,.06)!important;
  }
  .auth-card h2{font-size:clamp(27px,3vw,34px)!important}
  .auth-subtitle{color:#aaa4b6!important}
  .field label{color:#ded9e7!important;font-size:12.8px!important}
  input,select{
    height:55px!important;
    border-color:rgba(177,138,224,.20)!important;
    background:linear-gradient(180deg,#0d0a14,#0a0810)!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 9px 24px rgba(0,0,0,.10)!important;
  }
  input:hover,select:hover{border-color:rgba(208,176,255,.34)!important}
  input:focus,select:focus{
    border-color:#9f5cff!important;
    background:#0f0b17!important;
    box-shadow:0 0 0 4px rgba(159,92,255,.11),0 14px 32px rgba(0,0,0,.15)!important;
  }
  #activationCode{
    letter-spacing:.36em!important;
    font-size:21px!important;
    color:#f2e9ff!important;
  }
  .primary-button{
    background:linear-gradient(115deg,#7130e8 0%,#9947f7 52%,#b965ff 100%)!important;
    box-shadow:0 16px 36px rgba(112,43,226,.29),inset 0 1px 0 rgba(255,255,255,.18)!important;
  }
  .primary-button:hover{filter:brightness(1.07) saturate(1.08)!important;transform:translateY(-1px)!important}
  .secondary{
    background:rgba(255,255,255,.045)!important;
    border-color:rgba(255,255,255,.10)!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
  }
  .secure-note{
    border-color:rgba(111,221,171,.17)!important;
    background:linear-gradient(110deg,rgba(47,133,96,.08),rgba(17,13,24,.12))!important;
  }
  .dashboard-panel,.editor-card{
    border-color:rgba(184,140,255,.24)!important;
    background:
      radial-gradient(circle at 94% 0,rgba(134,56,229,.11),transparent 22rem),
      linear-gradient(155deg,rgba(24,19,37,.96),rgba(10,8,15,.96))!important;
    box-shadow:0 32px 90px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.035)!important;
  }
  .dashboard-head{
    border-bottom-color:rgba(255,255,255,.07)!important;
    background:linear-gradient(180deg,rgba(255,255,255,.018),transparent)!important;
  }
  .device-chip{
    border-color:rgba(82,223,154,.20)!important;
    background:rgba(82,223,154,.065)!important;
    color:#afeed2!important;
  }
  .playlist{
    border-color:rgba(180,139,226,.17)!important;
    background:linear-gradient(145deg,rgba(24,19,35,.86),rgba(14,11,20,.88))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important;
    transition:border-color .18s ease,background .18s ease,transform .18s ease,box-shadow .18s ease!important;
  }
  @media(hover:hover){
    .playlist:hover{
      border-color:rgba(189,139,255,.34)!important;
      background:linear-gradient(145deg,rgba(31,23,46,.94),rgba(16,12,24,.94))!important;
      transform:translateY(-2px);
      box-shadow:0 18px 42px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.035)!important;
    }
  }
  .toggle-row{
    border-color:rgba(179,137,230,.18)!important;
    background:rgba(255,255,255,.018)!important;
  }
  .legal{color:#696472!important}

  /* BLOFY premium commercial refresh — visual only, no portal behavior changes. */
  .topbar .brand{
    padding:7px 13px 7px 8px;
    border:1px solid rgba(193,153,255,.16);
    border-radius:20px;
    background:linear-gradient(135deg,rgba(33,25,49,.72),rgba(14,11,21,.58));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 14px 40px rgba(0,0,0,.16);
    backdrop-filter:blur(18px);
    -webkit-backdrop-filter:blur(18px);
  }
  .brand-logo{
    width:58px!important;height:58px!important;
    padding:6px;
    border:1px solid rgba(203,166,255,.24);
    border-radius:18px;
    background:
      radial-gradient(circle at 35% 20%,rgba(205,171,255,.22),transparent 48%),
      linear-gradient(145deg,rgba(144,70,255,.18),rgba(60,31,112,.08));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 16px 34px rgba(79,37,145,.25);
    filter:drop-shadow(0 12px 28px rgba(151,72,255,.35))!important;
  }
  .brand-copy strong{
    font-size:19px!important;
    font-weight:850;
    letter-spacing:.13em!important;
    text-shadow:0 8px 24px rgba(154,91,255,.16);
  }
  .brand-copy span{color:#c79bff!important;font-size:9px!important;letter-spacing:.36em!important}
  .language-control{
    height:50px!important;
    border-radius:17px!important;
    background:linear-gradient(145deg,rgba(29,23,43,.82),rgba(14,11,20,.82))!important;
  }

  .portal{width:min(1220px,calc(100% - 36px))!important;padding-top:54px!important}
  .login-layout{grid-template-columns:minmax(0,1.04fr) minmax(410px,.96fr)!important;gap:clamp(54px,8vw,118px)!important}
  .hero-panel{isolation:isolate;position:relative;padding-block:28px}
  .hero-panel::after{
    content:"";
    position:absolute;
    width:300px;height:300px;
    inset-inline-end:-24px;
    top:-88px;
    z-index:-1;
    pointer-events:none;
    opacity:.065;
    background:url('/blofy-logo.png') center/contain no-repeat;
    filter:drop-shadow(0 35px 70px rgba(136,63,238,.48));
  }
  .eyebrow{
    padding:10px 15px!important;
    border-color:rgba(196,150,255,.38)!important;
    background:linear-gradient(105deg,rgba(145,70,235,.18),rgba(59,35,95,.10))!important;
    color:#d0a9ff!important;
  }
  .hero-panel h1{
    margin-top:30px!important;
    font-size:clamp(52px,6.7vw,86px)!important;
    font-weight:850;
    line-height:1.01!important;
    letter-spacing:-.055em!important;
  }
  [dir="rtl"] .hero-panel h1{letter-spacing:0!important}
  .hero-panel h1 span{
    background:linear-gradient(180deg,#fff 0%,#fff 34%,#eee5ff 55%,#c99cff 76%,#9a50ff 100%)!important;
    -webkit-background-clip:text!important;background-clip:text!important;
    filter:drop-shadow(0 16px 34px rgba(119,55,213,.10));
  }
  .hero-panel>p{font-size:17.5px!important;line-height:1.95!important;color:#bbb4c7!important}
  .flow-steps{gap:10px!important;margin-top:34px!important}
  .flow-step{
    padding:11px 16px!important;
    border-radius:999px!important;
    background:linear-gradient(120deg,rgba(33,27,47,.68),rgba(18,14,27,.64))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 10px 28px rgba(0,0,0,.10)!important;
  }

  .auth-card{
    padding:42px!important;
    border-radius:34px!important;
    border-color:rgba(202,163,255,.30)!important;
    background:
      radial-gradient(circle at 88% -2%,rgba(164,82,255,.20),transparent 19rem),
      radial-gradient(circle at -14% 110%,rgba(72,63,202,.11),transparent 18rem),
      linear-gradient(155deg,rgba(29,23,44,.975),rgba(10,8,16,.98))!important;
    box-shadow:
      0 52px 130px rgba(0,0,0,.52),
      0 0 0 1px rgba(255,255,255,.018) inset,
      0 1px 0 rgba(255,255,255,.07) inset!important;
  }
  .auth-card::before{
    height:2px!important;
    background:linear-gradient(90deg,transparent 5%,rgba(198,146,255,.95) 46%,rgba(113,66,238,.78) 72%,transparent 96%)!important;
  }
  .device-illustration{
    width:86px!important;height:86px!important;
    padding:9px!important;
    border-radius:23px!important;
    border-color:rgba(210,174,255,.32)!important;
    background:
      radial-gradient(circle at 38% 20%,rgba(219,190,255,.22),transparent 48%),
      linear-gradient(145deg,rgba(151,70,255,.22),rgba(62,31,119,.11))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 46px rgba(80,37,150,.34)!important;
  }
  .device-illustration img{filter:drop-shadow(0 10px 18px rgba(158,85,255,.32))}
  .auth-card h2{font-size:clamp(30px,3vw,38px)!important;font-weight:850}
  .auth-subtitle{font-size:14px!important;line-height:1.85!important;margin-bottom:30px!important}
  .field{margin-top:20px!important}
  .field label{margin-bottom:10px!important;color:#e7e1ee!important}
  input,select{
    height:58px!important;
    border-radius:18px!important;
    border-color:rgba(195,159,241,.22)!important;
    background:linear-gradient(180deg,rgba(14,11,21,.98),rgba(9,7,14,.98))!important;
  }
  input:focus,select:focus{
    border-color:#aa6cff!important;
    box-shadow:0 0 0 4px rgba(159,92,255,.12),0 18px 38px rgba(0,0,0,.18)!important;
  }
  .primary-button{
    min-height:58px!important;
    border-radius:18px!important;
    background:linear-gradient(115deg,#6f2ce8 0%,#9347f5 45%,#b967ff 100%)!important;
    box-shadow:0 18px 44px rgba(115,42,230,.32),inset 0 1px 0 rgba(255,255,255,.22)!important;
  }
  .secure-note{
    margin-top:20px!important;
    padding:11px 13px!important;
    border:1px solid rgba(111,221,171,.13)!important;
    border-radius:13px!important;
  }

  .dashboard-panel{
    position:relative!important;
    overflow:hidden!important;
    border-radius:34px!important;
    border-color:rgba(196,155,255,.25)!important;
    box-shadow:0 44px 120px rgba(0,0,0,.40),inset 0 1px 0 rgba(255,255,255,.045)!important;
  }
  .dashboard-panel::after{
    content:"";
    position:absolute;
    width:310px;height:310px;
    inset-inline-end:-105px;
    top:-105px;
    z-index:0;
    opacity:.035;
    pointer-events:none;
    background:url('/blofy-logo.png') center/contain no-repeat;
    filter:drop-shadow(0 28px 60px rgba(142,64,239,.40));
  }
  .dashboard-panel>*{position:relative;z-index:1}
  .dashboard-head{
    padding:31px 32px!important;
    background:
      radial-gradient(circle at 90% 0,rgba(157,75,255,.09),transparent 20rem),
      linear-gradient(180deg,rgba(255,255,255,.025),transparent)!important;
  }
  .dashboard-title-wrap h1{font-size:clamp(30px,4vw,42px)!important;font-weight:850}
  .dashboard-title-wrap p{font-size:13.5px!important;line-height:1.75!important}
  .device-chip{
    padding:9px 12px!important;
    border-radius:999px!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.03)!important;
  }
  .dashboard-head .actions{gap:9px!important}
  #blofyRenewBtn{
    min-height:50px!important;
    padding:0 18px!important;
    border-radius:16px!important;
    border:1px solid rgba(89,232,169,.24)!important;
    background:linear-gradient(120deg,rgba(67,191,139,.16),rgba(43,131,98,.10))!important;
    color:#b7f5d8!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 12px 30px rgba(29,111,78,.12)!important;
  }
  #blofyRenewBtn:hover{border-color:rgba(104,244,184,.40)!important;background:linear-gradient(120deg,rgba(71,205,148,.22),rgba(47,145,105,.14))!important}
  #blofyPhoneBtn{
    min-height:50px!important;
    border-radius:16px!important;
    border-color:rgba(198,159,255,.18)!important;
    background:linear-gradient(145deg,rgba(37,29,53,.78),rgba(20,16,29,.78))!important;
    color:#e5d9f7!important;
  }
  .dashboard-head .secondary{min-height:50px!important;border-radius:16px!important}
  .playlist-content{padding:24px 28px 30px!important}
  #playlistList{gap:14px!important}
  .playlist{
    padding:20px!important;
    border-radius:21px!important;
    background:
      radial-gradient(circle at 100% 0,rgba(137,65,226,.06),transparent 15rem),
      linear-gradient(145deg,rgba(24,19,36,.90),rgba(13,10,19,.92))!important;
  }
  .playlist-icon{
    width:54px!important;height:54px!important;
    border-radius:17px!important;
    background:linear-gradient(145deg,rgba(145,74,242,.18),rgba(80,42,144,.10))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05)!important;
  }
  .playlist h3{font-size:17px!important}
  .badge{border-radius:999px!important}
  .editor-card{
    border-radius:30px!important;
    padding:30px!important;
    border-color:rgba(194,152,255,.21)!important;
    box-shadow:0 30px 80px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)!important;
  }

  .blofy-renew-modal,.blofy-contact-modal{
    background:rgba(3,2,7,.78)!important;
    backdrop-filter:blur(16px) saturate(120%)!important;
    -webkit-backdrop-filter:blur(16px) saturate(120%)!important;
  }
  .blofy-renew-card,.blofy-contact-card{
    position:relative!important;
    overflow:hidden!important;
    border-radius:28px!important;
    border-color:rgba(202,163,255,.29)!important;
    background:
      radial-gradient(circle at 90% 0,rgba(156,74,255,.18),transparent 16rem),
      linear-gradient(155deg,rgba(28,22,43,.995),rgba(10,8,16,.995))!important;
    box-shadow:0 38px 110px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.05)!important;
  }
  .blofy-renew-card{width:min(520px,100%)!important;padding:29px!important}
  .blofy-contact-card{width:min(470px,100%)!important;padding:28px!important}
  .blofy-renew-card::before,.blofy-contact-card::before{
    content:"";
    position:absolute;
    inset:0 0 auto;
    height:1px;
    background:linear-gradient(90deg,transparent,rgba(203,155,255,.9),transparent);
  }
  .blofy-renew-card::after,.blofy-contact-card::after{
    content:"";
    position:absolute;
    width:150px;height:150px;
    inset-inline-end:-56px;
    bottom:-64px;
    pointer-events:none;
    opacity:.045;
    background:url('/blofy-logo.png') center/contain no-repeat;
  }
  .blofy-renew-card h3,.blofy-contact-card h3{font-size:26px!important}
  .blofy-renew-option{
    min-height:76px!important;
    border-radius:18px!important;
    border-color:rgba(197,158,249,.18)!important;
    background:linear-gradient(145deg,rgba(25,19,37,.96),rgba(13,10,20,.96))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
    transition:transform .16s ease,border-color .16s ease,background .16s ease!important;
  }
  .blofy-renew-option:hover{
    transform:translateY(-2px)!important;
    border-color:rgba(185,116,255,.55)!important;
    background:linear-gradient(145deg,rgba(39,27,57,.98),rgba(20,14,29,.98))!important;
  }
  .blofy-renew-option small{font-size:13px!important;color:#aef0d0!important}
  .blofy-renew-close,.blofy-contact-cancel{
    border-radius:15px!important;
    background:rgba(255,255,255,.025)!important;
  }
  @media(max-width:920px){
    .topbar{padding-inline:18px!important}
    .portal{padding-top:34px!important}
    .hero-panel::before{inset-inline-start:50%;transform:translateX(-50%);top:-50px}
  }
  @media(max-width:680px){
    body::after{background-size:36px 36px;opacity:.075}
    .topbar{min-height:68px!important;padding-inline:12px!important}
    .brand-logo{width:43px!important;height:43px!important}
    .language-control{min-width:118px!important}
    .portal{padding-top:26px!important}
    .hero-panel h1{font-size:41px!important}
    .hero-panel>p{font-size:14.5px!important}
    .flow-steps{margin-top:20px!important}
    .auth-card{border-radius:25px!important}
    input,select{height:53px!important}
  }
  @media(prefers-reduced-motion:reduce){
    .playlist,.primary-button{transition:none!important}
  }
</style>`;

export function injectAzurePortalLuxe(html) {
  const source = String(html || '');
  if (!source.includes('</head>') || source.includes(MARKER)) return source;
  return source.replace('</head>', `${luxeStyles}\n</head>`);
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function azurePortalLuxeCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (req.method !== 'GET' || !PORTAL_PATHS.has(pathname)) return listener(req, res);

    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let statusMessage;
    let headers = {};
    let wroteHead = false;

    res.writeHead = function interceptedWriteHead(code, messageOrHeaders, maybeHeaders) {
      statusCode = code;
      if (typeof messageOrHeaders === 'string') {
        statusMessage = messageOrHeaders;
        headers = { ...(maybeHeaders || {}) };
      } else {
        headers = { ...(messageOrHeaders || {}) };
      }
      wroteHead = true;
      return res;
    };

    res.end = function interceptedEnd(chunk, encoding, callback) {
      if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = injectAzurePortalLuxe(body);

      res.writeHead = originalWriteHead;
      if (!wroteHead) {
        statusCode = res.statusCode;
        statusMessage = res.statusMessage;
      }
      res.removeHeader('content-length');
      res.removeHeader('transfer-encoding');
      for (const key of Object.keys(headers)) {
        if (['content-length', 'transfer-encoding'].includes(key.toLowerCase())) delete headers[key];
      }
      headers['content-length'] = Buffer.byteLength(modified);
      if (statusMessage) originalWriteHead(statusCode, statusMessage, headers);
      else originalWriteHead(statusCode, headers);
      return originalEnd(modified, 'utf8', callback);
    };

    return listener(req, res);
  });
};

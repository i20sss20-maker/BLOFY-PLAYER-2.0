'use strict';
(async () => {
  const message = document.getElementById('owner-test-status');
  const link = document.getElementById('owner-test-download');
  const size = document.getElementById('owner-test-size');
  try {
    const response = await fetch('/api/v1/releases/owner-test', {cache:'no-store'});
    if (!response.ok) throw new Error('unavailable');
    const info = await response.json();
    if (!info.ready) {
      message.textContent = 'النسخة الموقّعة ليست متاحة للتحميل بعد. لم يتم عرض أي ملف غير مكتمل.';
      return;
    }
    const url = new URL(info.downloadUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
        !url.pathname.startsWith('/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/')) {
      throw new Error('unsafe-download-url');
    }
    link.href = url.href;
    link.hidden = false;
    link.rel = 'noopener noreferrer';
    message.textContent = 'تم التحقق من توفر نسخة الاختبار الموقّعة.';
    size.textContent = 'الحجم: ' + (info.sizeBytes / 1048576).toFixed(1) + ' ميجابايت';
  } catch {
    message.textContent = 'تعذر التحقق من نسخة الاختبار حاليًا. النسخة الرسمية لم تتغير.';
  }
})();

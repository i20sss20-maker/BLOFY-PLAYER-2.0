const form = document.getElementById('test-form');
const create = document.getElementById('create');
const feedback = document.getElementById('feedback');
const checkout = document.getElementById('checkout');
const newCase = document.getElementById('new-case');
const labels = { visa: 'Visa', mastercard: 'Mastercard', mada: 'مدى', success: 'نجاح',
  decline: 'رفض', cancel: 'إلغاء', pending: 'بانتظار الدفع', paid: 'دفع مؤكد تجريبيًا',
  failed: 'فشل الدفع', cancelled: 'أُلغيت العملية', creating: 'تجهيز الجلسة',
  create_unknown: 'يلزم التحقق من حالة الجلسة', review: 'تحتاج مراجعة' };
let pendingKey = null;

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || data.order?.errorCode || 'sandbox_request_failed'), { data });
  return data;
}
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function refresh() {
  const data = await request('/api/evidence');
  const matrix = document.getElementById('matrix');
  matrix.replaceChildren();
  for (const row of data.matrix) {
    const tr = element('tr');
    tr.append(element('td', labels[row.network]));
    for (const test of row.scenarios) tr.append(element('td', test.verified ? '✓ مكتمل' : 'بانتظار', test.verified ? 'complete' : 'waiting'));
    matrix.append(tr);
  }
  const orders = document.getElementById('orders');
  orders.replaceChildren();
  if (!data.orders.length) orders.append(element('p', 'لا توجد عمليات بعد. ابدأ بعملية تجريبية.', 'muted'));
  for (const order of data.orders) {
    const article = element('article', undefined, 'order');
    const head = element('div', undefined, 'order-head');
    head.append(element('strong', (labels[order.network] || order.network) + ' · ' + labels[order.scenario]),
      element('span', labels[order.status] || 'بانتظار التحقق', 'state'));
    article.append(head, element('p', order.reference, 'reference'));
    const details = element('div', undefined, 'order-details');
    details.append(element('span', 'تحقق Geidea: ' + (order.providerVerified ? 'مؤكد' : 'بانتظار')),
      element('span', 'الإشعار الموقع: ' + (order.callbackVerified ? 'مؤكد' : 'بانتظار')),
      element('span', 'الشبكة الفعلية: ' + (labels[order.observedNetwork] || 'بانتظار')));
    article.append(details);
    if (order.errorCode) article.append(element('p', order.errorCode, 'reference error'));
    const verify = element('button', 'التحقق من Geidea', 'secondary');
    verify.type = 'button';
    verify.addEventListener('click', async () => {
      verify.disabled = true;
      try {
        await request('/api/orders/' + order.reference + '/reconcile', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        });
        await refresh();
      } catch (error) { feedback.textContent = 'تعذر التحقق: ' + error.message; }
      finally { verify.disabled = false; }
    });
    article.append(element('p'));article.append(verify);orders.append(article);
  }
}
form.addEventListener('change', () => { pendingKey = null; checkout.classList.add('hidden'); });
newCase.addEventListener('click', () => {
  pendingKey = null;
  checkout.classList.add('hidden');
  feedback.textContent = 'جاهز لعملية جديدة. اضغط تجهيز جلسة الدفع.';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (create.disabled) return;
  pendingKey ||= crypto.randomUUID();
  create.disabled = true;
  newCase.disabled = true;
  form.network.disabled = true;
  form.scenario.disabled = true;
  feedback.textContent = 'جاري تجهيز جلسة اختبار بقيمة 1.00 ريال…';
  checkout.classList.add('hidden');
  try {
    const data = await request('/api/sessions', { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': pendingKey },
      body: JSON.stringify({ network: form.network.value, scenario: form.scenario.value }),
    });
    if (data.checkoutUrl && /^https:\/\/www\.ksamerchant\.geidea\.net\/hpp\/checkout\/\?[-a-f0-9]{36}$/i.test(data.checkoutUrl)) {
      checkout.href = data.checkoutUrl;
      checkout.classList.remove('hidden');
      feedback.textContent = 'الجلسة جاهزة. افتح صفحة Geidea واستخدم بطاقة الاختبار.';
    } else feedback.textContent = 'الجلسة مسجلة. راجع آخر العمليات أو اختر سيناريو جديدًا.';
    await refresh();
  } catch (error) {
    feedback.textContent = 'تعذر تجهيز الجلسة: ' + error.message + ' — إعادة المحاولة تحفظ نفس مرجع العملية.';
  } finally {
    create.disabled = false;
    newCase.disabled = false;
    form.network.disabled = false;
    form.scenario.disabled = false;
  }
});
document.getElementById('refresh').addEventListener('click', () => refresh().catch(() => { feedback.textContent = 'تعذر تحديث النتائج.'; }));
refresh().catch(() => { feedback.textContent = 'تعذر تحميل العمليات.'; });
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 20000);

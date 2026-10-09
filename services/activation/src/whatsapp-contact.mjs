export function contactTarget(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? 'https://wa.me/' + digits : null;
}

export function supportUrl(number) { return contactTarget(number) + '?text=' + encodeURIComponent('مرحبا اريد الدعم'); }

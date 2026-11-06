// Чистая логика без Firebase — её проверяет logic.test.mjs
export const CODE_RE = /^\d{12}$/;

// 12 случайных цифр (крипто-ГСЧ). Смещение от n % 10000 ничтожно (<0.0002%).
export function newCode() {
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return [...a].map((n) => String(n % 10000).padStart(4, '0')).join('');
}

// Решение по найденному билету: ok | vip | used | missing
export function decide(ticket) {
  if (!ticket) return 'missing';
  if (ticket.vip) return 'vip';
  if (ticket.used) return 'used';
  return 'ok';
}

// Достаём 12 цифр из того, что прочитала камера или ввёл человек
export function cleanCode(text) {
  const digits = String(text ?? '').replace(/[\s-]/g, '');
  return CODE_RE.test(digits) ? digits : null;
}

export const fmtCode = (c) => c.replace(/(\d{4})(?=\d)/g, '$1 ');

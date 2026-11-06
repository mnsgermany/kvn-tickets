// Запуск: node logic.test.mjs
import assert from 'node:assert/strict';
import { newCode, decide, cleanCode, fmtCode, CODE_RE } from './logic.js';

const codes = new Set(Array.from({ length: 2000 }, newCode));
for (const c of codes) assert.match(c, CODE_RE);
assert.ok(codes.size > 1990, 'коды должны быть случайными');

assert.equal(decide(undefined), 'missing');
assert.equal(decide({ used: false }), 'ok');
assert.equal(decide({ used: true }), 'used');
assert.equal(decide({ vip: true, used: true }), 'vip'); // VIP проходит всегда

assert.equal(cleanCode('4821 0937 5512'), '482109375512');
assert.equal(cleanCode('4821-0937-5512'), '482109375512');
assert.equal(cleanCode('48210937551'), null);
assert.equal(cleanCode('https://evil.ru/482109375512'), null);
assert.equal(cleanCode(null), null);
assert.equal(fmtCode('482109375512'), '4821 0937 5512');

console.log('logic: все проверки прошли');

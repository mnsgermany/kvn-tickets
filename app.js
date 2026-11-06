import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, runTransaction, updateDoc, addDoc, onSnapshot,
  query, orderBy, limit, where, getDocs, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, EVENT_TITLE, LOGIN_DOMAIN } from './config.js';
import { newCode, decide, cleanCode, fmtCode } from './logic.js';
import { drawTicket, GROUPS } from './ticket.js';
import { HALL, groupOf } from './hall.js';

const $ = (id) => document.getElementById(id);
$('eventTitle').textContent = EVENT_TITLE;

/* ---------- Звуки (синтез, без файлов) ---------- */
let ac;
function audio() {
  ac ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume(); // iOS: разблокируется только по нажатию
  return ac;
}
function tone(freq, at, dur, type = 'sine', vol = 0.3, slideTo) {
  const a = audio(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const SOUND = {
  // добрый: восходящий мажорный «дзынь»
  ok: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.45, 'sine', 0.28)),
  vip: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.07, 0.5, 'triangle', 0.25)),
  // ошибка: три коротких писка
  used: () => [0, 0.16, 0.32].forEach((at) => tone(988, at, 0.11, 'square', 0.16)),
  // злой: низкий расстроенный зуммер, падающий вниз
  missing: () => { tone(140, 0, 0.7, 'sawtooth', 0.35, 70); tone(147, 0, 0.7, 'sawtooth', 0.3, 73); },
  offline: () => [0, 0.16, 0.32].forEach((at) => tone(988, at, 0.11, 'square', 0.16)),
};
const VIBRO = { ok: 80, vip: [60, 40, 60], used: [120, 80, 120, 80, 120], missing: [400, 100, 400], offline: [300] };
const RESULT = {
  ok: { title: 'Проходите', icon: 'i-ok' },
  vip: { title: 'Проходите · VIP', icon: 'i-star' },
  used: { title: 'Билет уже активирован', icon: 'i-warn' },
  missing: { title: 'Билета нет в базе', icon: 'i-x' },
  offline: { title: 'Нет связи с базой', icon: 'i-x' },
};

/* ---------- Firebase ---------- */
const configured = !String(firebaseConfig.apiKey).includes('ВСТАВЬ');
let auth, db, me = '';
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (user) => (user ? enter(user) : leave()));
} else {
  $('loginErr').textContent = 'Firebase не подключён: заполни config.js';
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  audio();
  if (!configured) return;
  const login = $('login').value.trim().toLowerCase();
  const email = login.includes('@') ? login : `${login}@${LOGIN_DOMAIN}`;
  $('loginErr').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, $('password').value);
  } catch {
    $('loginErr').textContent = 'Неверный логин или пароль';
  }
});
$('logoutBtn').addEventListener('click', () => signOut(auth));

let unsubs = [];
function enter(user) {
  me = user.email.split('@')[0];
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('logoutBtn').hidden = false;
  $('logoutBtn').textContent = `${me} · Выйти`;
  unsubs.push(onSnapshot(query(collection(db, 'tickets'), orderBy('createdAt', 'desc')), renderTickets));
  unsubs.push(onSnapshot(query(collection(db, 'scans'), orderBy('at', 'desc'), limit(100)), renderLog));
}
function leave() {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopCamera();
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('logoutBtn').hidden = true;
}

/* ---------- Вкладки ---------- */
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
}));

/* ---------- Проверка билета ---------- */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function check(raw) {
  const code = cleanCode(raw);
  if (!code) return { result: 'missing', code: String(raw).slice(0, 40) };
  try {
    // Транзакция: если два админа сканируют один билет одновременно, пройдёт только один
    return await withTimeout(runTransaction(db, async (tx) => {
      const ref = doc(db, 'tickets', code);
      const snap = await tx.get(ref);
      const t = snap.exists() ? snap.data() : null;
      const result = decide(t);
      if (result === 'ok') tx.update(ref, { used: true, usedAt: serverTimestamp(), usedBy: me });
      tx.set(doc(collection(db, 'scans')), { code, result, by: me, at: serverTimestamp() });
      return { result, code, ticket: t };
    }), 8000);
  } catch (err) {
    console.error(err);
    return { result: 'offline', code };
  }
}

let busy = false, hideTimer;
async function onCode(raw) {
  if (busy) return;
  busy = true;
  pauseCamera();
  showResult(await check(raw));
}

function showResult({ result, code, ticket }) {
  const r = RESULT[result], el = $('result');
  el.className = `result ${result}`;
  $('rIcon').setAttribute('href', `#${r.icon}`);
  $('rTitle').textContent = r.title;
  $('rCode').textContent = /^\d{12}$/.test(code) ? fmtCode(code) : '';
  $('rSeat').textContent = result === 'ok' || result === 'used' ? seatText(ticket) : '';
  let info = '';
  if (result === 'used' && ticket?.usedAt) info = `${fmtTime(ticket.usedAt.toDate())} · ${ticket.usedBy}`;
  if (result === 'offline') info = 'Проверь интернет и отсканируй ещё раз';
  $('rInfo').textContent = info;
  el.hidden = false;
  el.focus();
  SOUND[result]();
  navigator.vibrate?.(VIBRO[result]);
  clearTimeout(hideTimer);
  // Проход закрываем сами, ошибки ждут нажатия — чтобы админ точно увидел
  if (result === 'ok' || result === 'vip') hideTimer = setTimeout(hideResult, 2200);
}
function hideResult() {
  clearTimeout(hideTimer);
  $('result').hidden = true;
  busy = false;
  resumeCamera();
}
$('result').addEventListener('click', hideResult);
$('result').addEventListener('keydown', (e) => (e.key === 'Escape' || e.key === 'Enter') && hideResult());

$('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  audio();
  const v = $('manual').value;
  if (!v.trim()) return;
  $('manual').value = '';
  onCode(v);
});

/* ---------- Камера ---------- */
const UA = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const inApp = /Telegram|Instagram|FBAN|FBAV|VKClient|Line\/|; wv\)/.test(UA);
let scanner, running = false;

function camHint(err) {
  const s = String(err?.name || err);
  if (inApp) return 'Открой сайт в Safari или Chrome:\nвстроенный браузер мессенджера не даёт камеру';
  if (!window.isSecureContext || !navigator.mediaDevices) return 'Камера работает только по https';
  if (/NotAllowed|Permission/i.test(s)) {
    return isIOS
      ? 'Доступ запрещён. В Safari: «аА» слева от адреса →\nНастройки веб-сайта → Камера → Разрешить'
      : 'Доступ запрещён. Нажми на значок слева от адреса →\nРазрешения → Камера → Разрешить';
  }
  if (/NotFound|Overconstrained/i.test(s)) return 'Камера не найдена';
  if (/NotReadable/i.test(s)) return 'Камеру занимает другое приложение — закрой его';
  return 'Не удалось включить камеру. Попробуй ещё раз';
}
$('camHint').textContent = isIOS
  ? 'iPhone спросит разрешение — нажми «Разрешить»'
  : 'Браузер спросит разрешение — нажми «Разрешить»';

async function startCamera() {
  audio();
  $('camHint').textContent = '';
  try {
    scanner ??= new Html5Qrcode('reader', {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false,
    });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; } },
      onCode,
      () => {},
    );
    running = true;
    $('camIdle').hidden = true;
    $('readerWrap').classList.add('live');
  } catch (err) {
    console.error(err);
    $('camIdle').hidden = false;
    $('camHint').textContent = camHint(err);
  }
}
async function stopCamera() {
  if (!running) return;
  running = false;
  try { await scanner.stop(); } catch { /* уже остановлена */ }
  $('camIdle').hidden = false;
  $('readerWrap').classList.remove('live');
}
function pauseCamera() { try { if (running) scanner.pause(true); } catch { /* не на паузе */ } }
function resumeCamera() { try { if (running) scanner.resume(); } catch { /* не на паузе */ } }
$('camBtn').addEventListener('click', startCamera);

// iOS гасит видео при сворачивании — перезапускаем
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && running && isIOS) {
    await stopCamera();
    startCamera();
  }
});

/* ---------- Билеты ---------- */
let hasVip = false, ticketsSnap = null;
const seatKey = (r, s) => `${r}-${s}`;
function seatText(t) {
  if (!t || t.vip) return '';
  const g = GROUPS[t.group];
  if (t.row) return `${g ? g.sector + ' · ' : ''}Ряд ${t.row} · Место ${t.seat}`;
  return g ? `${g.name} · без места` : '';
}
function renderTickets(snap) {
  ticketsSnap = snap;
  const list = $('ticketList');
  list.replaceChildren();
  let total = 0, used = 0;
  hasVip = false;
  snap.forEach((d) => {
    const t = d.data();
    if (t.vip) hasVip = true; else { total++; if (t.used) used++; }
    const li = document.createElement('li');
    li.className = t.vip ? 'vip' : t.used ? 'done' : '';
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = fmtCode(d.id);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [seatText(t), t.used && !t.vip ? `прошёл ${t.usedAt ? fmtTime(t.usedAt.toDate()) : ''} · ${t.usedBy}` : '']
      .filter(Boolean).join(' · ');
    code.append(meta);
    const pill = document.createElement('span');
    pill.className = `pill ${t.vip ? 'vip' : t.used ? 'used' : 'ok'}`;
    pill.textContent = t.vip ? 'VIP' : t.used ? 'Прошёл' : 'Ждём';
    const qrBtn = button('QR', 'secondary', () => openQr(d.id, t));
    li.append(code, pill, qrBtn);
    if (t.used && !t.vip) li.append(button('Сброс', 'ghost', () => resetOne(d.id)));
    list.append(li);
  });
  if (!snap.size) list.innerHTML = '<li class="empty">Билетов пока нет — выпусти первый</li>';
  $('vipBtn').hidden = hasVip;
  const pct = total ? Math.round((used / total) * 100) : 0;
  $('stIn').textContent = used;
  $('stTotal').textContent = total;
  $('stLeft').textContent = total - used;
  $('stPct').textContent = `${pct}%`;
  $('stRing').style.setProperty('--p', pct);
  renderHall();
}
function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

async function addTicket({ vip = false, group = '', row = null, seat = null } = {}) {
  const data = { vip, used: false, createdAt: serverTimestamp(), createdBy: me };
  if (group) data.group = group;
  if (row) Object.assign(data, { row, seat });
  try {
    const code = await runTransaction(db, async (tx) => {
      // Место бронируем документом seats/ряд-место в той же транзакции: два админа не выдадут одно кресло
      const seatRef = row ? doc(db, 'seats', seatKey(row, seat)) : null;
      if (seatRef && (await tx.get(seatRef)).exists()) throw new Error('seat-taken');
      for (;;) {
        const c = newCode(), ref = doc(db, 'tickets', c);
        if ((await tx.get(ref)).exists()) continue; // совпадение — шанс 1 к триллиону, но проверяем
        tx.set(ref, data);
        if (seatRef) tx.set(seatRef, { code: c, by: me, at: serverTimestamp() });
        return c;
      }
    });
    openQr(code, data);
  } catch (err) {
    console.error(err);
    alert(err.message === 'seat-taken' ? 'Это место уже занято другим билетом.' : 'Не получилось выпустить билет. Проверь интернет.');
  }
}
$('vipBtn').addEventListener('click', () => confirm('Создать общий VIP-код? Он пропускает всегда.') && addTicket({ vip: true }));

/* ---------- Окно выпуска: группа, ряд/место или «без места» ---------- */
const NO_SEAT_GROUPS = ['aisle', 'reserve'];
$('addGroup').innerHTML = '<option value="">Без группы</option>' +
  Object.entries(GROUPS).map(([k, g]) => `<option value="${k}">${g.name}${NO_SEAT_GROUPS.includes(k) ? ' (без мест)' : ''}</option>`).join('');

function seatTaken(row, seat) {
  let code = null;
  ticketsSnap?.forEach((d) => { const t = d.data(); if (t.row === row && t.seat === seat) code = d.id; });
  return code;
}
// Проверка формы: { ok, msg, kind }
function checkAdd() {
  const group = $('addGroup').value;
  const forced = NO_SEAT_GROUPS.includes(group);
  $('addNoSeat').disabled = forced;
  if (forced) $('addNoSeat').checked = true;
  const noSeat = $('addNoSeat').checked;
  $('seatFields').hidden = noSeat;
  if (noSeat) return { ok: true, msg: group ? `${GROUPS[group].name} · без места` : 'Билет без места', kind: 'good' };
  const row = +$('addRow').value, seat = +$('addSeat').value;
  if (!row || !seat) return { ok: false, msg: 'Укажи ряд и место или отметь «Без места»', kind: '' };
  const hallGroup = groupOf(row, seat);
  if (!hallGroup) return { ok: false, msg: `Места ${seat} в ${row}-м ряду нет в зале`, kind: 'bad' };
  if (hallGroup === 'tech') return { ok: false, msg: 'Это техническая зона, билет на неё не выдаём', kind: 'bad' };
  const taken = seatTaken(row, seat);
  if (taken) return { ok: false, msg: `Занято: билет ${fmtCode(taken)}`, kind: 'bad' };
  if (group && hallGroup !== group) return { ok: true, msg: `Свободно, но по схеме это сектор «${GROUPS[hallGroup].name}»`, kind: 'bad' };
  return { ok: true, msg: `Свободно · ${GROUPS[hallGroup].sector} сектор`, kind: 'good' };
}
function refreshAdd() {
  const r = checkAdd();
  $('addHint').textContent = r.msg;
  $('addHint').className = `hint add-hint ${r.kind}`;
  $('addOk').disabled = !r.ok;
}
// Если группа не выбрана — подставляем её по схеме, как только введено место
function autoGroup() {
  const g = groupOf(+$('addRow').value, +$('addSeat').value);
  if (!$('addGroup').value && g && g !== 'tech') $('addGroup').value = g;
  refreshAdd();
}
['addGroup', 'addNoSeat'].forEach((id) => $(id).addEventListener('change', refreshAdd));
['addRow', 'addSeat'].forEach((id) => $(id).addEventListener('input', autoGroup));
$('addBtn').addEventListener('click', () => {
  $('addForm').reset();
  refreshAdd();
  $('addDialog').showModal();
});
$('addCancel').addEventListener('click', () => $('addDialog').close());
$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!checkAdd().ok) return refreshAdd();
  const group = $('addGroup').value, noSeat = $('addNoSeat').checked;
  $('addDialog').close();
  addTicket({ group, row: noSeat ? null : +$('addRow').value, seat: noSeat ? null : +$('addSeat').value });
});

/* ---------- Рассадка: схема зала, заполняется по сканам ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const HX = (col) => 40 + (col + 1) * 20 + 10;         // col -1 и 31 — боковые проходы
const HY = (row) => 16 + (15 - row) * 22;             // ряд 15 сверху, сцена снизу — как в схеме
const SEATS_TOTAL = Object.values(HALL).flat().filter((s) => s[2] !== 'tech').length;
let hallBuilt = false, prevIn = null, selSeat = null;
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e;
}
function buildHall() {
  const svg = $('hallSvg');
  const h = HY(1) + 64;
  svg.setAttribute('viewBox', `0 0 740 ${h}`);
  for (const x of [HX(-1), HX(31)]) {
    el('rect', { class: 'aisle', x: x - 7, y: HY(9) - 8, width: 14, height: HY(1) - HY(9) + 16, rx: 7 }, svg);
  }
  for (let r = 1; r <= 15; r++) {
    for (const x of [18, 722]) el('text', { class: 'rn', x, y: HY(r) }, svg).textContent = r;
    for (const [col, seat, g] of HALL[r] ?? []) {
      const c = el('circle', { class: `seat${g === 'tech' ? ' tech' : ''}`, cx: HX(col), cy: HY(r), r: 7.5, 'data-k': seatKey(r, seat) }, svg);
      if (g !== 'tech') c.style.setProperty('--c', GROUPS[g].a1);
    }
  }
  const defs = el('defs', {}, svg);
  const lg = el('linearGradient', { id: 'stageG' }, defs);
  el('stop', { offset: 0, 'stop-color': '#5fb4e6' }, lg);
  el('stop', { offset: 1, 'stop-color': '#e8603c' }, lg);
  const sy = HY(1) + 26;
  el('rect', { x: 130, y: sy, width: 480, height: 28, rx: 14, fill: 'url(#stageG)' }, svg);
  el('text', { class: 'stage-t', x: 370, y: sy + 14 }, svg).textContent = 'СЦЕНА';
  svg.addEventListener('click', (e) => {
    const k = e.target.dataset?.k;
    if (!k || e.target.classList.contains('tech')) return;
    selSeat = k;
    renderHall();
  });
  hallBuilt = true;
}
function renderHall() {
  if (!ticketsSnap) return;
  if (!hallBuilt) buildHall();
  const bySeat = new Map(), stat = {};
  ticketsSnap.forEach((d) => {
    const t = d.data();
    if (t.vip) return;
    const s = (stat[t.group ?? ''] ??= { issued: 0, in: 0 });
    s.issued++;
    if (t.used) s.in++;
    if (t.row) bySeat.set(seatKey(t.row, t.seat), { code: d.id, t });
  });
  const nowIn = new Set(), fresh = [];
  let seatedIn = 0;
  $('hallSvg').querySelectorAll('.seat:not(.tech)').forEach((c) => {
    const k = c.dataset.k, info = bySeat.get(k), isIn = !!info?.t.used;
    c.classList.toggle('issued', !!info);
    c.classList.toggle('in', isIn);
    c.classList.toggle('sel', k === selSeat);
    if (isIn) {
      nowIn.add(k); seatedIn++;
      if (prevIn && !prevIn.has(k)) fresh.push(c);
    }
  });
  // анимируем только свежие сканы, а не первую загрузку базы
  if (fresh.length <= 10) fresh.forEach((c) => { c.classList.remove('pop'); c.getBBox(); c.classList.add('pop'); });
  prevIn = nowIn;
  $('hallIn').textContent = seatedIn;
  $('hallIssued').textContent = bySeat.size;
  $('hallPct').textContent = `${Math.round((seatedIn / SEATS_TOTAL) * 100)}%`;

  // подсказка по выбранному креслу
  if (selSeat) {
    const [r, s] = selSeat.split('-').map(Number), info = bySeat.get(selSeat), g = GROUPS[groupOf(r, s)];
    let st = 'билет не выпущен';
    if (info) st = info.t.used ? `в зале с ${info.t.usedAt ? fmtTime(info.t.usedAt.toDate()) : '…'} · ${info.t.usedBy}` : `ждём · ${fmtCode(info.code)}`;
    $('hallInfo').textContent = `Ряд ${r} · Место ${s} · ${g?.name ?? ''} — ${st}`;
  }

  // легенда по группам
  const cap = {};
  Object.values(HALL).flat().forEach(([, , g]) => (cap[g] = (cap[g] ?? 0) + 1));
  const keys = [...Object.keys(GROUPS), ''].filter((k) => k || stat['']);
  $('hallLegend').replaceChildren(...keys.map((k) => {
    const s = stat[k] ?? { issued: 0, in: 0 }, g = GROUPS[k];
    const li = document.createElement('li');
    li.style.setProperty('--c', g?.a1 ?? '#d6b7a3');
    li.style.setProperty('--fill', s.issued ? Math.round((s.in / s.issued) * 100) : 0);
    const note = cap[k] ? `мест по схеме: ${cap[k]}` : 'без мест';
    li.innerHTML = `<span class="dot"></span><span>${g?.name ?? 'Без группы'} <span class="ns">· ${note}</span></span><span><b>${s.in}</b> / ${s.issued}</span><span class="bar"><i></i></span>`;
    return li;
  }));
}

async function resetOne(code) {
  if (!confirm(`Сбросить проход билета ${fmtCode(code)}?`)) return;
  await updateDoc(doc(db, 'tickets', code), { used: false, usedAt: null, usedBy: null });
  await addDoc(collection(db, 'scans'), { code, result: 'reset', by: me, at: serverTimestamp() });
}
$('resetAllBtn').addEventListener('click', async () => {
  if (!confirm('Сбросить ВСЕ проходы? Все билеты снова станут действительными.')) return;
  if (!confirm('Точно? Это нельзя отменить.')) return;
  const snap = await getDocs(query(collection(db, 'tickets'), where('used', '==', true)));
  // shortcut: один batch держит до 500 записей; если билетов станет больше — резать на пачки
  const batch = writeBatch(db);
  snap.forEach((d) => batch.update(d.ref, { used: false, usedAt: null, usedBy: null }));
  batch.set(doc(collection(db, 'scans')), { code: 'все', result: 'reset', by: me, at: serverTimestamp() });
  await batch.commit();
});

/* ---------- Журнал ---------- */
const LOG_LABEL = { ok: 'Прошёл', vip: 'VIP', used: 'Повтор', missing: 'Нет в базе', reset: 'Сброс' };
function renderLog(snap) {
  const list = $('logList');
  list.replaceChildren();
  snap.forEach((d) => {
    const s = d.data();
    const li = document.createElement('li');
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = /^\d{12}$/.test(s.code) ? fmtCode(s.code) : s.code;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${s.at ? fmtTime(s.at.toDate()) : '…'} · ${s.by}`;
    code.append(meta);
    const pill = document.createElement('span');
    pill.className = `pill ${s.result}`;
    pill.textContent = LOG_LABEL[s.result] ?? s.result;
    li.append(code, pill);
    list.append(li);
  });
  if (!snap.size) list.innerHTML = '<li class="empty">Сканирований пока не было</li>';
}

function fmtTime(d) {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- QR-билет (картинка) ---------- */
async function openQr(code, t) {
  const { vip, group, row, seat } = t;
  const cv = $('qrCanvas');
  await drawTicket(cv, { code, vip, group, row, seat, pretty: fmtCode(code) });

  const url = cv.toDataURL('image/png');
  const name = `${vip ? 'VIP' : 'bilet'}-${code}.png`;
  $('qrDownload').href = url;
  $('qrDownload').download = name;
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], name, { type: 'image/png' });
  const canShare = navigator.canShare?.({ files: [file] });
  $('qrShare').hidden = !canShare;
  $('qrShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
  $('qrDialog').showModal();
}
$('qrClose').addEventListener('click', () => $('qrDialog').close());

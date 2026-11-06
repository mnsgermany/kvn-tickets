import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, runTransaction, updateDoc, addDoc, onSnapshot,
  query, orderBy, limit, where, getDocs, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, EVENT_TITLE, LOGIN_DOMAIN } from './config.js';
import { newCode, decide, cleanCode, fmtCode } from './logic.js';

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
let hasVip = false;
function renderTickets(snap) {
  const list = $('ticketList');
  list.replaceChildren();
  let total = 0, used = 0;
  hasVip = false;
  snap.forEach((d) => {
    const t = d.data();
    if (t.vip) hasVip = true; else { total++; if (t.used) used++; }
    const li = document.createElement('li');
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = fmtCode(d.id);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = t.used && !t.vip ? `прошёл ${t.usedAt ? fmtTime(t.usedAt.toDate()) : ''} · ${t.usedBy}` : '';
    code.append(meta);
    const pill = document.createElement('span');
    pill.className = `pill ${t.vip ? 'vip' : t.used ? 'used' : 'ok'}`;
    pill.textContent = t.vip ? 'VIP' : t.used ? 'Прошёл' : 'Ждём';
    const qrBtn = button('QR', 'secondary', () => openQr(d.id, t.vip));
    li.append(code, pill, qrBtn);
    if (t.used && !t.vip) li.append(button('Сброс', 'ghost', () => resetOne(d.id)));
    list.append(li);
  });
  if (!snap.size) list.innerHTML = '<li class="empty">Билетов пока нет — выпусти первый</li>';
  $('vipBtn').hidden = hasVip;
  $('stIn').textContent = used;
  $('stTotal').textContent = total;
  $('stBar').style.width = total ? `${(used / total) * 100}%` : '0';
}
function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

async function addTicket(vip) {
  try {
    const code = await runTransaction(db, async (tx) => {
      for (;;) {
        const c = newCode(), ref = doc(db, 'tickets', c);
        if ((await tx.get(ref)).exists()) continue; // совпадение — шанс 1 к триллиону, но проверяем
        tx.set(ref, { vip, used: false, createdAt: serverTimestamp(), createdBy: me });
        return c;
      }
    });
    openQr(code, vip);
  } catch (err) {
    console.error(err);
    alert('Не получилось выпустить билет. Проверь интернет.');
  }
}
$('addBtn').addEventListener('click', () => addTicket(false));
$('vipBtn').addEventListener('click', () => confirm('Создать общий VIP-код? Он пропускает всегда.') && addTicket(true));

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
async function openQr(code, vip) {
  const cv = $('qrCanvas'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
  await document.fonts.load('40px "Russo One"').catch(() => {});
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a120a');
  bg.addColorStop(1, vip ? '#7a4a00' : '#7a1e08');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  c.textAlign = 'center';
  c.fillStyle = '#fff4ea';
  c.font = '24px Inter, sans-serif';
  c.fillText(vip ? 'КВН · VIP · проход всегда' : 'КВН · входной билет', W / 2, 52);
  c.fillStyle = vip ? '#ffd166' : '#ff5a1f';
  c.font = '42px "Russo One", sans-serif';
  c.fillText(EVENT_TITLE, W / 2, 112, W - 40);

  const qr = qrcode(0, 'M');
  qr.addData(code);
  qr.make();
  const n = qr.getModuleCount(), box = 420, x0 = (W - box) / 2, y0 = 160, cell = (box - 40) / n;
  c.fillStyle = '#fff';
  c.beginPath();
  c.roundRect ? c.roundRect(x0, y0, box, box, 24) : c.rect(x0, y0, box, box); // iOS < 16 без roundRect
  c.fill();
  c.fillStyle = '#140906';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    if (qr.isDark(r, k)) c.fillRect(x0 + 20 + k * cell, y0 + 20 + r * cell, Math.ceil(cell), Math.ceil(cell));
  }
  c.fillStyle = '#fff4ea';
  c.font = '500 40px ui-monospace, Menlo, monospace';
  c.fillText(fmtCode(code), W / 2, 650);
  c.fillStyle = '#d6b7a3';
  c.font = '22px Inter, sans-serif';
  c.fillText('Покажи QR на входе', W / 2, 700);

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

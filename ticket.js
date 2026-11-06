// Отрисовка билета на canvas в стиле оформления сцены: синий фон с мазками, кистевой леттеринг, QR, корешок
import { HALL, HALL_COLS } from './hall.js';

const W = 640, NOTCH = 28;
let H = 1120, STUB = 870; // у билетов с местом высота больше — задаётся в drawTicket

export const EVENT_DATE = '26 НОЯБРЯ 2026 · 19:00';
export const EVENT_PLACE = 'Москва · Концертный зал «Моспродюсер»';

const NAVY = '#16224a', NAVY_DEEP = '#0f1834', ORANGE = '#e8603c', SKY = '#5fb4e6', ICE = '#a9cdee';

// Группы гостей по схеме зала: color — заливка из xlsx, a1 — акцент билета
export const GROUPS = {
  jury:    { name: 'Члены жюри',            label: 'ЧЛЕНЫ ЖЮРИ',            sector: 'ФИОЛЕТОВЫЙ', color: '#800080', a1: '#b44dff' },
  honor:   { name: 'Почётные гости',        label: 'ПОЧЁТНЫЕ ГОСТИ',        sector: 'ОРАНЖЕВЫЙ', color: '#ff8000', a1: '#ff8000' },
  spca:    { name: 'СПЦА МЧС России',       label: 'СПЦА МЧС РОССИИ',       sector: 'ЗЕЛЁНЫЙ', color: '#70ad47', a1: '#62c23a' },
  terr:    { name: 'Территориальные органы МЧС России', label: 'ТЕРРИТОРИАЛЬНЫЕ ОРГАНЫ МЧС', sector: 'КРАСНЫЙ', color: '#ff0000', a1: '#ff2b2b' },
  support: { name: 'Группы поддержки',      label: 'ГРУППА ПОДДЕРЖКИ',      sector: 'СЕРЫЙ', color: '#b2b2b2', a1: '#c4c4c4' },
  reserve: { name: 'Резерв',                label: 'РЕЗЕРВ',                sector: 'РЕЗЕРВ', color: '#5fb4e6', a1: '#5fb4e6' },
  aisle:   { name: 'Сектор Проход',         label: 'СЕКТОР ПРОХОД',         sector: 'ЖЁЛТЫЙ', color: '#ffff00', a1: '#ffe600' },
};

const img = {};
function load(src) {
  return (img[src] ??= new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = new URL(src, import.meta.url).href;
  }));
}

// iOS < 16 не знает roundRect
function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

function ticketPath(c) {
  const r = 32;
  c.beginPath();
  c.moveTo(r, 0);
  c.lineTo(W - r, 0);
  c.arcTo(W, 0, W, r, r);
  c.lineTo(W, STUB - NOTCH);
  c.arc(W, STUB, NOTCH, -Math.PI / 2, Math.PI / 2, true);
  c.lineTo(W, H - r);
  c.arcTo(W, H, W - r, H, r);
  c.lineTo(r, H);
  c.arcTo(0, H, 0, H - r, r);
  c.lineTo(0, STUB + NOTCH);
  c.arc(0, STUB, NOTCH, Math.PI / 2, -Math.PI / 2, true);
  c.lineTo(0, r);
  c.arcTo(0, 0, r, 0, r);
  c.closePath();
}

function spaced(c, text, x, y, font, color, gap, max) {
  c.font = font;
  c.fillStyle = color;
  c.letterSpacing = gap + 'px';
  c.fillText(text, x, y, max);
  c.letterSpacing = '0px';
}

function chip(c, x, y, w, h, accent, label, value, size = 40, dot) {
  c.fillStyle = '#0f183499';
  rr(c, x, y, w, h, 16); c.fill();
  c.lineWidth = 2; c.strokeStyle = accent;
  rr(c, x, y, w, h, 16); c.stroke();
  c.textAlign = 'center';
  spaced(c, label, x + w / 2, y + 26, '600 14px Montserrat, sans-serif', ICE, 4);
  c.fillStyle = '#fff';
  c.font = `italic 800 ${size}px Montserrat, sans-serif`;
  if (dot) {
    const tw = Math.min(w - 44, c.measureText(value).width);
    c.fillText(value, x + w / 2 + 11, y + h - 16, w - 44);
    c.fillStyle = dot;
    c.beginPath(); c.arc(x + w / 2 - tw / 2 - 6, y + h - 16 - size * 0.34, 8, 0, Math.PI * 2); c.fill();
  } else c.fillText(value, x + w / 2, y + h - 14, w - 20);
}

// Мини-схема зала: ряд 15 сверху, сцена снизу (как в xlsx); своё место — белое с кольцом
function hallMap(c, top, P) {
  const x0 = 54, w = W - 108, cell = w / HALL_COLS, rh = 13, ph = 15 * rh + 70;
  c.fillStyle = '#0f1834b3';
  rr(c, x0 - 14, top, w + 28, ph, 18); c.fill();
  c.lineWidth = 1.5; c.strokeStyle = ICE + '40';
  rr(c, x0 - 14, top, w + 28, ph, 18); c.stroke();
  const rowY = (r) => top + 18 + (15 - r) * rh;
  if (P.row) { // подсветка своего ряда
    c.fillStyle = P.accent + '30';
    rr(c, x0 - 6, rowY(P.row) - rh / 2, w + 12, rh, 6); c.fill();
  }
  if (P.group === 'aisle') { // боковые проходы рядов 1–9
    c.fillStyle = P.accent;
    for (const x of [x0 - 8, x0 + w + 2]) { rr(c, x, rowY(9) - 5, 6, rowY(1) - rowY(9) + 10, 3); c.fill(); }
  }
  for (const [r, list] of Object.entries(HALL)) for (const [col, seat, g] of list) {
    const cx = x0 + (col + 0.5) * cell, cy = rowY(+r);
    const mine = +r === P.row && seat === P.seat;
    c.globalAlpha = mine ? 1 : g === P.group ? 0.95 : 0.3;
    c.fillStyle = g === 'tech' ? '#5a6b8f' : GROUPS[g].a1;
    c.beginPath(); c.arc(cx, cy, mine ? 5.5 : 4.2, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  if (P.row) {
    const it = HALL[P.row].find((s) => s[1] === P.seat);
    if (it) {
      const cx = x0 + (it[0] + 0.5) * cell, cy = rowY(P.row);
      c.shadowColor = '#fff'; c.shadowBlur = 12;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.lineWidth = 2.5; c.strokeStyle = P.accent;
      c.beginPath(); c.arc(cx, cy, 10, 0, Math.PI * 2); c.stroke();
    }
  }
  // сцена
  const sy = rowY(1) + 18;
  const sg = c.createLinearGradient(x0, 0, x0 + w, 0);
  sg.addColorStop(0, SKY); sg.addColorStop(1, ORANGE);
  c.fillStyle = sg;
  rr(c, x0 + w * 0.12, sy, w * 0.76, 24, 12); c.fill();
  c.textAlign = 'center';
  spaced(c, 'СЦЕНА', W / 2, sy + 17, '700 13px Montserrat, sans-serif', '#fff', 6);
  return top + ph;
}

export async function drawTicket(cv, { code, vip, pretty, group, row, seat }) {
  const c = cv.getContext('2d');
  await Promise.all([
    document.fonts.load('italic 800 40px Montserrat'),
    document.fonts.load('500 18px Montserrat'),
    document.fonts.load('600 14px Montserrat'),
  ]).catch(() => {});
  const [bgImg, titleImg] = await Promise.all([load('./assets/bg.jpg'), load('./assets/title.png')]);
  const G = GROUPS[group];
  const accent = vip ? '#ffb21a' : G?.a1 ?? ORANGE;
  const label = vip ? 'VIP · ПРОХОД ВСЕГДА' : G?.label ?? 'ВХОДНОЙ БИЛЕТ';
  const seated = row != null && seat != null;
  const compact = seated || group === 'aisle';
  H = compact ? 1450 : 1120;
  STUB = compact ? 1200 : 870;
  cv.width = W; cv.height = H;

  c.clearRect(0, 0, W, H);
  c.save();
  ticketPath(c);
  c.clip();

  // фон: мазки с пола сцены + затемнение по центру, чтобы читался текст
  c.fillStyle = NAVY; c.fillRect(0, 0, W, H);
  const bs = Math.max(1160, H + 80);
  c.drawImage(bgImg, (W - bs) / 2 - 20, -40, bs, bs);
  const v = c.createRadialGradient(W / 2, 470, 60, W / 2, 470, 420);
  v.addColorStop(0, NAVY + 'f2'); v.addColorStop(0.65, NAVY + 'b0'); v.addColorStop(1, NAVY + '00');
  c.fillStyle = v; c.fillRect(0, 0, W, H);

  // леттеринг «Решающее направление» из макета
  const tw = compact ? 440 : 520, th = tw * titleImg.height / titleImg.width;
  const ty = compact ? 34 : 44;
  c.drawImage(titleImg, (W - tw) / 2, ty, tw, th);
  let y = ty + th + 34;

  // — КВН МЧС РОССИИ —
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  spaced(c, 'КВН МЧС РОССИИ', W / 2, y, '500 18px Montserrat, sans-serif', '#fff', 6);
  c.fillStyle = ORANGE;
  c.fillRect(W / 2 - 205, y - 7, 34, 3);
  c.fillRect(W / 2 + 171, y - 7, 34, 3);

  y += 40;
  spaced(c, EVENT_DATE, W / 2, y, '500 26px Montserrat, sans-serif', ORANGE, 3);
  y += 28;
  c.font = '500 16px Montserrat, sans-serif';
  c.fillStyle = ICE;
  c.fillText(EVENT_PLACE, W / 2, y, W - 60);

  // плашка категории
  y += 18;
  c.font = '700 15px Montserrat, sans-serif';
  c.letterSpacing = '4px';
  const lw = Math.min(W - 60, c.measureText(label).width + 40);
  c.fillStyle = accent;
  rr(c, (W - lw) / 2, y, lw, 34, 17); c.fill();
  c.fillStyle = vip || group === 'aisle' || group === 'support' ? NAVY_DEEP : '#fff';
  c.fillText(label, W / 2, y + 23, lw - 28);
  c.letterSpacing = '0px';
  y += 60;

  if (seated) {
    chip(c, 40, y, 230, 80, accent, 'СЕКТОР', G?.sector ?? '—', 28, accent);
    chip(c, 286, y, 150, 80, accent, 'РЯД', String(row));
    chip(c, 452, y, 148, 80, accent, 'МЕСТО', String(seat));
    y += 100;
  } else if (group === 'aisle') {
    chip(c, 40, y, 230, 80, accent, 'СЕКТОР', G.sector, 28, accent);
    chip(c, 286, y, 314, 80, accent, 'МЕСТО', 'ПРОХОД', 34);
    y += 100;
  }
  if (compact) y = hallMap(c, y, { row, seat, group, accent }) + 28;

  // QR на белой плашке с сине-оранжевой рамкой
  const qr = qrcode(0, 'M');
  qr.addData(code);
  qr.make();
  const n = qr.getModuleCount();
  const box = Math.min(compact ? 280 : 300, STUB - 36 - y), x0 = (W - box) / 2, y0 = y;
  const fg = c.createLinearGradient(x0, y0 + box, x0 + box, y0);
  fg.addColorStop(0, SKY); fg.addColorStop(0.55, '#3d7cc0'); fg.addColorStop(1, accent);
  c.fillStyle = fg;
  rr(c, x0 - 8, y0 - 8, box + 16, box + 16, 28); c.fill();
  c.fillStyle = '#fff';
  rr(c, x0, y0, box, box, 22); c.fill();
  const pad = 20, cell = (box - pad * 2) / n;
  c.fillStyle = NAVY_DEEP;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    if (qr.isDark(r, k)) c.fillRect(x0 + pad + k * cell, y0 + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
  }

  // корешок
  const sg = c.createLinearGradient(0, STUB, 0, H);
  sg.addColorStop(0, NAVY_DEEP + 'ee'); sg.addColorStop(1, NAVY_DEEP);
  c.fillStyle = sg; c.fillRect(0, STUB, W, H - STUB);
  c.restore();

  // перфорация
  c.strokeStyle = ICE + '88';
  c.lineWidth = 3;
  c.setLineDash([2, 12]);
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(NOTCH + 14, STUB); c.lineTo(W - NOTCH - 14, STUB); c.stroke();
  c.setLineDash([]);

  c.textAlign = 'center';
  spaced(c, '№ БИЛЕТА', W / 2, STUB + 50, '600 14px Montserrat, sans-serif', ICE, 4);
  c.fillStyle = '#fff';
  c.font = '700 44px Montserrat, sans-serif';
  c.fillText(pretty, W / 2, STUB + 102);
  c.fillStyle = accent;
  c.font = '500 17px Montserrat, sans-serif';
  c.fillText(vip ? 'Общий VIP-код · не передавай посторонним' : 'Покажи QR на входе · билет на одного', W / 2, STUB + 140);
  const tail = seated ? `${G?.sector ?? ''} · РЯД ${row} · МЕСТО ${seat}` : group === 'aisle' ? 'ЖЁЛТЫЙ · СЕКТОР ПРОХОД' : G ? `${G.label} · БЕЗ МЕСТА` : EVENT_DATE;
  c.fillStyle = '#fff';
  c.font = 'italic 800 24px Montserrat, sans-serif';
  c.fillText(tail, W / 2, STUB + 190, W - 60);
  c.fillStyle = ICE;
  c.font = '500 14px Montserrat, sans-serif';
  c.fillText(compact ? EVENT_DATE : EVENT_PLACE, W / 2, STUB + 218);

  // контур
  ticketPath(c);
  c.lineWidth = 3;
  c.strokeStyle = SKY + '99';
  c.stroke();
}

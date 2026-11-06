// Отрисовка билета на canvas: эмблема, пламя, перфорация, QR, отрывной корешок
const W = 640, H = 1000, STUB = 780, NOTCH = 28;

// Детерминированный ГСЧ: у каждого билета свой рисунок искр
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function flame(c, x, base, w, h) {
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.bezierCurveTo(x - w / 2, base - h * 0.45, x - w * 0.12, base - h * 0.62, x, base - h);
  c.bezierCurveTo(x + w * 0.1, base - h * 0.58, x + w / 2, base - h * 0.5, x + w / 2, base);
  c.closePath();
  c.fill();
}

function arcText(c, text, cx, cy, r) {
  const chars = [...text], step = (Math.PI * 2) / chars.length;
  chars.forEach((ch, i) => {
    c.save();
    c.translate(cx, cy);
    c.rotate(i * step);
    c.fillText(ch, 0, -r);
    c.restore();
  });
}

function emblem(c, cx, cy, P) {
  c.save();
  c.shadowColor = P.a1;
  c.shadowBlur = 40;
  c.fillStyle = '#1a0904';
  c.beginPath(); c.arc(cx, cy, 92, 0, Math.PI * 2); c.fill();
  c.restore();
  c.lineWidth = 4; c.strokeStyle = P.a1;
  c.beginPath(); c.arc(cx, cy, 92, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 1.5; c.strokeStyle = P.a2;
  c.beginPath(); c.arc(cx, cy, 62, 0, Math.PI * 2); c.stroke();
  // надпись по кругу
  c.fillStyle = P.a2;
  c.font = '17px "Russo One", sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  arcText(c, 'КВН · РЕШАЮЩЕЕ НАПРАВЛЕНИЕ · ', cx, cy, 77);
  // пламя в центре
  const g = c.createLinearGradient(0, cy + 40, 0, cy - 50);
  g.addColorStop(0, P.a1); g.addColorStop(1, P.a3);
  c.fillStyle = g;
  flame(c, cx, cy + 38, 64, 92);
  c.fillStyle = '#fff3c4';
  flame(c, cx + 2, cy + 38, 28, 42);
}

export async function drawTicket(cv, { code, vip, title, pretty }) {
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  await Promise.all([
    document.fonts.load('46px "Russo One"'),
    document.fonts.load('700 20px Inter'),
  ]).catch(() => {});
  const P = vip
    ? { a1: '#ffb21a', a2: '#ffd166', a3: '#fff3c4', deep: '#3d2300', label: 'VIP · ПРОХОД ВСЕГДА' }
    : { a1: '#ff5a1f', a2: '#ffb21a', a3: '#ffe29a', deep: '#3d0d04', label: 'ВХОДНОЙ БИЛЕТ' };
  const rand = rng(Number(code.slice(0, 9)));

  c.clearRect(0, 0, W, H);
  c.save();
  ticketPath(c);
  c.clip();

  // фон
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#170804'); bg.addColorStop(0.7, P.deep); bg.addColorStop(1, '#120603');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W / 2, 150, 10, W / 2, 150, 340);
  glow.addColorStop(0, P.a1 + '55'); glow.addColorStop(1, 'transparent');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);

  // пожарная «зебра» сверху
  c.fillStyle = P.a1;
  for (let x = -40; x < W + 40; x += 36) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 18, 0); c.lineTo(x + 6, 14); c.lineTo(x - 12, 14); c.fill();
  }

  // пламя у перфорации
  for (let layer = 0; layer < 3; layer++) {
    const g = c.createLinearGradient(0, STUB, 0, STUB - 200);
    g.addColorStop(0, layer === 2 ? P.a3 + 'cc' : P.a1 + (layer ? 'aa' : '66'));
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    for (let x = -20; x < W + 40; x += 44 + layer * 10) {
      flame(c, x + layer * 15 + rand() * 12, STUB + 6, 60 - layer * 10, 90 + rand() * (130 - layer * 30));
    }
  }

  // искры
  c.shadowColor = P.a1; c.shadowBlur = 8;
  for (let i = 0; i < 38; i++) {
    const x = rand() * W, y = 40 + rand() * (STUB - 60), r = 0.8 + rand() * 2.4;
    c.fillStyle = rand() > 0.5 ? P.a2 : P.a3;
    c.globalAlpha = 0.25 + rand() * 0.6;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1; c.shadowBlur = 0;

  emblem(c, W / 2, 140, P);

  // название
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const tg = c.createLinearGradient(0, 262, 0, 300);
  tg.addColorStop(0, P.a3); tg.addColorStop(1, P.a1);
  c.fillStyle = tg;
  c.font = '46px "Russo One", sans-serif';
  c.fillText(title, W / 2, 300, W - 60);
  c.fillStyle = '#fff4ea';
  c.font = '700 18px Inter, sans-serif';
  c.letterSpacing = '4px';
  c.fillText(P.label, W / 2, 336);
  c.letterSpacing = '0px';

  // QR на белой плашке с огненной рамкой
  const qr = qrcode(0, 'M');
  qr.addData(code);
  qr.make();
  const n = qr.getModuleCount(), box = 360, x0 = (W - box) / 2, y0 = 370;
  const fg = c.createLinearGradient(x0, y0, x0 + box, y0 + box);
  fg.addColorStop(0, P.a3); fg.addColorStop(0.5, P.a1); fg.addColorStop(1, P.a2);
  c.fillStyle = fg;
  rr(c, x0 - 8, y0 - 8, box + 16, box + 16, 30); c.fill();
  c.fillStyle = '#fff';
  rr(c, x0, y0, box, box, 24); c.fill();
  const pad = 24, cell = (box - pad * 2) / n;
  c.fillStyle = '#140906';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    if (qr.isDark(r, k)) c.fillRect(x0 + pad + k * cell, y0 + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
  }
  c.restore();

  // перфорация
  c.strokeStyle = '#ffffff55';
  c.lineWidth = 3;
  c.setLineDash([2, 12]);
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(NOTCH + 14, STUB); c.lineTo(W - NOTCH - 14, STUB); c.stroke();
  c.setLineDash([]);

  // корешок
  c.textAlign = 'center';
  c.fillStyle = '#d6b7a3';
  c.font = '700 15px Inter, sans-serif';
  c.letterSpacing = '3px';
  c.fillText('№ БИЛЕТА', W / 2, STUB + 58);
  c.letterSpacing = '0px';
  c.fillStyle = '#fff4ea';
  c.font = '500 46px ui-monospace, Menlo, monospace';
  c.fillText(pretty, W / 2, STUB + 112);
  c.fillStyle = P.a2;
  c.font = '18px Inter, sans-serif';
  c.fillText(vip ? 'Общий VIP-код · не передавай посторонним' : 'Покажи QR на входе · билет на одного', W / 2, STUB + 156);

  // контур билета
  ticketPath(c);
  c.lineWidth = 3;
  c.strokeStyle = P.a1 + 'aa';
  c.stroke();
}

#!/usr/bin/env node
// Generates assets/profile.svg — the hero artwork with an ink-wash "memento
// mori" day grid counting down to the deadline in memento.config.json.
//
// Hero and countdown live in ONE file on purpose: GitHub's markdown sanitizer
// strips `style`, so two stacked <img> tags always leave an inline line-box gap
// between them. Welding them into a single SVG is the only way to get a seam of
// exactly zero. Run daily from .github/workflows/memento.yml.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'memento.config.json'), 'utf8'));

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const heroPath = cfg.hero || 'assets/hero.png';
const heroData = readFileSync(join(root, heroPath)).toString('base64');
const heroMime = MIME[extname(heroPath).toLowerCase()] || 'image/png';

const DAY = 86400000;
const TZ = (cfg.tzOffsetHours ?? 0) * 3600000;

// Dates are handled at UTC noon so DST / offset shifts can never round a day off.
const day = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
};
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const local = new Date(Date.now() + TZ);
const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12);

const target = day(cfg.target);
const start = day(cfg.start);
const total = Math.max(1, Math.round((target - start) / DAY));
const rawElapsed = Math.round((today - start) / DAY);
const elapsed = Math.min(total, Math.max(0, rawElapsed));
const remain = total - elapsed;
const overdue = Math.max(0, rawElapsed - total);
const pct = Math.round((elapsed / total) * 100);

// ── deterministic noise ─────────────────────────────────────────────────────
// Seeded so a rerun on the same day is byte-identical: the daily commit only
// ever contains the change the passing day actually caused.
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const n = (v, p = 1) => Number(v.toFixed(p));

// ── geometry ────────────────────────────────────────────────────────────────
const W = cfg.width || 600;
const PAD = 30;
const innerW = W - PAD * 2;

let cols = Math.min(total, 30);
while (Math.ceil(total / cols) > 8) cols += 5;
const rows = Math.ceil(total / cols);
cols = Math.ceil(total / rows); // rebalance so the last row isn't a stub
const pitch = innerW / cols;
const cell = Math.max(4, pitch * 0.7);
const gridH = (rows - 1) * pitch + cell;

// The countdown doesn't sit under the artwork, it continues it: the hero's last
// EDGE rendered pixels are mirrored, stretched STRETCH times to fill FOG, and
// dissolved into paper. Mirroring rather than offsetting matters — it puts the
// hero's own bottom row at the seam, so the two halves match per column by
// construction. Offsetting by EDGE instead left tonal steps up to 47/255 wide
// wherever a dark stroke ended inside the lookback window.
const FOG = 104;
const EDGE = 8;
const STRETCH = FOG / EDGE;
// The mirror is lifted LIFT px above the seam and clipped back off, purely so
// the displacement filter has real ink to pull down at y=0 instead of the
// transparency that lies beyond the image edge. Costs ~2px of lookback.
const LIFT = 24;

const headY = FOG + 34;
const ruleY = headY + 12;
const gridY = ruleY + 22;
const numY = gridY + gridH + 78;
const footRuleY = numY + 24;
const footY = footRuleY + 17;
const BOTTOM_BAND = 48;
const H = Math.round(footY + 12 + BOTTOM_BAND);

// Rendered height of the hero. Defaults to the 600x600 box readme.md used
// before the two images were welded together, so the weld doesn't silently
// restretch the artwork.
const heroH = cfg.heroHeight || 600;
const TOTAL = heroH + H;

// A ridge hanging off `closeY`: a wavy silhouette echoing the ink hills in the
// artwork above. Rendered through the brush filter so the edge tears.
function ridge(rnd, { baseY, amp, segs, closeY }) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const x = (W * i) / segs;
    const wave = 0.5 + 0.5 * Math.sin(i * 1.7 + rnd() * 2);
    const off = amp * (0.3 + 0.7 * rnd()) * wave;
    pts.push([x, closeY === 0 ? baseY - off : baseY + off]);
  }
  let d = `M0,${closeY} L${n(pts[0][0])},${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    d += ` Q${n(px)},${n(py)} ${n((px + cx) / 2)},${n((py + cy) / 2)}`;
  }
  d += ` L${W},${n(pts[pts.length - 1][1])} L${W},${closeY} Z`;
  return d;
}

// Hand-drawn hairline.
function hairline(rnd, y, x1 = PAD, x2 = W - PAD) {
  let d = `M${n(x1)},${n(y + (rnd() - 0.5))}`;
  const segs = 14;
  for (let i = 1; i <= segs; i++) {
    d += ` L${n(x1 + ((x2 - x1) * i) / segs)},${n(y + (rnd() - 0.5) * 1.6)}`;
  }
  return d;
}

// ── artwork ─────────────────────────────────────────────────────────────────
const rnd = mulberry32(20260823);

const botWash = [
  { d: ridge(rnd, { baseY: H - 54, amp: 21, segs: 5, closeY: H }), fill: '#c4c4c4', o: 0.55 },
  { d: ridge(rnd, { baseY: H - 40, amp: 17, segs: 6, closeY: H }), fill: '#7f7f7f', o: 0.65 },
  { d: ridge(rnd, { baseY: H - 25, amp: 13, segs: 8, closeY: H }), fill: '#141414', o: 0.92 },
];

// One mark per day: filled = burned, outlined = left, bracketed = today.
const marks = [];
for (let i = 0; i < total; i++) {
  const c = i % cols;
  const r = (i - c) / cols;
  const jx = (rnd() - 0.5) * 1.4;
  const jy = (rnd() - 0.5) * 1.4;
  const s = cell * (0.9 + rnd() * 0.14);
  const x = PAD + c * pitch + jx;
  const y = gridY + r * pitch + jy;
  const isToday = i === elapsed && remain > 0;

  if (i < elapsed) {
    marks.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" fill="#0b0b0b" opacity="${n(0.9 + rnd() * 0.1, 2)}"/>`
    );
  } else {
    marks.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" fill="none" stroke="#141414" stroke-width="1.3" opacity="0.55"/>`
    );
  }
  if (isToday) {
    const o = 3.5;
    const a = 5;
    const x0 = x - o;
    const y0 = y - o;
    const x1 = x + s + o;
    const y1 = y + s + o;
    marks.push(
      `<path d="M${n(x0)},${n(y0 + a)} L${n(x0)},${n(y0)} L${n(x0 + a)},${n(y0)}` +
        ` M${n(x1 - a)},${n(y0)} L${n(x1)},${n(y0)} L${n(x1)},${n(y0 + a)}` +
        ` M${n(x1)},${n(y1 - a)} L${n(x1)},${n(y1)} L${n(x1 - a)},${n(y1)}` +
        ` M${n(x0 + a)},${n(y1)} L${n(x0)},${n(y1)} L${n(x0)},${n(y1 - a)}"` +
        ` fill="none" stroke="#0b0b0b" stroke-width="1.4"/>`
    );
  }
}

const bigNum = overdue > 0 ? `+${overdue}` : String(remain);
const bigLabel = overdue > 0 ? 'DAYS OVERDUE' : remain === 0 ? 'TODAY IS THE DAY' : remain === 1 ? 'DAY REMAINS' : 'DAYS REMAIN';
const motto = overdue > 0 ? 'TEMPUS FUGIT' : 'MEMENTO MORI';
const counter = overdue > 0 ? `DAY ${total + overdue} / ${total}` : `DAY ${elapsed} / ${total}`;
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const SERIF = "Georgia,'Iowan Old Style','Times New Roman',serif";
const MONO = "'DejaVu Sans Mono',Menlo,Consolas,'Courier New',monospace";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL}" viewBox="0 0 ${W} ${TOTAL}" role="img" aria-label="${esc(motto)}: ${esc(bigNum)} ${esc(bigLabel.toLowerCase())} until ${esc(cfg.title)} on ${esc(cfg.target)}">
<title>${esc(motto)} — ${esc(bigNum)} ${esc(bigLabel.toLowerCase())} until ${esc(cfg.title)} (${esc(cfg.target)})</title>
<defs>
<filter id="rough" x="-6%" y="-20%" width="112%" height="140%">
<feTurbulence type="fractalNoise" baseFrequency="0.05 0.09" numOctaves="3" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="brush" x="-5%" y="-40%" width="110%" height="180%">
<feTurbulence type="fractalNoise" baseFrequency="0.022 0.05" numOctaves="4" seed="21" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="fog" x="-4%" y="-15%" width="108%" height="130%">
<feTurbulence type="fractalNoise" baseFrequency="0.012 0.055" numOctaves="4" seed="13" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="20" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5"/>
<feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
</filter>
<linearGradient id="dissolveGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity="1"/>
<stop offset="0.22" stop-color="#fff" stop-opacity="0.9"/>
<stop offset="0.58" stop-color="#fff" stop-opacity="0.34"/>
<stop offset="1" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<mask id="dissolve"><rect x="0" y="0" width="${W}" height="${FOG}" fill="url(#dissolveGrad)"/></mask>
<clipPath id="strip"><rect x="0" y="0" width="${W}" height="${FOG}"/></clipPath>
<clipPath id="stripWide"><rect x="${-FOG}" y="${-FOG}" width="${W + FOG * 2}" height="${FOG * 3}"/></clipPath>
<image id="hero" x="0" y="0" width="${W}" height="${heroH}" preserveAspectRatio="none" href="data:${heroMime};base64,${heroData}"/>
<linearGradient id="fadeUp" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="#fff" stop-opacity="0"/>
<stop offset="0.5" stop-color="#fff" stop-opacity="0.28"/>
<stop offset="1" stop-color="#fff" stop-opacity="1"/>
</linearGradient>
<clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
</defs>

<use href="#hero"/>

<g transform="translate(0,${heroH})">
<rect width="${W}" height="${H}" fill="#ffffff"/>

<g clip-path="url(#frame)">
  <g mask="url(#dissolve)">
    <g clip-path="url(#strip)">
      <g filter="url(#fog)">
        <g clip-path="url(#stripWide)">
          <!-- 8% wider than the canvas so the displacement has ink to pull from
               at the left and right edges instead of transparency. -->
          <use href="#hero" transform="translate(${n(-W * 0.04)},${n(heroH * STRETCH - LIFT)}) scale(1.08,${n(-STRETCH, 3)})"/>
        </g>
      </g>
    </g>
  </g>

  <g filter="url(#brush)">
${botWash.map((p) => `    <path d="${p.d}" fill="${p.fill}" opacity="${p.o}"/>`).join('\n')}
  </g>
  <rect x="0" y="${H - BOTTOM_BAND - 10}" width="${W}" height="${BOTTOM_BAND + 10}" fill="url(#fadeUp)"/>
  <rect x="0" y="${H - 14}" width="${W}" height="18" fill="#0b0b0b"/>

  <text x="${PAD}" y="${headY}" font-family="${SERIF}" font-size="15" letter-spacing="6.5" fill="#0b0b0b">${esc(motto)}</text>
  <text x="${W - PAD}" y="${headY}" text-anchor="end" font-family="${MONO}" font-size="10.5" letter-spacing="2.4" fill="#3c3c3c">${esc(cfg.title.toUpperCase())}</text>
  <path d="${hairline(rnd, ruleY)}" fill="none" stroke="#0b0b0b" stroke-width="1.1" filter="url(#rough)"/>

  <g filter="url(#rough)">
${marks.map((m) => '    ' + m).join('\n')}
  </g>

  <text x="${PAD - 3}" y="${numY}" font-family="${SERIF}" font-size="72" letter-spacing="-2" fill="#0b0b0b" filter="url(#rough)">${esc(bigNum)}</text>
  <text x="${PAD + (bigNum.length > 2 ? 132 : bigNum.length > 1 ? 96 : 55)}" y="${numY - 26}" font-family="${MONO}" font-size="11" letter-spacing="3.2" fill="#0b0b0b">${esc(bigLabel)}</text>
  <text x="${PAD + (bigNum.length > 2 ? 132 : bigNum.length > 1 ? 96 : 55)}" y="${numY - 10}" font-family="${MONO}" font-size="9.5" letter-spacing="1.8" fill="#6e6e6e">UNTIL ${esc(cfg.target)}</text>
  <text x="${W - PAD}" y="${numY}" text-anchor="end" font-family="${SERIF}" font-size="34" fill="#0b0b0b" filter="url(#rough)">${pct}%</text>
  <text x="${W - PAD}" y="${numY - 42}" text-anchor="end" font-family="${MONO}" font-size="9.5" letter-spacing="2.6" fill="#6e6e6e">BURNED</text>

  <path d="${hairline(rnd, footRuleY)}" fill="none" stroke="#0b0b0b" stroke-width="0.8" opacity="0.55" filter="url(#rough)"/>
  <text x="${PAD}" y="${footY}" font-family="${MONO}" font-size="9.5" letter-spacing="2" fill="#4a4a4a">${esc(counter)}</text>
  <text x="${W - PAD}" y="${footY}" text-anchor="end" font-family="${MONO}" font-size="9.5" letter-spacing="2" fill="#4a4a4a">SIC TRANSIT GLORIA MUNDI</text>
</g>

<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.16" style="mix-blend-mode:multiply"/>
</g>
</svg>
`;

mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'assets', 'profile.svg'), svg);

// Bump the cache-buster in the README so GitHub's image proxy can't serve a
// stale copy of the countdown.
const readmePath = join(root, 'readme.md');
const readme = readFileSync(readmePath, 'utf8');
const bumped = readme.replace(/assets\/profile\.svg(\?v=[^"'\s>]*)?/g, `assets/profile.svg?v=${iso(today)}`);
if (bumped !== readme) writeFileSync(readmePath, bumped);

console.log(`memento: ${bigNum} ${bigLabel} · ${counter} · ${pct}% · ${W}x${TOTAL} · ${Math.round(svg.length / 1024)}KB`);

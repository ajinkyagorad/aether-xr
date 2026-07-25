/**
 * Stroke-based icon set drawn on a 24×24 grid.
 *
 * Each entry paints into the current transform assuming a 0..24 box; the caller
 * sets `strokeStyle`, `fillStyle` and `lineWidth` beforehand. Everything is
 * stroked (not filled) so a single set reads correctly on light and dark glass.
 */

const P = (ctx, pts, close = false) => {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
  ctx.stroke();
};
const circle = (ctx, x, y, r, fill = false) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fill ? ctx.fill() : ctx.stroke();
};
const rect = (ctx, x, y, w, h, r = 2) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
};
const arc = (ctx, x, y, r, a0, a1) => {
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
};

export const ICONS = {
  // --- navigation -------------------------------------------------------
  home: (c) => {
    P(c, [3, 10.5, 12, 3.5, 21, 10.5]);
    P(c, [5.5, 9.5, 5.5, 20, 18.5, 20, 18.5, 9.5]);
    P(c, [9.8, 20, 9.8, 14, 14.2, 14, 14.2, 20]);
  },
  explore: (c) => {
    circle(c, 12, 12, 8.5);
    P(c, [15.5, 8.5, 13.2, 13.2, 8.5, 15.5, 10.8, 10.8], true);
  },
  projects: (c) => {
    P(c, [3, 7.5, 3, 19, 21, 19, 21, 7.5], false);
    P(c, [3, 7.5, 9.5, 7.5, 11.2, 5, 21, 5, 21, 7.5]);
  },
  datasets: (c) => {
    ctx_ellipse(c, 12, 6.5, 8, 3);
    P(c, [4, 6.5, 4, 17.5]);
    P(c, [20, 6.5, 20, 17.5]);
    arc(c, 12, 17.5, 8, 0, Math.PI);
    arc(c, 12, 12, 8, 0.35, Math.PI - 0.35);
  },
  ai: (c) => {
    circle(c, 12, 12, 4.2);
    P(c, [12, 2.4, 12, 5.4]);
    P(c, [12, 18.6, 12, 21.6]);
    P(c, [2.4, 12, 5.4, 12]);
    P(c, [18.6, 12, 21.6, 12]);
    P(c, [5.6, 5.6, 7.6, 7.6]);
    P(c, [16.4, 16.4, 18.4, 18.4]);
    P(c, [18.4, 5.6, 16.4, 7.6]);
    P(c, [7.6, 16.4, 5.6, 18.4]);
  },
  settings: (c) => {
    circle(c, 12, 12, 3.2);
    const teeth = 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      P(c, [12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6, 12 + Math.cos(a) * 8.6, 12 + Math.sin(a) * 8.6]);
    }
    circle(c, 12, 12, 6);
  },

  // --- tools ------------------------------------------------------------
  select: (c) => {
    P(c, [6, 3, 6, 18, 10, 14.2, 12.8, 20.4, 15.6, 19, 12.9, 13.1, 18, 12.6], true);
  },
  move: (c) => {
    P(c, [12, 3, 12, 21]);
    P(c, [3, 12, 21, 12]);
    P(c, [12, 3, 9.6, 5.6]); P(c, [12, 3, 14.4, 5.6]);
    P(c, [12, 21, 9.6, 18.4]); P(c, [12, 21, 14.4, 18.4]);
    P(c, [3, 12, 5.6, 9.6]); P(c, [3, 12, 5.6, 14.4]);
    P(c, [21, 12, 18.4, 9.6]); P(c, [21, 12, 18.4, 14.4]);
  },
  rotate: (c) => {
    arc(c, 12, 12, 8, -Math.PI * 0.72, Math.PI * 0.82);
    P(c, [16.8, 4.6, 18.9, 8.4, 14.9, 9.4]);
  },
  scale: (c) => {
    rect(c, 3.5, 3.5, 8, 8, 1.5);
    rect(c, 12.5, 12.5, 8, 8, 1.5);
    P(c, [11.5, 11.5, 15.5, 7.5]);
  },
  zoom: (c) => {
    circle(c, 10.5, 10.5, 6.6);
    P(c, [15.4, 15.4, 20.5, 20.5]);
    P(c, [7.6, 10.5, 13.4, 10.5]);
  },
  measure: (c) => {
    ctx_rotRect(c, 12, 12, 19, 7, -0.42);
    for (let i = -1; i <= 1; i++) {
      const dx = Math.cos(-0.42) * i * 4.6, dy = Math.sin(-0.42) * i * 4.6;
      P(c, [12 + dx + Math.sin(-0.42) * 3.5, 12 + dy - Math.cos(-0.42) * 3.5,
            12 + dx + Math.sin(-0.42) * 0.6, 12 + dy - Math.cos(-0.42) * 0.6]);
    }
  },
  annotate: (c) => {
    P(c, [4, 20, 5.4, 15.6, 16.4, 4.6, 19.4, 7.6, 8.4, 18.6], true);
    P(c, [14.2, 6.8, 17.2, 9.8]);
  },
  layers: (c) => {
    P(c, [12, 3, 21, 8, 12, 13, 3, 8], true);
    P(c, [3, 12, 12, 17, 21, 12]);
    P(c, [3, 16, 12, 21, 21, 16]);
  },
  simulate: (c) => {
    circle(c, 12, 12, 8.4);
    P(c, [10, 8.2, 16, 12, 10, 15.8], true);
  },
  record: (c) => {
    circle(c, 12, 12, 8.6);
    circle(c, 12, 12, 3.6, true);
  },
  share: (c) => {
    circle(c, 17.5, 6, 2.8);
    circle(c, 6.5, 12, 2.8);
    circle(c, 17.5, 18, 2.8);
    P(c, [9, 10.7, 15, 7.3]);
    P(c, [9, 13.3, 15, 16.7]);
  },
  section: (c) => {
    P(c, [3, 15, 21, 9]);
    P(c, [6, 19, 6, 12.2]);
    P(c, [18, 12, 18, 5.2]);
    rect(c, 6, 5.2, 12, 6.8, 1);
  },
  exportIcon: (c) => {
    P(c, [12, 15.5, 12, 3.5]);
    P(c, [8.4, 7, 12, 3.5, 15.6, 7]);
    P(c, [4.5, 13, 4.5, 20, 19.5, 20, 19.5, 13]);
  },
  importIcon: (c) => {
    P(c, [12, 3.5, 12, 15.5]);
    P(c, [8.4, 12, 12, 15.5, 15.6, 12]);
    P(c, [4.5, 13, 4.5, 20, 19.5, 20, 19.5, 13]);
  },
  focus: (c) => {
    circle(c, 12, 12, 3);
    P(c, [3.5, 8, 3.5, 3.5, 8, 3.5]);
    P(c, [16, 3.5, 20.5, 3.5, 20.5, 8]);
    P(c, [20.5, 16, 20.5, 20.5, 16, 20.5]);
    P(c, [8, 20.5, 3.5, 20.5, 3.5, 16]);
  },
  grab: (c) => {
    P(c, [7, 13, 7, 8.4]);
    P(c, [10.3, 12, 10.3, 6.2]);
    P(c, [13.6, 12, 13.6, 6.8]);
    P(c, [16.9, 12.6, 16.9, 9]);
    P(c, [7, 13, 7, 16.4, 9.4, 20.5, 15, 20.5, 16.9, 16.4, 16.9, 12.6]);
  },
  notes: (c) => {
    rect(c, 4.5, 3.5, 15, 17, 2);
    P(c, [8, 8.5, 16, 8.5]);
    P(c, [8, 12, 16, 12]);
    P(c, [8, 15.5, 13, 15.5]);
  },

  // --- content / stats --------------------------------------------------
  sun: (c) => {
    circle(c, 12, 12, 4.2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      P(c, [12 + Math.cos(a) * 6.4, 12 + Math.sin(a) * 6.4, 12 + Math.cos(a) * 8.8, 12 + Math.sin(a) * 8.8]);
    }
  },
  cloud: (c) => {
    ctx_cloud(c);
  },
  rain: (c) => {
    ctx_cloud(c, -2);
    P(c, [8.5, 17.5, 7.4, 20.4]);
    P(c, [12, 17.8, 10.9, 20.7]);
    P(c, [15.5, 17.5, 14.4, 20.4]);
  },
  clock: (c) => {
    circle(c, 12, 12, 8.6);
    P(c, [12, 6.6, 12, 12, 16, 14.2]);
  },
  wind: (c) => {
    arc(c, 13, 7.5, 3, -Math.PI * 0.5, Math.PI * 0.85);
    P(c, [3.5, 10.5, 13, 10.5]);
    arc(c, 15, 16.5, 3, -Math.PI * 0.85, Math.PI * 0.5);
    P(c, [3.5, 13.5, 15, 13.5]);
  },
  droplet: (c) => {
    c.beginPath();
    c.moveTo(12, 3);
    c.bezierCurveTo(17.5, 10, 19, 12.6, 19, 15.2);
    c.arc(12, 15.2, 7, 0, Math.PI);
    c.bezierCurveTo(5, 12.6, 6.5, 10, 12, 3);
    c.stroke();
  },
  car: (c) => {
    P(c, [3.2, 15.5, 4.6, 10.6, 6.6, 8, 17.4, 8, 19.4, 10.6, 20.8, 15.5]);
    rect(c, 3.2, 12.5, 17.6, 5, 1.6);
    circle(c, 7.4, 17.5, 1.8);
    circle(c, 16.6, 17.5, 1.8);
    P(c, [4.8, 11, 19.2, 11]);
  },
  leaf: (c) => {
    c.beginPath();
    c.moveTo(4.5, 19.5);
    c.bezierCurveTo(4.5, 9, 10, 4, 19.5, 4.5);
    c.bezierCurveTo(20, 14, 15, 19.5, 4.5, 19.5);
    c.stroke();
    P(c, [4.5, 19.5, 16.5, 7.5]);
  },
  building: (c) => {
    rect(c, 4, 6.5, 7, 14, 1);
    rect(c, 13, 3.5, 7, 17, 1);
    for (let r = 0; r < 3; r++) {
      P(c, [6, 10 + r * 3.4, 9, 10 + r * 3.4]);
      P(c, [15, 7 + r * 3.4, 18, 7 + r * 3.4]);
    }
  },
  people: (c) => {
    circle(c, 9, 8.5, 3.4);
    arc(c, 9, 19.4, 6.2, Math.PI, 0);
    arc(c, 16.6, 8.8, 2.9, -Math.PI * 0.85, Math.PI * 0.35);
    arc(c, 16, 19.4, 5.2, Math.PI * 1.15, Math.PI * 1.9);
  },
  box: (c) => {
    P(c, [12, 3, 20.5, 7.6, 20.5, 16.4, 12, 21, 3.5, 16.4, 3.5, 7.6], true);
    P(c, [3.5, 7.6, 12, 12.2, 20.5, 7.6]);
    P(c, [12, 12.2, 12, 21]);
  },
  chart: (c) => {
    P(c, [3.5, 20.5, 20.5, 20.5]);
    P(c, [6.5, 20.5, 6.5, 13]);
    P(c, [11, 20.5, 11, 8]);
    P(c, [15.5, 20.5, 15.5, 15]);
    P(c, [20, 20.5, 20, 4.5]);
  },
  trend: (c) => {
    P(c, [3.5, 17, 9, 11, 13, 14.6, 20.5, 6.5]);
    P(c, [15.5, 6.5, 20.5, 6.5, 20.5, 11.5]);
  },
  globe: (c) => {
    circle(c, 12, 12, 8.6);
    ctx_ellipse(c, 12, 12, 3.6, 8.6);
    P(c, [3.6, 12, 20.4, 12]);
    P(c, [5.2, 7.4, 18.8, 7.4]);
    P(c, [5.2, 16.6, 18.8, 16.6]);
  },
  satellite: (c) => {
    ctx_rotRect(c, 12, 12, 6, 6, 0.78);
    ctx_rotRect(c, 4.6, 12, 5.4, 8.4, 0.78);
    ctx_rotRect(c, 19.4, 12, 5.4, 8.4, 0.78);
  },
  search: (c) => {
    circle(c, 10.5, 10.5, 6.6);
    P(c, [15.4, 15.4, 20.5, 20.5]);
  },
  send: (c) => {
    P(c, [3, 12, 21, 4, 13.5, 21, 11.4, 13.6], true);
    P(c, [3, 12, 11.4, 13.6]);
  },
  eye: (c) => {
    c.beginPath();
    c.moveTo(2.6, 12);
    c.bezierCurveTo(6, 6, 18, 6, 21.4, 12);
    c.bezierCurveTo(18, 18, 6, 18, 2.6, 12);
    c.stroke();
    circle(c, 12, 12, 3.2);
  },
  grid: (c) => {
    rect(c, 3.5, 3.5, 7.2, 7.2, 1.4);
    rect(c, 13.3, 3.5, 7.2, 7.2, 1.4);
    rect(c, 3.5, 13.3, 7.2, 7.2, 1.4);
    rect(c, 13.3, 13.3, 7.2, 7.2, 1.4);
  },
  target: (c) => {
    circle(c, 12, 12, 8.4);
    circle(c, 12, 12, 4.4);
    circle(c, 12, 12, 1.2, true);
  },
  alert: (c) => {
    P(c, [12, 3.6, 21.4, 20, 2.6, 20], true);
    P(c, [12, 9.4, 12, 14.4]);
    circle(c, 12, 17.2, 0.95, true);
  },
  check: (c) => P(c, [4.5, 12.6, 9.6, 17.6, 19.5, 6.8]),
  close: (c) => {
    P(c, [5.8, 5.8, 18.2, 18.2]);
    P(c, [18.2, 5.8, 5.8, 18.2]);
  },
  plus: (c) => {
    P(c, [12, 4.5, 12, 19.5]);
    P(c, [4.5, 12, 19.5, 12]);
  },
  minus: (c) => P(c, [4.5, 12, 19.5, 12]),
  chevL: (c) => P(c, [15, 4.5, 8, 12, 15, 19.5]),
  chevR: (c) => P(c, [9, 4.5, 16, 12, 9, 19.5]),
  chevD: (c) => P(c, [4.5, 9, 12, 16, 19.5, 9]),
  heart: (c) => {
    c.beginPath();
    c.moveTo(12, 20);
    c.bezierCurveTo(2, 13.2, 3.4, 5.2, 8.4, 5.2);
    c.bezierCurveTo(10.6, 5.2, 11.7, 6.7, 12, 7.6);
    c.bezierCurveTo(12.3, 6.7, 13.4, 5.2, 15.6, 5.2);
    c.bezierCurveTo(20.6, 5.2, 22, 13.2, 12, 20);
    c.stroke();
  },
  sparkle: (c) => {
    ctx_star(c, 12, 11, 8.4, 2.6);
    ctx_star(c, 19, 18.5, 4, 1.3);
  },
  lock: (c) => {
    rect(c, 5, 10.5, 14, 10, 2);
    arc(c, 12, 10.5, 4.2, Math.PI, 0);
    circle(c, 12, 15.2, 1.4, true);
  },
  bolt: (c) => P(c, [13.4, 2.5, 5.5, 13.4, 11.2, 13.4, 10.2, 21.5, 18.6, 10.2, 12.6, 10.2], true),
  flame: (c) => {
    c.beginPath();
    c.moveTo(12, 2.8);
    c.bezierCurveTo(17.5, 8.4, 19, 11.6, 19, 14.6);
    c.bezierCurveTo(19, 18.5, 15.9, 21.2, 12, 21.2);
    c.bezierCurveTo(8.1, 21.2, 5, 18.5, 5, 14.6);
    c.bezierCurveTo(5, 11.6, 8, 9.5, 9.6, 6.4);
    c.bezierCurveTo(10.6, 8.8, 11.4, 9.8, 12, 2.8);
    c.stroke();
  },
  mountain: (c) => {
    P(c, [2.4, 19.5, 9, 8, 13.2, 14.4, 15.6, 11, 21.6, 19.5], true);
    circle(c, 17.6, 6.4, 2.2);
  },
  water: (c) => {
    for (let i = 0; i < 3; i++) {
      const y = 8.5 + i * 4;
      c.beginPath();
      c.moveTo(3, y);
      c.bezierCurveTo(6, y - 2.4, 9, y + 2.4, 12, y);
      c.bezierCurveTo(15, y - 2.4, 18, y + 2.4, 21, y);
      c.stroke();
    }
  },
  temperature: (c) => {
    arc(c, 12, 17.4, 3.4, -Math.PI * 0.72, Math.PI * 1.72);
    P(c, [9.6, 15, 9.6, 6, 14.4, 6, 14.4, 15]);
    circle(c, 12, 17.4, 1.5, true);
  },
  history: (c) => {
    arc(c, 12, 12, 8.4, -Math.PI * 0.35, Math.PI * 1.4);
    P(c, [4.6, 7.4, 4, 12.4, 9, 11.6]);
    P(c, [12, 7.4, 12, 12.2, 15.6, 14]);
  },
  route: (c) => {
    circle(c, 5.6, 6.4, 2.6);
    circle(c, 18.4, 17.6, 2.6);
    P(c, [5.6, 9, 5.6, 13.4]);
    c.beginPath();
    c.moveTo(5.6, 13.4);
    c.bezierCurveTo(5.6, 17.6, 9.6, 17.6, 12, 17.6);
    c.lineTo(15.8, 17.6);
    c.stroke();
  },
  scan: (c) => {
    P(c, [3.5, 8.5, 3.5, 3.5, 8.5, 3.5]);
    P(c, [15.5, 3.5, 20.5, 3.5, 20.5, 8.5]);
    P(c, [20.5, 15.5, 20.5, 20.5, 15.5, 20.5]);
    P(c, [8.5, 20.5, 3.5, 20.5, 3.5, 15.5]);
    P(c, [3.5, 12, 20.5, 12]);
  },
  dashboard: (c) => {
    rect(c, 3.5, 3.5, 7.6, 10, 1.4);
    rect(c, 13.4, 3.5, 7.1, 6, 1.4);
    rect(c, 3.5, 16, 7.6, 4.5, 1.4);
    rect(c, 13.4, 12, 7.1, 8.5, 1.4);
  },
  gauge: (c) => {
    arc(c, 12, 16, 8.4, Math.PI, 0);
    P(c, [12, 16, 16.4, 10.6]);
    circle(c, 12, 16, 1.4, true);
  },
  pin: (c) => {
    c.beginPath();
    c.moveTo(12, 21.4);
    c.bezierCurveTo(12, 21.4, 19.4, 14.4, 19.4, 9.6);
    c.arc(12, 9.6, 7.4, 0, Math.PI, true);
    c.bezierCurveTo(4.6, 14.4, 12, 21.4, 12, 21.4);
    c.stroke();
    circle(c, 12, 9.4, 2.6);
  },
  seed: (c) => {
    c.beginPath();
    c.moveTo(12, 21);
    c.bezierCurveTo(12, 13, 12, 9, 12, 5);
    c.stroke();
    c.beginPath();
    c.moveTo(12, 12.5);
    c.bezierCurveTo(6, 12.5, 4.5, 8.5, 4.8, 5.8);
    c.bezierCurveTo(8.5, 5.6, 12, 8, 12, 12.5);
    c.stroke();
    c.beginPath();
    c.moveTo(12, 15.5);
    c.bezierCurveTo(18, 15.5, 19.5, 11.5, 19.2, 8.8);
    c.bezierCurveTo(15.5, 8.6, 12, 11, 12, 15.5);
    c.stroke();
  },
  fish: (c) => {
    c.beginPath();
    c.moveTo(3.5, 12);
    c.bezierCurveTo(7, 6.4, 15, 6.4, 19, 12);
    c.bezierCurveTo(15, 17.6, 7, 17.6, 3.5, 12);
    c.stroke();
    P(c, [19, 12, 21.8, 8.4, 21.8, 15.6], true);
    circle(c, 7.6, 11, 0.95, true);
  },
  atom: (c) => {
    circle(c, 12, 12, 2.2, true);
    ctx_ellipse(c, 12, 12, 9.2, 3.8, 0);
    ctx_ellipse(c, 12, 12, 9.2, 3.8, 1.05);
    ctx_ellipse(c, 12, 12, 9.2, 3.8, -1.05);
  },
};

// --- helpers used by several icons -----------------------------------------
function ctx_ellipse(c, x, y, rx, ry, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.stroke();
}
function ctx_rotRect(c, x, y, w, h, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  c.roundRect(-w / 2, -h / 2, w, h, 1.4);
  c.stroke();
  c.restore();
}
function ctx_cloud(c, dy = 0) {
  c.beginPath();
  c.moveTo(6.4, 17.5 + dy);
  c.arc(9, 13.4 + dy, 4.2, Math.PI * 0.6, Math.PI * 1.55);
  c.arc(14.4, 11.6 + dy, 4.6, Math.PI * 1.35, Math.PI * 0.28);
  c.arc(17.6, 15 + dy, 2.9, Math.PI * 1.7, Math.PI * 0.5);
  c.closePath();
  c.stroke();
}
function ctx_star(c, x, y, outer, inner) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer / 2 : inner;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
  }
  c.closePath();
  c.stroke();
}

/**
 * Draw icon `name` centred at (x,y) with the given box `size` in canvas px.
 */
export function icon(ctx, name, x, y, size, stroke, width = 2) {
  const fn = ICONS[name];
  if (!fn) return;
  const s = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(s, s);
  ctx.lineWidth = width / s;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  fn(ctx);
  ctx.restore();
}

export const hasIcon = (n) => !!ICONS[n];

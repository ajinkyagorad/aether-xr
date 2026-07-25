/**
 * Canvas widget painter.
 *
 * A panel is painted twice into two canvases of identical size: the `base`
 * layer (normal-blended, carries the frosted body and all type) and the `glow`
 * layer (additive, carries only emissive accents and is blurred at the end).
 * Compositing those two planes in 3D reproduces the bloom of the concept art
 * without a post-processing pass — which matters because WebXR renders to a
 * multiview framebuffer where full-screen effects are expensive on Quest.
 *
 * Every widget registers its interactive bounds through `p.hit(...)` so the
 * panel can hit-test a fingertip or pinch-ray against canvas pixel space.
 */

import { c, mix } from '../core/theme.js';
import { icon } from './icons.js';

export class Painter {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} theme
   * @param {'base'|'glow'} pass
   * @param {object[]} hits  collected interactive regions (base pass only)
   */
  constructor(ctx, theme, pass, hits) {
    this.ctx = ctx;
    this.t = theme;
    this.pass = pass;
    this.glowPass = pass === 'glow';
    this.hits = hits;
    this.now = performance.now() / 1000;
  }

  /** Run `fn` only when the requested layer matches the current pass. */
  layer(which, fn) {
    const on = this.glowPass ? which !== 'base' : which !== 'glow';
    if (on) fn(this.ctx);
  }

  /** Register an interactive region in canvas pixel space. */
  hit(id, x, y, w, h, extra = {}) {
    if (!this.glowPass && this.hits) this.hits.push({ id, x, y, w, h, ...extra });
    return id;
  }

  // =========================================================================
  // type
  // =========================================================================

  font(size, weight = 400, mono = false) {
    this.ctx.font = `${weight} ${size}px ${mono ? this.t.mono : this.t.font}`;
    return this.ctx;
  }

  /** Truncate `s` to fit `max` px, appending an ellipsis. */
  fit(s, max) {
    const ctx = this.ctx;
    if (ctx.measureText(s).width <= max) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + '…').width <= max) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo).trimEnd() + '…';
  }

  /**
   * Draw text. `align` is 'left' | 'center' | 'right'; `y` is the vertical
   * centre of the cap box, which keeps rows visually aligned with icons.
   */
  text(s, x, y, { size = 22, weight = 400, color, align = 'left', max, mono = false, track = 0, caps = false, layer = 'base' } = {}) {
    this.layer(layer, (ctx) => {
      ctx.save();
      this.font(size, weight, mono);
      ctx.letterSpacing = track ? `${(track * size).toFixed(2)}px` : '0px';
      let str = caps ? String(s).toUpperCase() : String(s);
      if (max) str = this.fit(str, max);
      ctx.fillStyle = color ?? c(this.t.ink);
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillText(str, x, y + size * 0.03);
      ctx.restore();
    });
  }

  /** Uppercase tracked micro-label used for every section heading. */
  micro(s, x, y, { size = 15, color, align = 'left', max, layer = 'base' } = {}) {
    this.text(s, x, y, {
      size, weight: 600, align, max, caps: true, layer,
      track: this.t.track,
      color: color ?? c(this.t.ink2, 0.92),
    });
  }

  /** Word-wrapped paragraph; returns the y just past the last line. */
  paragraph(s, x, y, w, { size = 19, weight = 400, color, lh = 1.45, maxLines = 99 } = {}) {
    const ctx = this.ctx;
    this.font(size, weight);
    const words = String(s).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > w && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      } else line = next;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines) lines[maxLines - 1] = this.fit(lines[maxLines - 1], w);
    lines.forEach((l, i) =>
      this.text(l, x, y + i * size * lh, { size, weight, color: color ?? c(this.t.ink, 0.88) })
    );
    return y + lines.length * size * lh;
  }

  icon(name, x, y, size, color, width = 2, layer = 'base') {
    this.layer(layer, (ctx) => icon(ctx, name, x, y, size, color, width));
  }

  // =========================================================================
  // surfaces
  // =========================================================================

  rr(x, y, w, h, r) {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    return this.ctx;
  }

  /**
   * The frosted glass slab every panel sits on: vertical body gradient, a
   * hairline outline, and a specular sweep along the top edge.
   */
  glass(x, y, w, h, { r = this.t.radius, alpha = 1, edge = true, spec = true, tint = null, elevated = false } = {}) {
    const t = this.t;
    this.layer('base', (ctx) => {
      ctx.save();
      const g = ctx.createLinearGradient(x, y, x + w * 0.25, y + h);
      const top = tint ?? t.glassTop;
      const bot = tint ?? t.glass;
      g.addColorStop(0, c(top, t.glassA * alpha * (elevated ? 1.16 : 1)));
      g.addColorStop(0.55, c(bot, t.glassA * alpha));
      g.addColorStop(1, c(bot, t.glassA * alpha * 0.82));
      this.rr(x, y, w, h, r);
      ctx.fillStyle = g;
      ctx.fill();

      if (edge) {
        this.rr(x + 0.5, y + 0.5, w - 1, h - 1, r);
        ctx.lineWidth = t.hairline;
        ctx.strokeStyle = c(t.edge, t.edgeA * alpha);
        ctx.stroke();
      }

      if (spec) {
        // A clipped arc of light riding the top-left bevel.
        ctx.save();
        this.rr(x, y, w, h, r);
        ctx.clip();
        const sg = ctx.createLinearGradient(x, y, x, y + Math.min(h * 0.5, r * 3.2));
        sg.addColorStop(0, c(t.spec, t.specA * 0.5 * alpha));
        sg.addColorStop(1, c(t.spec, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(x, y, w, Math.min(h * 0.5, r * 3.2));
        ctx.beginPath();
        ctx.moveTo(x + r * 0.4, y + 1.2);
        ctx.lineTo(x + w - r * 0.4, y + 1.2);
        ctx.lineWidth = t.hairline;
        ctx.strokeStyle = c(t.spec, t.specA * 0.85 * alpha);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    });
  }

  /** A recessed well: thumbnails, input fields, chart plots, progress tracks. */
  well(x, y, w, h, { r = 10, alpha = 1, fill = null } = {}) {
    const t = this.t;
    this.layer('base', (ctx) => {
      this.rr(x, y, w, h, r);
      ctx.fillStyle = fill ?? c(t.inset, t.insetA * alpha);
      ctx.fill();
      this.rr(x + 0.5, y + 0.5, w - 1, h - 1, r);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(t.edge, t.edgeA * 0.4 * alpha);
      ctx.stroke();
    });
  }

  /** Additive halo behind an element; only paints on the glow pass. */
  halo(x, y, w, h, color, { r = 12, alpha = 0.5 } = {}) {
    this.layer('glow', (ctx) => {
      this.rr(x, y, w, h, r);
      ctx.fillStyle = c(color, alpha * this.t.glow);
      ctx.fill();
    });
  }

  divider(x, y, w, { alpha = 1 } = {}) {
    this.layer('base', (ctx) => {
      ctx.beginPath();
      ctx.moveTo(x, y + 0.5);
      ctx.lineTo(x + w, y + 0.5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(this.t.edge, this.t.edgeA * 0.42 * alpha);
      ctx.stroke();
    });
  }

  // =========================================================================
  // controls
  // =========================================================================

  /**
   * Icon-over-label tool button (the bottom dock in the boards).
   * @returns the hit id
   */
  tool(id, x, y, w, h, { label, ico, active = false, hover = 0, enabled = true } = {}) {
    const t = this.t;
    const a = enabled ? 1 : 0.4;
    const lift = hover * 0.35 + (active ? 1 : 0);
    if (lift > 0.02) {
      this.halo(x + 2, y + 2, w - 4, h - 4, active ? t.accent : t.ink, { r: 12, alpha: 0.16 * lift });
      this.layer('base', (ctx) => {
        this.rr(x, y, w, h, 12);
        ctx.fillStyle = c(active ? t.accent : t.spec, (active ? 0.2 : 0.1) * lift);
        ctx.fill();
      });
    }
    const col = active ? t.accent : t.ink;
    this.icon(ico, x + w / 2, y + h * 0.36, Math.min(w, h) * 0.42, c(col, a * (active ? 1 : 0.86)), 2, 'base');
    if (active) this.icon(ico, x + w / 2, y + h * 0.36, Math.min(w, h) * 0.42, c(col, 0.9), 3, 'glow');
    this.text(label, x + w / 2, y + h * 0.79, {
      size: h * 0.185, weight: active ? 600 : 500, align: 'center', max: w - 6,
      color: c(active ? t.accent : t.ink2, a),
    });
    return this.hit(id, x, y, w, h, { kind: 'button' });
  }

  /** Left-aligned nav rail entry. */
  navItem(id, x, y, w, h, { label, ico, active = false, hover = 0 }) {
    const t = this.t;
    if (active || hover > 0.02) {
      this.layer('base', (ctx) => {
        this.rr(x, y, w, h, 11);
        ctx.fillStyle = c(active ? t.accent : t.spec, active ? 0.16 : 0.09 * hover);
        ctx.fill();
      });
      if (active) this.halo(x, y, w, h, t.accent, { r: 11, alpha: 0.2 });
    }
    const col = active ? t.accent : t.ink2;
    this.icon(ico, x + h * 0.55, y + h / 2, h * 0.5, c(col, active ? 1 : 0.86), 1.9);
    this.text(label, x + h * 0.98, y + h / 2, {
      size: h * 0.33, weight: active ? 600 : 450, max: w - h * 1.2,
      color: c(active ? t.ink : t.ink2, 1),
    });
    return this.hit(id, x, y, w, h, { kind: 'button' });
  }

  /**
   * Underlined tab, as along the top bar. `size` overrides the label's default
   * proportional sizing, which the seven-up view rail needs to avoid eliding
   * every label to "OVERVIE…".
   */
  tab(id, x, y, w, h, { label, ico, active = false, hover = 0, size = null }) {
    const t = this.t;
    const col = active ? t.accent : t.ink2;
    if (active) {
      this.layer('base', (ctx) => {
        this.rr(x, y, w, h, 9);
        ctx.fillStyle = c(t.accent, 0.14);
        ctx.fill();
      });
      this.halo(x + w * 0.1, y + h - 5, w * 0.8, 4, t.accent, { r: 2, alpha: 0.85 });
      this.layer('base', (ctx) => {
        this.rr(x + w * 0.16, y + h - 4.5, w * 0.68, 2.6, 1.3);
        ctx.fillStyle = c(t.accent, 0.95);
        ctx.fill();
      });
    } else if (hover > 0.02) {
      this.layer('base', (ctx) => {
        this.rr(x, y, w, h, 9);
        ctx.fillStyle = c(t.spec, 0.08 * hover);
        ctx.fill();
      });
    }
    const fs = size ?? h * 0.29;
    const iw = ico ? fs * 1.45 : 0;
    const totalPad = ico ? iw + fs * 0.4 : 0;
    if (ico) {
      const labelW = Math.min(this.measure(label.toUpperCase(), fs, 600), w - totalPad - 6);
      this.icon(ico, x + w / 2 - (labelW + totalPad) / 2 + iw / 2, y + h / 2, iw, c(col, 0.92), 1.9);
    }
    this.text(label, x + w / 2 + totalPad / 2, y + h / 2, {
      size: fs, weight: active ? 650 : 500, align: 'center', caps: true,
      track: t.track * 0.6, max: w - totalPad - 6, color: c(col, active ? 1 : 0.85),
    });
    return this.hit(id, x, y, w, h, { kind: 'button' });
  }

  measure(s, size, weight = 400, mono = false) {
    this.font(size, weight, mono);
    return this.ctx.measureText(String(s)).width;
  }

  /** Rounded pill button, optionally with a leading icon. */
  pill(id, x, y, w, h, { label, ico, active = false, hover = 0, tone = 'default', align = 'left' }) {
    const t = this.t;
    const tint = tone === 'accent' ? t.accent : tone === 'warn' ? t.warn : tone === 'bad' ? t.bad : t.ink;
    const solid = tone === 'accent' && active;
    this.layer('base', (ctx) => {
      this.rr(x, y, w, h, h / 2);
      ctx.fillStyle = solid ? c(t.accent, 0.9) : c(active ? tint : t.spec, active ? 0.18 : 0.06 + 0.07 * hover);
      ctx.fill();
      this.rr(x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(active ? tint : t.edge, active ? 0.55 : t.edgeA * 0.5);
      ctx.stroke();
    });
    if (active || hover > 0.3) this.halo(x, y, w, h, tint, { r: h / 2, alpha: 0.22 * (active ? 1 : hover) });
    const pad = h * 0.42;
    let tx = align === 'center' ? x + w / 2 : x + pad;
    const col = solid ? (t.light ? [255, 255, 255] : [8, 16, 24]) : c(active ? tint : t.ink, 0.94);
    if (ico) {
      this.icon(ico, x + pad * 0.9, y + h / 2, h * 0.46, typeof col === 'string' ? col : c(col, 1), 1.8);
      tx = align === 'center' ? x + w / 2 + h * 0.3 : x + pad * 1.55;
    }
    this.text(label, tx, y + h / 2, {
      size: h * 0.36, weight: 550, align: align === 'center' ? 'center' : 'left',
      max: w - (ico ? h * 1.5 : pad * 2), color: typeof col === 'string' ? col : c(col, 1),
    });
    return this.hit(id, x, y, w, h, { kind: 'button' });
  }

  /** Small non-interactive status chip. */
  chip(x, y, label, { tone = 'accent', size = 15 } = {}) {
    const t = this.t;
    const tint = { accent: t.accent, good: t.good, warn: t.warn, bad: t.bad, mute: t.ink3 }[tone] ?? t.accent;
    const w = this.measure(label.toUpperCase(), size, 650) + size * 2.1;
    const h = size * 1.85;
    this.layer('base', (ctx) => {
      this.rr(x, y - h / 2, w, h, h / 2);
      ctx.fillStyle = c(tint, 0.16);
      ctx.fill();
    });
    this.halo(x, y - h / 2, w, h, tint, { r: h / 2, alpha: 0.2 });
    this.text(label, x + w / 2, y, {
      size, weight: 700, align: 'center', caps: true, track: t.track * 0.5, color: c(tint, 1),
    });
    return w;
  }

  /** On/off switch. */
  toggle(id, x, y, w, h, on, hover = 0) {
    const t = this.t;
    const k = on ? 1 : 0;
    this.layer('base', (ctx) => {
      this.rr(x, y, w, h, h / 2);
      ctx.fillStyle = on ? c(t.accent, 0.8) : c(t.inset, t.insetA + 0.12);
      ctx.fill();
      this.rr(x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(on ? t.accent : t.edge, on ? 0.7 : t.edgeA * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + h / 2 + k * (w - h), y + h / 2, h * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = c(t.light && !on ? [90, 100, 120] : [255, 255, 255], on ? 0.98 : 0.7);
      ctx.fill();
    });
    if (on) this.halo(x, y, w, h, t.accent, { r: h / 2, alpha: 0.35 + 0.2 * hover });
    return this.hit(id, x - 6, y - 8, w + 12, h + 16, { kind: 'button' });
  }

  /**
   * Horizontal slider. `v` is 0..1. Registers a `drag` region so the panel can
   * stream continuous values while a pinch is held.
   */
  slider(id, x, y, w, v, { h = 8, label, valueText, tint = null, showTicks = 0 } = {}) {
    const t = this.t;
    const col = tint ?? t.accent;
    const cy = y + h / 2;
    if (label) this.micro(label, x, cy - h * 2.6, { size: 14 });
    if (valueText !== undefined)
      this.text(valueText, x + w, cy - h * 2.6, { size: 16, weight: 600, align: 'right', color: c(t.ink, 0.95), mono: true });

    this.layer('base', (ctx) => {
      this.rr(x, y, w, h, h / 2);
      ctx.fillStyle = c(t.inset, t.insetA + 0.1);
      ctx.fill();
      this.rr(x, y, Math.max(h, w * v), h, h / 2);
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, c(col, 0.7));
      g.addColorStop(1, c(mix(col, t.accent2, 0.6), 0.95));
      ctx.fillStyle = g;
      ctx.fill();
    });
    this.halo(x, y - 2, Math.max(h, w * v), h + 4, col, { r: h, alpha: 0.4 });

    for (let i = 0; i < showTicks; i++) {
      const tx = x + (w * i) / (showTicks - 1);
      this.layer('base', (ctx) => {
        ctx.beginPath();
        ctx.moveTo(tx, y + h + 5);
        ctx.lineTo(tx, y + h + 10);
        ctx.lineWidth = 1;
        ctx.strokeStyle = c(t.ink3, 0.5);
        ctx.stroke();
      });
    }

    const kx = x + w * v;
    this.layer('base', (ctx) => {
      ctx.beginPath();
      ctx.arc(kx, cy, h * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = c([255, 255, 255], 0.97);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = c(col, 0.8);
      ctx.stroke();
    });
    this.halo(kx - h * 2.4, cy - h * 2.4, h * 4.8, h * 4.8, col, { r: h * 2.4, alpha: 0.5 });

    return this.hit(id, x - h * 2, y - h * 1.6, w + h * 4, h * 4.2, {
      kind: 'slider', trackX: x, trackW: w,
    });
  }

  /** Text field with placeholder and a trailing send affordance. */
  field(id, x, y, w, h, { placeholder, value = '', sendId = null, focused = false }) {
    const t = this.t;
    this.well(x, y, w, h, { r: h / 2 });
    if (focused) this.halo(x, y, w, h, t.accent, { r: h / 2, alpha: 0.3 });
    const hasVal = value.length > 0;
    this.text(hasVal ? value : placeholder, x + h * 0.55, y + h / 2, {
      size: h * 0.36, weight: 450, max: w - h * 1.9,
      color: c(hasVal ? t.ink : t.ink3, hasVal ? 0.96 : 0.8),
    });
    if (focused) {
      const cx = x + h * 0.55 + this.measure(hasVal ? value : '', h * 0.36, 450) + 3;
      this.layer('base', (ctx) => {
        ctx.fillStyle = c(t.accent, 0.55 + 0.45 * Math.sin(this.now * 6));
        ctx.fillRect(cx, y + h * 0.26, 2.2, h * 0.48);
      });
    }
    if (sendId) {
      const bs = h * 0.72;
      const bx = x + w - bs - (h - bs) / 2;
      this.layer('base', (ctx) => {
        ctx.beginPath();
        ctx.arc(bx + bs / 2, y + h / 2, bs / 2, 0, Math.PI * 2);
        ctx.fillStyle = c(t.accent, 0.85);
        ctx.fill();
      });
      this.halo(bx, y + (h - bs) / 2, bs, bs, t.accent, { r: bs / 2, alpha: 0.5 });
      this.icon('send', bx + bs / 2, y + h / 2, bs * 0.52, c(t.light ? [255, 255, 255] : [6, 14, 22], 1), 2.2);
      this.hit(sendId, bx - 4, y + 2, bs + 8, h - 4, { kind: 'button' });
    }
    return this.hit(id, x, y, w - (sendId ? h : 0), h, { kind: 'button' });
  }

  // =========================================================================
  // data display
  // =========================================================================

  /** Label / value row with an optional leading icon and trailing tone. */
  stat(x, y, w, { ico, label, value, tone, size = 19 } = {}) {
    const t = this.t;
    const tint = tone ? { good: t.good, warn: t.warn, bad: t.bad, accent: t.accent }[tone] : null;
    let lx = x;
    if (ico) {
      this.icon(ico, x + size * 0.55, y, size * 1.05, c(t.ink2, 0.82), 1.7);
      lx = x + size * 1.45;
    }
    this.text(label, lx, y, { size, weight: 450, color: c(t.ink2, 0.94), max: w * 0.58 });
    this.text(value, x + w, y, {
      size, weight: 600, align: 'right', mono: /^[\d.,+\-−%\s°/A-Z]+$/.test(String(value)),
      color: c(tint ?? t.ink, 1), max: w * 0.46,
    });
    if (tint) this.halo(x + w - 60, y - size * 0.7, 60, size * 1.4, tint, { r: 6, alpha: 0.1 });
  }

  /** Big number with a caption beneath — the hero readout on a card. */
  bigStat(x, y, value, caption, { size = 54, tint = null, align = 'left' } = {}) {
    const t = this.t;
    this.text(value, x, y, { size, weight: 300, align, color: c(tint ?? t.ink, 1) });
    if (tint) this.halo(x - (align === 'center' ? 70 : 0), y - size * 0.6, 150, size * 1.2, tint, { r: 14, alpha: 0.14 });
    this.micro(caption, x, y + size * 0.68, { size: size * 0.24, align });
  }

  /** Arc gauge with a percentage in the middle. */
  gauge(x, y, r, v, { label, tint = null, thickness = null, sub = null } = {}) {
    const t = this.t;
    const col = tint ?? (v > 0.66 ? t.good : v > 0.33 ? t.warn : t.bad);
    const th = thickness ?? r * 0.19;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    this.layer('base', (ctx) => {
      ctx.lineCap = 'round';
      ctx.lineWidth = th;
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.strokeStyle = c(t.inset, t.insetA + 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a0 + (a1 - a0) * v);
      ctx.strokeStyle = c(col, 0.95);
      ctx.stroke();
    });
    this.layer('glow', (ctx) => {
      ctx.lineCap = 'round';
      ctx.lineWidth = th * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a0 + (a1 - a0) * v);
      ctx.strokeStyle = c(col, 0.55 * t.glow);
      ctx.stroke();
    });
    this.text(Math.round(v * 100) + '%', x, y - (sub ? r * 0.12 : 0), {
      size: r * 0.56, weight: 400, align: 'center', color: c(t.ink, 1),
    });
    if (sub) this.text(sub, x, y + r * 0.36, { size: r * 0.24, align: 'center', color: c(t.ink2, 0.9) });
    if (label) this.micro(label, x, y + r * 1.42, { size: r * 0.26, align: 'center' });
  }

  /** Thin ring used in dense tables (efficiency / power / temp readouts). */
  miniRing(x, y, r, v, valueLabel, { tint = null } = {}) {
    const t = this.t;
    const col = tint ?? t.accent;
    this.layer('base', (ctx) => {
      ctx.lineWidth = r * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = c(t.inset, t.insetA + 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v);
      ctx.strokeStyle = c(col, 0.95);
      ctx.stroke();
    });
    this.halo(x - r * 1.5, y - r * 1.5, r * 3, r * 3, col, { r: r * 1.5, alpha: 0.28 });
    this.text(valueLabel, x, y, { size: r * 0.62, weight: 600, align: 'center', color: c(t.ink, 1) });
  }

  /** Filled area sparkline over a normalised series. */
  spark(x, y, w, h, series, { tint = null, fill = true, dots = false, baseline = true } = {}) {
    if (!series || series.length < 2) return;
    const t = this.t;
    const col = tint ?? t.accent;
    const lo = Math.min(...series), hi = Math.max(...series);
    const span = hi - lo || 1;
    const px = (i) => x + (w * i) / (series.length - 1);
    const py = (v) => y + h - ((v - lo) / span) * h;

    if (baseline) this.divider(x, y + h, w, { alpha: 0.6 });
    const trace = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(px(0), py(series[0]));
      for (let i = 1; i < series.length; i++) {
        // Catmull-Rom-ish smoothing keeps the curve organic without overshoot.
        const x0 = px(i - 1), y0 = py(series[i - 1]);
        const x1 = px(i), y1 = py(series[i]);
        ctx.bezierCurveTo(x0 + (x1 - x0) * 0.45, y0, x1 - (x1 - x0) * 0.45, y1, x1, y1);
      }
    };
    if (fill) {
      this.layer('base', (ctx) => {
        trace(ctx);
        ctx.lineTo(px(series.length - 1), y + h);
        ctx.lineTo(px(0), y + h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, c(col, 0.34));
        g.addColorStop(1, c(col, 0));
        ctx.fillStyle = g;
        ctx.fill();
      });
    }
    this.layer('base', (ctx) => {
      trace(ctx);
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = c(col, 0.95);
      ctx.stroke();
    });
    this.layer('glow', (ctx) => {
      trace(ctx);
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = c(col, 0.5 * t.glow);
      ctx.stroke();
    });
    if (dots) {
      const i = series.length - 1;
      this.layer('base', (ctx) => {
        ctx.beginPath();
        ctx.arc(px(i), py(series[i]), 3.4, 0, Math.PI * 2);
        ctx.fillStyle = c(col, 1);
        ctx.fill();
      });
      this.halo(px(i) - 9, py(series[i]) - 9, 18, 18, col, { r: 9, alpha: 0.7 });
    }
  }

  /** Vertical bar chart with optional category labels. */
  bars(x, y, w, h, values, { tint = null, labels = null, highlight = -1 } = {}) {
    const t = this.t;
    const col = tint ?? t.accent;
    const hi = Math.max(...values) || 1;
    const gap = w / values.length * 0.32;
    const bw = w / values.length - gap;
    values.forEach((v, i) => {
      const bh = Math.max(2, (v / hi) * h);
      const bx = x + i * (bw + gap);
      const by = y + h - bh;
      const on = i === highlight;
      this.layer('base', (ctx) => {
        this.rr(bx, by, bw, bh, Math.min(bw / 2, 4));
        const g = ctx.createLinearGradient(0, by, 0, y + h);
        g.addColorStop(0, c(on ? t.accent2 : col, 0.95));
        g.addColorStop(1, c(on ? t.accent2 : col, 0.34));
        ctx.fillStyle = g;
        ctx.fill();
      });
      if (on) this.halo(bx - 3, by - 3, bw + 6, bh + 6, t.accent2, { r: 5, alpha: 0.4 });
      if (labels?.[i]) this.text(labels[i], bx + bw / 2, y + h + 12, { size: 12, align: 'center', color: c(t.ink3, 0.9) });
    });
    this.divider(x, y + h, w, { alpha: 0.7 });
  }

  /**
   * Radial field plot — the "pressure map" / "population density" tile.
   * Deterministic from `seed` so a panel repaints identically.
   */
  fieldMap(x, y, w, h, seed = 1, { blobs = 5 } = {}) {
    const t = this.t;
    this.layer('base', (ctx) => {
      ctx.save();
      this.rr(x, y, w, h, 8);
      ctx.clip();
      ctx.fillStyle = c(t.inset, t.insetA + 0.2);
      ctx.fillRect(x, y, w, h);
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const ramp = [t.accent, t.good, t.warn, t.bad];
      for (let i = 0; i < blobs; i++) {
        const bx = x + w * (0.15 + rnd() * 0.7);
        const by = y + h * (0.15 + rnd() * 0.7);
        const br = Math.min(w, h) * (0.2 + rnd() * 0.34);
        const col = ramp[Math.floor(rnd() * ramp.length)];
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, c(col, 0.62));
        g.addColorStop(0.5, c(col, 0.24));
        g.addColorStop(1, c(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }
      // contour hatching sells the scientific read
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = c(t.ink, 1);
      ctx.lineWidth = 1;
      for (let gy = 0; gy < h; gy += 9) {
        ctx.beginPath();
        ctx.moveTo(x, y + gy);
        ctx.lineTo(x + w, y + gy);
        ctx.stroke();
      }
      ctx.restore();
    });
    this.layer('base', (ctx) => {
      this.rr(x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(t.edge, t.edgeA * 0.5);
      ctx.stroke();
    });
  }

  /**
   * Procedural "photo" for dataset / scenario thumbnails: a layered gradient
   * landscape keyed off the tile's own palette. No network assets, and it
   * stays sharp at any panel resolution.
   */
  thumb(x, y, w, h, art, { r = 9, dim = 0 } = {}) {
    this.layer('base', (ctx) => {
      ctx.save();
      this.rr(x, y, w, h, r);
      ctx.clip();
      const sky = ctx.createLinearGradient(0, y, 0, y + h);
      sky.addColorStop(0, c(art.sky[0], 1));
      sky.addColorStop(1, c(art.sky[1], 1));
      ctx.fillStyle = sky;
      ctx.fillRect(x, y, w, h);

      if (art.sun) {
        const g = ctx.createRadialGradient(x + w * art.sun[0], y + h * art.sun[1], 0, x + w * art.sun[0], y + h * art.sun[1], w * 0.5);
        g.addColorStop(0, c(art.sunCol ?? [255, 240, 200], 0.85));
        g.addColorStop(1, c(art.sunCol ?? [255, 240, 200], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }

      let s = art.seed || 7;
      const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);

      (art.ridges ?? []).forEach((ridge) => {
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        const base = y + h * ridge.y;
        ctx.lineTo(x, base);
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
          const t01 = i / steps;
          const jag = (rnd() - 0.5) * h * ridge.rough;
          ctx.lineTo(x + w * t01, base + jag - Math.sin(t01 * Math.PI) * h * ridge.arch);
        }
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fillStyle = c(ridge.col, ridge.a ?? 1);
        ctx.fill();
      });

      if (art.skyline) {
        const base = y + h * art.skyline.y;
        ctx.fillStyle = c(art.skyline.col, art.skyline.a ?? 1);
        for (let bx = x; bx < x + w; ) {
          const bwid = w * (0.05 + rnd() * 0.07);
          const bht = h * (0.12 + rnd() * art.skyline.tall);
          ctx.fillRect(bx, base - bht, bwid - 1.5, bht);
          bx += bwid;
        }
      }

      if (art.water) {
        const wy = y + h * art.water.y;
        const g = ctx.createLinearGradient(0, wy, 0, y + h);
        g.addColorStop(0, c(art.water.col, 0.92));
        g.addColorStop(1, c(art.water.col, 0.55));
        ctx.fillStyle = g;
        ctx.fillRect(x, wy, w, y + h - wy);
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = c([255, 255, 255], 1);
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const ly = wy + (y + h - wy) * ((i + 0.5) / 5);
          ctx.beginPath();
          ctx.moveTo(x + w * rnd() * 0.3, ly);
          ctx.lineTo(x + w * (0.45 + rnd() * 0.5), ly);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      (art.dots ?? []).forEach((d) => {
        for (let i = 0; i < d.n; i++) {
          ctx.beginPath();
          ctx.arc(x + w * rnd(), y + h * (d.y0 + rnd() * d.y1), d.r * (0.5 + rnd()), 0, Math.PI * 2);
          ctx.fillStyle = c(d.col, d.a ?? 0.8);
          ctx.fill();
        }
      });

      // grade: vignette + bottom scrim so overlaid captions stay legible
      const v = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = v;
      ctx.fillRect(x, y, w, h);
      const scrim = ctx.createLinearGradient(0, y + h * 0.45, 0, y + h);
      scrim.addColorStop(0, 'rgba(0,0,0,0)');
      scrim.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = scrim;
      ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
      if (dim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${dim})`;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();

      this.rr(x + 0.5, y + 0.5, w - 1, h - 1, r);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(this.t.edge, this.t.edgeA * 0.6);
      ctx.stroke();
    });
  }

  /** Row in a list: status dot, label, trailing value. */
  listRow(id, x, y, w, h, { label, value, dot = null, ico = null, active = false, hover = 0, sub = null }) {
    const t = this.t;
    if (active || hover > 0.02) {
      this.layer('base', (ctx) => {
        this.rr(x, y, w, h, 8);
        ctx.fillStyle = c(active ? t.accent : t.spec, active ? 0.13 : 0.075 * hover);
        ctx.fill();
      });
    }
    let lx = x + h * 0.3;
    if (dot) {
      const col = { good: t.good, warn: t.warn, bad: t.bad, accent: t.accent, mute: t.ink3 }[dot] ?? t.accent;
      this.layer('base', (ctx) => {
        ctx.beginPath();
        ctx.arc(lx + 4, y + h / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = c(col, 1);
        ctx.fill();
      });
      this.halo(lx - 4, y + h / 2 - 8, 16, 16, col, { r: 8, alpha: 0.7 });
      lx += 16;
    }
    if (ico) {
      this.icon(ico, lx + h * 0.24, y + h / 2, h * 0.46, c(t.ink2, 0.85), 1.7);
      lx += h * 0.58;
    }
    const vw = value ? this.measure(value, h * (sub ? 0.3 : 0.33), 600) + 10 : 0;
    this.text(label, lx, y + h / (sub ? 3.1 : 2), {
      size: h * (sub ? 0.3 : 0.33), weight: active ? 600 : 460,
      color: c(active ? t.ink : t.ink, 0.95), max: w - (lx - x) - vw - 8,
    });
    if (sub) this.text(sub, lx, y + h * 0.71, { size: h * 0.25, color: c(t.ink3, 0.95), max: w - (lx - x) - vw - 8 });
    if (value)
      this.text(value, x + w - h * 0.3, y + h / 2, {
        size: h * (sub ? 0.3 : 0.33), weight: 600, align: 'right', mono: true, color: c(t.accent, 0.98),
      });
    return this.hit(id, x, y, w, h, { kind: 'button' });
  }

  /** Slim labelled progress bar (mission completion, resource levels). */
  progress(x, y, w, v, { label, value, tint = null, h = 6 } = {}) {
    const t = this.t;
    const col = tint ?? t.accent;
    if (label) {
      this.text(label, x, y - h * 1.9, { size: h * 2.5, weight: 500, color: c(t.ink, 0.92), max: w - 60 });
      if (value) this.text(value, x + w, y - h * 1.9, { size: h * 2.4, weight: 600, align: 'right', mono: true, color: c(col, 1) });
    }
    this.layer('base', (ctx) => {
      this.rr(x, y, w, h, h / 2);
      ctx.fillStyle = c(t.inset, t.insetA + 0.12);
      ctx.fill();
      this.rr(x, y, Math.max(h, w * v), h, h / 2);
      ctx.fillStyle = c(col, 0.92);
      ctx.fill();
    });
    this.halo(x, y - 1, Math.max(h, w * v), h + 2, col, { r: h, alpha: 0.4 });
  }

  /** Title row with an optional close affordance. Returns content top y. */
  header(x, y, w, title, { closeId = null, ico = null, chipText = null, chipTone = 'accent', hoverClose = 0 } = {}) {
    const t = this.t;
    let tx = x;
    if (ico) {
      this.icon(ico, x + 9, y, 19, c(t.accent, 0.95), 1.8);
      this.icon(ico, x + 9, y, 19, c(t.accent, 0.6), 2.6, 'glow');
      tx = x + 26;
    }
    this.micro(title, tx, y, { size: 15.5, color: c(t.ink2, 0.95), max: w - 46 });
    if (chipText) {
      const cw = this.measure(chipText.toUpperCase(), 13, 700) + 27;
      this.chip(x + w - (closeId ? 30 : 0) - cw, y, chipText, { tone: chipTone, size: 13 });
    }
    if (closeId) {
      this.icon('close', x + w - 9, y, 15, c(t.ink3, 0.7 + 0.3 * hoverClose), 1.8);
      this.hit(closeId, x + w - 24, y - 15, 30, 30, { kind: 'button' });
    }
    return y + 15;
  }
}

/**
 * Palettes for the procedural thumbnails, keyed by scenario id.
 * Kept beside the painter so a new scenario only needs one entry.
 */
export const ART = {
  wind: {
    seed: 11, sky: [[86, 140, 200], [190, 220, 240]], sun: [0.72, 0.24], sunCol: [255, 250, 225],
    ridges: [{ y: 0.72, col: [58, 92, 118], rough: 0.05, arch: 0.06 }],
    dots: [{ n: 26, y0: 0.15, y1: 0.5, r: 1.6, col: [255, 255, 255], a: 0.55 }],
  },
  energy: {
    seed: 29, sky: [[24, 34, 62], [64, 92, 150]], sun: [0.5, 0.85], sunCol: [120, 200, 255],
    ridges: [{ y: 0.78, col: [18, 26, 44], rough: 0.02, arch: 0.02 }],
    dots: [{ n: 44, y0: 0.55, y1: 0.35, r: 2.2, col: [90, 200, 255], a: 0.85 }],
  },
  density: {
    seed: 41, sky: [[16, 20, 34], [40, 30, 66]],
    dots: [
      { n: 60, y0: 0.1, y1: 0.8, r: 4.5, col: [255, 90, 90], a: 0.5 },
      { n: 40, y0: 0.1, y1: 0.8, r: 3, col: [255, 200, 80], a: 0.5 },
      { n: 30, y0: 0.1, y1: 0.8, r: 2, col: [120, 240, 200], a: 0.55 },
    ],
  },
  climate: {
    seed: 53, sky: [[10, 16, 30], [26, 48, 78]], sun: [0.42, 0.46], sunCol: [180, 140, 255],
    dots: [{ n: 70, y0: 0.05, y1: 0.9, r: 1.4, col: [220, 200, 255], a: 0.7 }],
  },
  transport: {
    seed: 67, sky: [[12, 14, 24], [46, 26, 30]],
    ridges: [{ y: 0.62, col: [24, 26, 38], rough: 0.03, arch: 0.05 }],
    dots: [
      { n: 36, y0: 0.6, y1: 0.35, r: 2.4, col: [255, 170, 90], a: 0.9 },
      { n: 26, y0: 0.6, y1: 0.35, r: 2, col: [255, 90, 110], a: 0.8 },
    ],
  },
  resource: {
    seed: 79, sky: [[18, 42, 40], [90, 130, 110]],
    ridges: [
      { y: 0.55, col: [40, 84, 74], rough: 0.06, arch: 0.1 },
      { y: 0.75, col: [26, 58, 52], rough: 0.04, arch: 0.05 },
    ],
    water: { y: 0.84, col: [46, 108, 128] },
  },
  coast: {
    seed: 97, sky: [[120, 170, 215], [225, 238, 246]], sun: [0.24, 0.2], sunCol: [255, 246, 222],
    ridges: [{ y: 0.6, col: [92, 122, 96], rough: 0.05, arch: 0.09 }],
    water: { y: 0.7, col: [58, 132, 158] },
  },
  city: {
    seed: 103, sky: [[38, 54, 92], [150, 172, 205]], sun: [0.8, 0.3], sunCol: [255, 226, 190],
    skyline: { y: 0.82, col: [30, 40, 64], a: 0.95, tall: 0.5 },
    water: { y: 0.84, col: [44, 74, 110] },
  },
  forest: {
    seed: 127, sky: [[126, 156, 122], [222, 232, 210]], sun: [0.6, 0.15], sunCol: [255, 250, 210],
    ridges: [
      { y: 0.5, col: [72, 104, 70], rough: 0.09, arch: 0.08, a: 0.9 },
      { y: 0.68, col: [44, 74, 46], rough: 0.11, arch: 0.06 },
      { y: 0.86, col: [26, 48, 30], rough: 0.06, arch: 0.03 },
    ],
  },
  mars: {
    seed: 149, sky: [[62, 30, 22], [190, 122, 86]], sun: [0.3, 0.28], sunCol: [255, 214, 170],
    ridges: [
      { y: 0.62, col: [122, 62, 40], rough: 0.07, arch: 0.1 },
      { y: 0.8, col: [86, 42, 28], rough: 0.05, arch: 0.04 },
    ],
  },
  ice: {
    seed: 163, sky: [[142, 186, 214], [232, 244, 250]],
    ridges: [{ y: 0.66, col: [176, 208, 226], rough: 0.08, arch: 0.07 }],
    water: { y: 0.78, col: [72, 128, 160] },
  },
  storm: {
    seed: 181, sky: [[42, 40, 56], [110, 104, 122]],
    ridges: [{ y: 0.72, col: [56, 52, 68], rough: 0.06, arch: 0.05 }],
    dots: [{ n: 80, y0: 0.05, y1: 0.6, r: 1.2, col: [220, 226, 240], a: 0.5 }],
  },
  turbine: {
    seed: 199, sky: [[10, 18, 28], [30, 58, 88]],
    dots: [{ n: 50, y0: 0.15, y1: 0.7, r: 2, col: [90, 190, 255], a: 0.7 }],
  },
  reef: {
    seed: 211, sky: [[16, 70, 104], [70, 160, 180]],
    dots: [
      { n: 34, y0: 0.3, y1: 0.6, r: 3.4, col: [255, 150, 120], a: 0.7 },
      { n: 26, y0: 0.3, y1: 0.6, r: 2.6, col: [255, 220, 130], a: 0.7 },
    ],
  },
};

export const artFor = (k) => ART[k] ?? ART.city;

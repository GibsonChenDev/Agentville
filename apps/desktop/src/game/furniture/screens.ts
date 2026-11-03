import type { Graphics } from 'pixi.js';
import type { ScreenMode } from '../animations/intent';

/**
 * Draws live screen content (code scrolling, terminal output, prompts) into a
 * Graphics object in sprite-local pixel coordinates. Content is decorative and
 * keyed only by the visual mode — it never displays real agent output.
 */
const CODE_COLORS = [0xff7a90, 0x7fd1ff, 0xffd166, 0x9be3a5, 0xc7a3ff, 0xe8e8f0];

export function drawScreen(g: Graphics, rect: { x: number; y: number; w: number; h: number }, mode: ScreenMode, frame: number, seed: number) {
  const { x, y, w, h } = rect;
  const bg: Record<ScreenMode, number> = {
    off: 0x10131c,
    idle: 0x1a2236,
    code: 0x1b1f2e,
    doc: 0xeef1f6,
    terminal: 0x0c120f,
    web: 0xf6f7fb,
    question: 0x3a2a10,
    success: 0x10301e,
    error: 0x3a1218,
    plan: 0x22203a,
    delegate: 0x1f1a33,
  };
  g.rect(x, y, w, h).fill(bg[mode]);
  const rows = Math.floor(h / 2);
  const line = (row: number, indent: number, len: number, color: number) => {
    const ly = y + row * 2;
    if (ly >= y + h) return;
    g.rect(x + 1 + indent, ly + 1, Math.min(len, w - 2 - indent), 1).fill(color);
  };
  const hash = (n: number) => {
    let v = (n * 2654435761 + seed * 97) >>> 0;
    v ^= v >>> 13;
    return v;
  };

  switch (mode) {
    case 'off':
      g.rect(x + w - 2, y + h - 2, 1, 1).fill(0x2a3550);
      return;
    case 'idle': {
      const cx = x + 1 + (frame % Math.max(1, w - 3));
      g.rect(cx, y + Math.floor(h / 2), 2, 1).fill(0x3d5a8a);
      return;
    }
    case 'code': {
      const scroll = Math.floor(frame / 2);
      for (let r = 0; r < rows; r++) {
        const n = hash(r + scroll);
        const indent = (n % 3) * 2;
        const len = 2 + (n % 7);
        line(r, indent, len, CODE_COLORS[n % CODE_COLORS.length]!);
        if (len < 6) line(r, indent + len + 1, (n >> 4) % 4, CODE_COLORS[(n >> 3) % CODE_COLORS.length]!);
      }
      if (frame % 2 === 0) g.rect(x + 2 + (frame % 5), y + h - 2, 1, 1).fill(0xffffff);
      return;
    }
    case 'doc': {
      const scroll = Math.floor(frame / 4);
      g.rect(x, y, w, 2).fill(0x3d6fb5);
      for (let r = 1; r < rows; r++) line(r, 0, w - 3 - (hash(r + scroll) % 4), 0x9aa3b5);
      return;
    }
    case 'terminal': {
      const visible = Math.min(rows, 1 + (frame % (rows + 3)));
      for (let r = 0; r < visible; r++) {
        const n = hash(r + Math.floor(frame / (rows + 3)) * 10);
        line(r, 0, 1, 0x9be3a5);
        line(r, 2, 2 + (n % (w - 5)), r === visible - 1 ? 0xe8e8f0 : 0x6fcf87);
      }
      return;
    }
    case 'web':
      g.rect(x, y, w, 2).fill(0xe2705c);
      g.rect(x + 1, y + 3, Math.floor(w / 2) - 1, h - 4).fill(0xbcd7ff);
      for (let r = 2; r < rows; r++) line(r, Math.floor(w / 2), w - Math.floor(w / 2) - 3, 0x9aa3b5);
      return;
    case 'question': {
      const on = frame % 4 < 3;
      const cx = x + Math.floor(w / 2) - 1;
      const cy = y + Math.floor((h - 5) / 2);
      if (on) {
        g.rect(cx, cy, 3, 1).fill(0xffd166);
        g.rect(cx + 2, cy + 1, 1, 1).fill(0xffd166);
        g.rect(cx + 1, cy + 2, 1, 1).fill(0xffd166);
        g.rect(cx + 1, cy + 4, 1, 1).fill(0xffd166);
      }
      return;
    }
    case 'success': {
      const cx = x + Math.floor(w / 2) - 2;
      const cy = y + Math.floor(h / 2) - 1;
      g.rect(cx, cy + 1, 1, 1).fill(0x7dff9a);
      g.rect(cx + 1, cy + 2, 1, 1).fill(0x7dff9a);
      g.rect(cx + 2, cy + 1, 1, 1).fill(0x7dff9a);
      g.rect(cx + 3, cy, 1, 1).fill(0x7dff9a);
      g.rect(cx + 4, cy - 1, 1, 1).fill(0x7dff9a);
      return;
    }
    case 'error': {
      const cx = x + Math.floor(w / 2) - 2;
      const cy = y + Math.floor(h / 2) - 2;
      const c = frame % 2 ? 0xff6b6b : 0xff9a9a;
      for (let i = 0; i < 4; i++) {
        g.rect(cx + i, cy + i, 1, 1).fill(c);
        g.rect(cx + 3 - i, cy + i, 1, 1).fill(c);
      }
      return;
    }
    case 'plan':
      for (let r = 0; r < rows; r++) {
        const done = r < (frame / 3) % (rows + 1);
        g.rect(x + 1, y + r * 2 + 1, 1, 1).fill(done ? 0x9be3a5 : 0x6c7a96);
        line(r, 2, 3 + (hash(r) % (w - 6)), 0xc7a3ff);
      }
      return;
    case 'delegate': {
      const cx = x + Math.floor(w / 2);
      const cy = y + Math.floor(h / 2);
      g.rect(cx - 4, cy - 1, 2, 2).fill(0xc7a3ff);
      g.rect(cx + 2, cy - 1, 2, 2).fill(0x7fd1ff);
      const dot = frame % 4;
      g.rect(cx - 2 + dot, cy, 1, 1).fill(0xffffff);
      return;
    }
  }
}

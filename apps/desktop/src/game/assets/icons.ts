import { PixelCanvas, shade, type Color } from '../engine/pixel';
import { WHITE } from './palette';
import type { Activity } from '../animations/intent';

/** 11×12 pixel speech-bubble icons that float above characters. */
export type IconKind = 'think' | 'read' | 'type' | 'test' | 'plan' | 'raise' | 'cheer' | 'slump' | 'talk' | 'delegate' | 'exec' | 'phone';

const GLYPHS: Record<IconKind, { color: Color; rows: string[] }> = {
  think: { color: '#6c7a96', rows: ['.......', '.......', 'x.x.x..', '.......'] },
  read: { color: '#3d6fb5', rows: ['xx.xx', 'x.x.x', 'x.x.x', 'xx.xx'] },
  type: { color: '#2b8a6e', rows: ['.x...x.', 'x..x..x', '.x.x.x.', '...x...'] },
  test: { color: '#c77d1a', rows: ['x.x.x', '.xxx.', 'xxxxx', '.xxx.'] },
  plan: { color: '#7a55b5', rows: ['x.xxx', '.....', 'x.xxx', '.....', 'x.xx.'] },
  raise: { color: '#e2a93d', rows: ['.x.', '.x.', '.x.', '...', '.x.'] },
  cheer: { color: '#3aa35a', rows: ['....x', '...x.', 'x.x..', '.x...'] },
  slump: { color: '#d9534f', rows: ['x...x', '.x.x.', '..x..', '.x.x.', 'x...x'] },
  talk: { color: '#2b8a8a', rows: ['xxxxx', '.....', 'xxx..'] },
  delegate: { color: '#7a55b5', rows: ['x....', 'xxxx.', 'x..xx', 'xxxx.', 'x....'] },
  exec: { color: '#4c6c99', rows: ['x....', '.x...', 'x..xx'] },
  phone: { color: '#e2557a', rows: ['xx.xx', 'xxxxx', '.xxx.', '..x..'] },
};

export function iconForActivity(activity: Activity, screen?: string): IconKind | null {
  switch (activity) {
    case 'idle':
    case 'stretch':
    case 'nap': // the napping sprite has its own z's
      return null;
    case 'type':
      return screen === 'terminal' ? 'exec' : 'type';
    case 'debug':
      return 'test';
    case 'think':
      return screen === 'delegate' ? 'delegate' : 'think';
    default:
      return activity;
  }
}

export function drawIcon(kind: IconKind): PixelCanvas {
  const pc = new PixelCanvas(13, 14);
  const { color, rows } = GLYPHS[kind];
  const bg = WHITE;
  pc.round(1, 1, 11, 10, bg);
  pc.hline(2, 10, 9, shade(bg, -0.12));
  // tail
  pc.px(5, 11, bg);
  pc.px(6, 11, bg);
  pc.px(6, 12, bg);
  const h = rows.length;
  const w = rows[0]!.length;
  const ox = 1 + Math.floor((11 - w) / 2);
  const oy = 1 + Math.floor((10 - h) / 2);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'x' && pc.px(ox + x, oy + y, color)));
  if (kind === 'raise') {
    pc.round(1, 1, 11, 10, color);
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'x' && pc.px(ox + x, oy + y, WHITE)));
  }
  return pc.outline(-0.65);
}

/** Selection ring drawn on the floor under a character. */
export function drawRing(color: Color): PixelCanvas {
  const pc = new PixelCanvas(22, 9);
  pc.ellipse(11, 4, 10, 4, color);
  pc.ellipse(11, 4, 8, 2, '#000000');
  pc.ctx.globalCompositeOperation = 'destination-out';
  pc.ellipse(11, 4, 8, 2, '#000000');
  pc.ctx.globalCompositeOperation = 'source-over';
  return pc;
}

export function drawShadow(): PixelCanvas {
  const pc = new PixelCanvas(18, 6);
  pc.ellipse(9, 3, 8, 2, '#000000', 0.28);
  pc.ellipse(9, 3, 5, 1, '#000000', 0.12);
  return pc;
}

/** Banded glow used additively for screens. */
export function drawGlow(color: Color, rx: number, ry: number): PixelCanvas {
  const pc = new PixelCanvas(rx * 2 + 1, ry * 2 + 1);
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2);
      if (d >= 1) continue;
      pc.px(x + rx, y + ry, color, Math.ceil((1 - d) * 4) / 4);
    }
  }
  return pc;
}

/** A small document that flies between characters to show a real handoff. */
export function drawDocument(kind: 'task' | 'report'): PixelCanvas {
  const pc = new PixelCanvas(11, 13);
  const paper = '#fbf7ef';
  pc.rect(1, 1, 8, 11, paper);
  pc.rect(7, 1, 2, 2, '#d9d2c3'); // folded corner
  pc.px(9, 3, paper);
  pc.rect(9, 3, 1, 9, paper);
  for (let y = 4; y < 11; y += 2) pc.hline(2, y, y === 10 ? 4 : 6, '#9aa3b5');
  if (kind === 'task') {
    pc.rect(6, 8, 4, 4, '#3aa35a');
    pc.px(7, 10, '#ffffff');
    pc.px(8, 9, '#ffffff');
  } else {
    pc.rect(2, 2, 4, 1, '#7a55b5');
  }
  return pc.outline(-0.55);
}

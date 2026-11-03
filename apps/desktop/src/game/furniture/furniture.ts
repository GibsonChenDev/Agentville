import type { Equipment } from '@agentville/domain';
import { PixelCanvas, rng, shade, type Color } from '../engine/pixel';
import { WHITE } from '../assets/palette';
import type { ThemeStyle } from '../assets/themes';

/**
 * Procedural furniture sprites in three-quarter view: every object shows a
 * lit top face and a darker front face, light coming from the upper left.
 */

export interface FurnitureDef {
  /** Footprint in tiles. */
  fw: number;
  fh: number;
  /** Sprite is anchored so its bottom edge sits `bottomPad` px below the footprint's bottom edge. */
  bottomPad: number;
  /** Horizontal offset of the sprite relative to footprint left, px. */
  ox: number;
  blocks: boolean;
  /** Optional light this object emits (offset from sprite top-left). */
  light?: { x: number; y: number; r: number; color: 'warm' | 'screen' | 'accent'; strength: number };
  draw: (t: ThemeStyle, variant: number) => PixelCanvas;
}

function box(pc: PixelCanvas, x: number, y: number, w: number, topH: number, frontH: number, top: Color, front: Color) {
  pc.rect(x, y, w, topH, top);
  pc.hline(x, y, w, shade(top, 0.12));
  pc.rect(x, y + topH, w, frontH, front);
  pc.hline(x, y + topH, w, shade(top, -0.08));
  pc.vline(x + w - 1, y + topH, frontH, shade(front, -0.12));
}

// ───────────────────────────────── desks & chairs

export function drawDesk(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(34, 24);
  const { top, edge, leg, accent } = t.desk;
  // back legs
  pc.rect(4, 13, 2, 8, shade(leg, -0.2));
  pc.rect(28, 13, 2, 8, shade(leg, -0.2));
  // top
  pc.rect(1, 2, 32, 10, top);
  pc.hline(1, 2, 32, shade(top, 0.14));
  if (t.floor.kind === 'planks') {
    const rand = rng(7);
    for (let i = 0; i < 6; i++) pc.hline(2 + Math.floor(rand() * 20), 4 + Math.floor(rand() * 7), 4 + Math.floor(rand() * 8), shade(top, -0.07));
  }
  pc.rect(1, 12, 32, 3, edge);
  pc.hline(1, 12, 32, shade(edge, 0.12));
  if (accent && t.id === 'midnight') pc.hline(2, 14, 30, accent, 0.9);
  // front legs
  pc.rect(1, 15, 3, 9, leg);
  pc.vline(3, 15, 9, shade(leg, -0.2));
  pc.rect(30, 15, 3, 9, leg);
  pc.vline(32, 15, 9, shade(leg, -0.2));
  if (t.id === 'loft') pc.hline(4, 19, 26, shade(leg, -0.1));
  if (t.id === 'studio') {
    // drawer pedestal
    pc.rect(22, 15, 8, 8, shade(top, -0.06));
    pc.hline(22, 15, 8, shade(top, -0.14));
    pc.hline(24, 18, 4, shade(top, -0.25));
    pc.hline(24, 21, 4, shade(top, -0.25));
  }
  return pc.outline(-0.5);
}

/** Office chair. `back` = seen from behind (character faces up); `front` = seen from the front. */
export function drawChair(t: ThemeStyle, view: 'front' | 'back'): PixelCanvas {
  const pc = new PixelCanvas(18, 24);
  const c = t.chair;
  const c1 = shade(c, -0.2);
  const c2 = shade(c, -0.35);
  const metal = '#3a3a44';
  // base & wheels
  pc.vline(8, 17, 4, metal);
  pc.vline(9, 17, 4, shade(metal, -0.2));
  pc.hline(3, 21, 12, metal);
  pc.px(3, 22, '#16161c');
  pc.px(14, 22, '#16161c');
  pc.px(8, 22, '#16161c');
  // seat
  pc.round(3, 14, 12, 4, c);
  pc.hline(4, 14, 10, shade(c, 0.12));
  pc.hline(4, 17, 10, c1);
  if (view === 'back') {
    // low backrest seen from behind, in front of the sitter's lower back
    pc.round(3, 8, 12, 7, c1);
    pc.round(4, 9, 10, 5, c2);
    pc.hline(5, 9, 8, shade(c, 0.05));
    pc.rect(8, 14, 2, 2, metal);
  } else {
    // backrest behind the sitter
    pc.round(3, 1, 12, 11, c);
    pc.hline(4, 1, 10, shade(c, 0.15));
    pc.vline(14, 2, 9, c1);
    pc.rect(5, 4, 8, 6, shade(c, 0.06));
    pc.rect(8, 12, 2, 2, metal);
  }
  return pc.outline(-0.5);
}

export interface EquipmentSprite {
  canvas: PixelCanvas;
  /** Screen rectangles (sprite-local) that can show live activity. */
  screens: { x: number; y: number; w: number; h: number }[];
  /** LED positions that blink. */
  leds: { x: number; y: number; color: Color }[];
}

/**
 * Equipment on a desk, drawn into a 34×30 sprite aligned with the desk sprite
 * (desk top surface spans y 2..11 of the desk; this sprite overlaps by 16px).
 * `facing: 'screen'` shows displays toward the camera.
 */
export function drawEquipment(t: ThemeStyle, kind: Equipment, facing: 'screen' | 'back', seed: number): EquipmentSprite {
  const pc = new PixelCanvas(34, 30);
  const screens: EquipmentSprite['screens'] = [];
  const leds: EquipmentSprite['leds'] = [];
  const bezel = t.id === 'studio' ? '#e7e4de' : '#23232b';
  const bezel1 = shade(bezel, -0.18);
  const base = 16; // desk top surface starts at y=18 in this sprite (desk y=2 + 16 offset … aligned by caller)
  const screenOff = '#151a26';
  const rand = rng(seed);

  const monitor = (x: number, w: number, h: number, standH = facing === 'screen' ? 6 : 3) => {
    const y = base + 4 - h - standH;
    if (facing === 'screen') {
      pc.rect(x, y, w, h, bezel);
      pc.hline(x, y, w, shade(bezel, 0.15));
      pc.rect(x + 1, y + 1, w - 2, h - 3, screenOff);
      screens.push({ x: x + 1, y: y + 1, w: w - 2, h: h - 3 });
      pc.hline(x + 1, y + h - 2, w - 2, bezel1);
    } else {
      pc.rect(x, y, w, h, shade(bezel, -0.05));
      pc.rect(x + 2, y + 2, w - 4, h - 5, bezel1);
      pc.px(x + Math.floor(w / 2), y + Math.floor(h / 2) - 1, shade(bezel, 0.3));
    }
    const sx = x + Math.floor(w / 2) - 1;
    pc.rect(sx, y + h, 2, standH, bezel1);
    pc.rect(sx - 2, y + h + standH - 1, 6, 2, bezel);
  };
  const keyboard = (x: number, w = 12) => {
    const y = base + 6;
    pc.rect(x, y, w, 3, t.id === 'studio' ? '#f7f5f0' : '#2e2f3a');
    for (let i = 1; i < w - 1; i += 2) pc.px(x + i, y + 1, t.id === 'studio' ? '#c9c4bb' : '#4a4b5a');
    pc.round(x + w + 2, y + 1, 3, 2, t.id === 'studio' ? '#f7f5f0' : '#2e2f3a');
  };
  const mug = (x: number) => {
    const y = base + 3;
    const c = ['#e2705c', '#f4efe6', '#2b8a8a', '#e0a93d'][Math.floor(rand() * 4)]!;
    pc.rect(x, y, 3, 4, c);
    pc.hline(x, y, 3, shade(c, -0.3));
    pc.px(x + 3, y + 1, c);
    pc.px(x + 3, y + 2, c);
  };

  if (facing === 'screen') {
    switch (kind) {
      case 'laptop': {
        // raised on a laptop stand so the screen clears the sitter's head
        const x = 10;
        const y = base - 13;
        pc.rect(14, y + 12, 6, 5, '#9da1ad');
        pc.rect(11, y + 16, 12, 1, '#7d818c');
        pc.rect(x, y, 14, 9, '#b9bcc6');
        pc.rect(x + 1, y + 1, 12, 7, screenOff);
        screens.push({ x: x + 1, y: y + 1, w: 12, h: 7 });
        pc.rect(x - 1, y + 9, 16, 3, '#cfd2da');
        pc.hline(x, y + 10, 14, '#9da1ad');
        mug(28);
        break;
      }
      case 'monitor':
        monitor(8, 18, 13);
        keyboard(9);
        mug(28);
        break;
      case 'dual_monitor':
        monitor(1, 16, 12);
        monitor(17, 16, 12);
        keyboard(10);
        break;
      case 'desktop_tower':
        monitor(6, 18, 13);
        keyboard(7);
        pc.rect(26, base - 8, 6, 15, bezel);
        pc.vline(31, base - 8, 15, bezel1);
        leds.push({ x: 28, y: base - 6, color: '#62e6ff' });
        break;
      case 'tablet': {
        const y = base - 11;
        pc.rect(16, y + 8, 2, 7, '#9a9aa6');
        pc.rect(11, y, 12, 8, '#2a2b33');
        pc.rect(12, y + 1, 10, 6, screenOff);
        screens.push({ x: 12, y: y + 1, w: 10, h: 6 });
        pc.rect(13, base + 3, 8, 1, '#9a9aa6');
        pc.rect(4, base + 4, 5, 6, '#f4efe6');
        pc.hline(5, base + 6, 3, '#9aa3b5');
        mug(27);
        break;
      }
      case 'debug_rig': {
        monitor(2, 17, 13);
        keyboard(4, 10);
        // dev board + scope
        pc.rect(21, base - 2, 11, 8, '#3a3d46');
        pc.rect(22, base - 1, 6, 4, '#0e2a22');
        screens.push({ x: 22, y: base - 1, w: 6, h: 4 });
        pc.px(30, base, '#ff5f5f');
        leds.push({ x: 30, y: base + 2, color: '#7dff7a' });
        pc.rect(22, base + 7, 8, 3, '#2f6b4a');
        pc.px(24, base + 8, '#e0a93d');
        break;
      }
    }
  } else {
    // Seen from behind: keep displays to the left so the sitter's face stays visible.
    switch (kind) {
      case 'laptop':
      case 'tablet': {
        const y = base - 2;
        pc.rect(3, y, 13, 6, '#b9bcc6');
        pc.rect(3, y + 6, 13, 2, '#9da1ad');
        pc.px(9, y + 2, WHITE);
        mug(28);
        break;
      }
      case 'dual_monitor':
        monitor(0, 13, 12);
        pc.rect(28, base - 1, 5, 6, '#f4efe6');
        break;
      default:
        monitor(1, 15, 12);
        mug(28);
    }
    // keyboard lip visible at desk front
    pc.rect(17, base + 5, 10, 2, t.id === 'studio' ? '#f7f5f0' : '#2e2f3a');
  }
  return { canvas: pc.outline(-0.45), screens, leds };
}

// ───────────────────────────────── plants

function leaf(pc: PixelCanvas, x: number, y: number, dx: number, dy: number, len: number, c: Color) {
  for (let i = 0; i < len; i++) {
    const w = i < len / 2 ? 1 + Math.floor(i / 1.5) : Math.max(1, Math.floor((len - i) / 1.5));
    const px = Math.round(x + dx * i);
    const py = Math.round(y + dy * i);
    pc.rect(px - Math.floor(w / 2), py, w, 2, c);
    if (w > 2) pc.px(px, py, shade(c, -0.15));
  }
}

function pot(pc: PixelCanvas, cx: number, y: number, w: number, h: number, c: Color) {
  const x = cx - Math.floor(w / 2);
  pc.rect(x, y, w, h, c);
  pc.rect(x - 1, y, w + 2, 2, shade(c, 0.1));
  pc.vline(x + w - 1, y + 2, h - 2, shade(c, -0.2));
  pc.hline(x, y + h - 1, w, shade(c, -0.25));
  pc.hline(x, y + 1, w, '#3b2a20');
}

export function drawMonstera(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(28, 40);
  const g = t.id === 'midnight' ? '#2f6e5c' : '#3f8f5a';
  const g1 = shade(g, -0.18);
  const g2 = shade(g, 0.15);
  const leaves: [number, number, number, number, number, Color][] = [
    [14, 26, -0.9, -0.55, 12, g1],
    [14, 26, 0.95, -0.6, 12, g1],
    [14, 25, -0.5, -0.95, 14, g],
    [14, 25, 0.45, -1, 15, g],
    [14, 25, 0, -1, 16, g2],
    [14, 27, -1, -0.15, 11, g],
    [14, 27, 1, -0.2, 11, g],
  ];
  for (const [x, y, dx, dy, len, c] of leaves) leaf(pc, x, y, dx, dy, len, c);
  // monstera splits
  pc.px(9, 15, g1);
  pc.px(19, 14, g1);
  pc.px(14, 12, g1);
  pot(pc, 14, 28, 10, 10, t.id === 'studio' ? '#e9e3d8' : t.id === 'midnight' ? '#2b2c3f' : '#c56b48');
  return pc.outline(-0.5);
}

export function drawFiddle(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(20, 44);
  const g = t.id === 'midnight' ? '#2d6650' : '#4b8a4a';
  pc.vline(10, 14, 20, '#6b4a33');
  const rand = rng(31);
  for (let i = 0; i < 16; i++) {
    const y = 2 + Math.floor(rand() * 24);
    const spread = 2 + Math.floor((y / 26) * 6);
    const x = 10 + Math.floor((rand() - 0.5) * spread * 2);
    const c = rand() > 0.6 ? shade(g, 0.15) : rand() > 0.5 ? g : shade(g, -0.15);
    pc.round(x - 2, y, 5, 4, c);
    pc.px(x, y + 1, shade(c, -0.2));
  }
  pot(pc, 10, 34, 9, 9, t.id === 'studio' ? '#2f4170' : '#d9cbb3');
  return pc.outline(-0.5);
}

export function drawSucculent(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(14, 18);
  pot(pc, 7, 9, 8, 6, t.accent);
  const g = '#6fa57a';
  pc.round(3, 4, 8, 6, g);
  pc.px(5, 3, shade(g, 0.2));
  pc.px(8, 3, shade(g, 0.2));
  pc.px(7, 2, shade(g, 0.25));
  pc.hline(4, 7, 6, shade(g, -0.2));
  pc.rect(6, 15, 2, 3, '#3a3a44');
  return pc.outline(-0.5);
}

// ───────────────────────────────── storage & lounge

const BOOK_COLORS = ['#e2705c', '#2f4170', '#e0a93d', '#8fae87', '#73446f', '#eee2cb', '#2b8a8a', '#c56b48'];

export function drawBookshelf(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(34, 46);
  const wood = t.id === 'studio' ? '#d8b98f' : t.id === 'midnight' ? '#2b2c44' : '#6e4329';
  const w1 = shade(wood, -0.2);
  pc.rect(1, 2, 32, 43, wood);
  pc.hline(1, 2, 32, shade(wood, 0.15));
  pc.rect(3, 5, 28, 38, shade(wood, -0.35));
  const rand = rng(91);
  for (let shelf = 0; shelf < 4; shelf++) {
    const sy = 5 + shelf * 10;
    pc.rect(3, sy + 9, 28, 1, w1);
    let x = 4;
    while (x < 29) {
      if (rand() < 0.12) {
        x += 3;
        continue;
      }
      const bw = 2 + Math.floor(rand() * 2);
      const bh = 5 + Math.floor(rand() * 4);
      const c = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]!;
      if (x + bw > 30) break;
      pc.rect(x, sy + 9 - bh, bw, bh, c);
      pc.vline(x + bw - 1, sy + 9 - bh, bh, shade(c, -0.2));
      pc.px(x, sy + 10 - bh, shade(c, 0.2));
      x += bw;
    }
  }
  // tiny plant on top
  pc.rect(24, 0, 5, 3, t.accent);
  pc.rect(23, -1, 7, 1, '#4b8a4a');
  return pc.outline(-0.5);
}

export function drawSofa(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(50, 26);
  const c = t.sofa;
  const c1 = shade(c, -0.18);
  const c2 = shade(c, -0.32);
  const hi = shade(c, 0.14);
  // backrest
  pc.round(3, 2, 44, 11, c1);
  pc.hline(4, 2, 42, c);
  // arms
  pc.round(1, 8, 7, 14, c);
  pc.round(42, 8, 7, 14, c1);
  pc.hline(2, 8, 5, hi);
  // cushions
  for (const x of [8, 25]) {
    pc.round(x, 11, 17, 7, c);
    pc.hline(x + 1, 11, 15, hi);
    pc.hline(x + 1, 17, 15, c1);
  }
  pc.vline(24, 12, 6, c2);
  // front
  pc.rect(8, 18, 34, 4, c1);
  pc.hline(8, 21, 34, c2);
  // legs
  pc.rect(3, 22, 2, 3, '#3b2a20');
  pc.rect(45, 22, 2, 3, '#3b2a20');
  // throw pillow
  pc.round(10, 6, 7, 6, t.accent);
  pc.px(12, 8, shade(t.accent, 0.2));
  return pc.outline(-0.5);
}

export function drawCoffeeTable(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(30, 16);
  const top = t.id === 'midnight' ? '#3d3f5c' : t.id === 'studio' ? '#b98c5e' : '#7a4e30';
  box(pc, 1, 2, 28, 6, 3, top, shade(top, -0.25));
  pc.rect(3, 11, 2, 4, shade(top, -0.35));
  pc.rect(25, 11, 2, 4, shade(top, -0.35));
  // magazines & cup
  pc.rect(5, 3, 7, 4, '#eee2cb');
  pc.rect(6, 4, 7, 3, t.accent);
  pc.rect(20, 3, 3, 3, WHITE);
  pc.px(23, 4, WHITE);
  return pc.outline(-0.5);
}

export function drawCoffeeBar(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(66, 36);
  const counter = t.id === 'midnight' ? '#2d2f4a' : t.id === 'studio' ? '#f1ede6' : '#3f3a3f';
  const topC = t.id === 'loft' ? '#c8925c' : t.id === 'studio' ? '#d8b98f' : '#43465f';
  // counter
  pc.rect(1, 18, 64, 17, counter);
  pc.rect(1, 14, 64, 5, topC);
  pc.hline(1, 14, 64, shade(topC, 0.15));
  pc.hline(1, 19, 64, shade(counter, -0.25));
  for (let x = 6; x < 64; x += 16) {
    pc.vline(x, 21, 12, shade(counter, -0.15));
    pc.rect(x + 6, 26, 4, 1, shade(counter, 0.2));
  }
  // espresso machine
  pc.rect(6, 1, 18, 14, '#c9ccd6');
  pc.rect(6, 1, 18, 2, '#e8eaf0');
  pc.rect(8, 5, 14, 3, '#2d2c33');
  pc.px(10, 6, '#ff6b5a');
  pc.px(13, 6, '#7dff7a');
  pc.rect(11, 9, 2, 3, '#2d2c33');
  pc.rect(17, 9, 2, 3, '#2d2c33');
  pc.rect(10, 12, 3, 2, WHITE);
  pc.vline(23, 3, 11, '#9da1ad');
  // grinder
  pc.rect(27, 4, 6, 10, '#2d2c33');
  pc.round(27, 1, 6, 4, '#7a4e30');
  // cups & jars
  for (let i = 0; i < 4; i++) pc.rect(37 + i * 4, 10, 3, 4, [WHITE, t.accent, '#2b8a8a', WHITE][i]!);
  pc.rect(55, 6, 6, 8, '#d9cbb3');
  pc.rect(55, 6, 6, 2, '#7a4e30');
  pc.rect(56, 9, 4, 4, '#5a3a24');
  return pc.outline(-0.5);
}

export function drawMeetingTable(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(48, 30);
  const top = t.id === 'studio' ? '#f4f1ea' : t.id === 'midnight' ? '#2f3150' : '#a86f45';
  pc.ellipse(24, 11, 21, 8, top);
  for (let y = 4; y < 19; y++) pc.px(24 + Math.round(20 * Math.sqrt(Math.max(0, 1 - ((y - 11) / 8) ** 2))), y, shade(top, -0.1));
  pc.ellipse(24, 9, 15, 4, shade(top, 0.06));
  pc.rect(4, 13, 41, 4, shade(top, -0.22));
  pc.ellipse(24, 13, 20, 6, top);
  pc.ellipse(24, 11, 20, 7, top);
  pc.hline(8, 4, 32, shade(top, 0.15));
  pc.rect(22, 18, 4, 10, t.desk.leg);
  pc.rect(16, 27, 16, 2, t.desk.leg);
  // laptop & papers on the table
  pc.rect(10, 8, 7, 4, '#eee2cb');
  pc.rect(28, 7, 9, 5, '#b9bcc6');
  pc.rect(29, 8, 7, 3, '#1c2433');
  return pc.outline(-0.5);
}

export function drawWhiteboard(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(36, 42);
  const frame = '#9da1ad';
  pc.rect(1, 2, 34, 24, frame);
  pc.rect(2, 3, 32, 21, '#f8f8f4');
  pc.hline(2, 3, 32, WHITE);
  // diagram scribbles
  pc.round(5, 6, 8, 5, '#3d6fb5');
  pc.round(6, 7, 6, 3, '#f8f8f4');
  pc.round(21, 6, 9, 5, '#e2705c');
  pc.round(22, 7, 7, 3, '#f8f8f4');
  pc.hline(13, 8, 8, '#2d2c33');
  pc.px(20, 7, '#2d2c33');
  pc.px(20, 9, '#2d2c33');
  pc.vline(9, 11, 5, '#2d2c33');
  pc.round(5, 16, 9, 5, '#30604a');
  pc.round(6, 17, 7, 3, '#f8f8f4');
  // sticky notes
  pc.rect(24, 15, 4, 4, '#ffd166');
  pc.rect(29, 14, 4, 4, '#9be3c3');
  pc.rect(26, 19, 4, 3, '#ff9ec7');
  pc.hline(16, 18, 5, '#9aa3b5');
  pc.hline(16, 20, 4, '#9aa3b5');
  // tray, legs, wheels
  pc.rect(3, 24, 30, 2, shade(frame, -0.15));
  pc.rect(6, 23, 3, 1, '#e2705c');
  pc.rect(10, 23, 3, 1, '#3d6fb5');
  pc.vline(4, 26, 13, '#6c707c');
  pc.vline(31, 26, 13, '#6c707c');
  pc.hline(2, 38, 6, '#6c707c');
  pc.hline(28, 38, 6, '#6c707c');
  pc.px(2, 40, '#16161c');
  pc.px(7, 40, '#16161c');
  pc.px(28, 40, '#16161c');
  pc.px(33, 40, '#16161c');
  void t;
  return pc.outline(-0.5);
}

export function drawFloorLamp(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(14, 38);
  const shadeC = t.id === 'midnight' ? '#ffcf8a' : '#f3e2c0';
  pc.rect(2, 2, 10, 7, shadeC);
  pc.hline(2, 2, 10, shade(shadeC, 0.2));
  pc.hline(1, 8, 12, shade(shadeC, -0.15));
  pc.rect(4, 9, 6, 1, '#fff2c4');
  pc.vline(7, 10, 25, '#2d2c33');
  pc.rect(4, 34, 7, 2, '#2d2c33');
  return pc.outline(-0.5);
}

export function drawServerRack(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(20, 44);
  const c = t.id === 'midnight' ? '#181a2c' : '#2d2f3a';
  pc.rect(1, 2, 18, 41, c);
  pc.rect(1, 2, 18, 3, shade(c, 0.2));
  for (let i = 0; i < 8; i++) {
    const y = 6 + i * 4;
    pc.rect(3, y, 14, 3, shade(c, 0.1));
    pc.hline(3, y + 2, 14, shade(c, -0.2));
    pc.hline(9, y + 1, 6, shade(c, -0.25));
  }
  pc.vline(18, 5, 38, shade(c, -0.3));
  return pc.outline(-0.4);
}

/** LED positions for the server rack (sprite-local). */
export const SERVER_LEDS = Array.from({ length: 8 }, (_, i) => ({ x: 4 + (i % 2), y: 7 + i * 4 }));

export function drawWaterCooler(): PixelCanvas {
  const pc = new PixelCanvas(14, 32);
  pc.round(3, 1, 8, 10, '#9fd4f2');
  pc.rect(4, 2, 2, 7, '#d4efff');
  pc.rect(5, 10, 4, 2, '#7ab7d8');
  pc.rect(2, 12, 10, 18, '#e9e5de');
  pc.vline(11, 12, 18, '#c9c4bb');
  pc.rect(4, 15, 2, 2, '#3d6fb5');
  pc.rect(8, 15, 2, 2, '#e2705c');
  pc.rect(3, 19, 8, 1, '#c9c4bb');
  return pc.outline(-0.5);
}

export function drawArcade(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(20, 42);
  const body = '#3b2b6b';
  pc.rect(2, 2, 16, 39, body);
  pc.rect(2, 2, 16, 5, t.accent);
  pc.hline(4, 4, 12, WHITE);
  pc.rect(4, 9, 12, 10, '#0c0f1e');
  pc.rect(2, 20, 16, 4, shade(body, 0.2));
  pc.px(6, 21, '#ff5f5f');
  pc.px(9, 21, '#62e6ff');
  pc.px(12, 22, '#ffd166');
  pc.vline(17, 7, 34, shade(body, -0.3));
  return pc.outline(-0.4);
}

export function drawBeanbag(t: ThemeStyle): PixelCanvas {
  const pc = new PixelCanvas(20, 16);
  const c = t.id === 'midnight' ? '#ff5fa2' : t.accent;
  pc.ellipse(10, 9, 8, 5, c);
  pc.ellipse(10, 7, 6, 3, shade(c, 0.1));
  pc.hline(5, 13, 10, shade(c, -0.25));
  pc.px(8, 6, shade(c, 0.3));
  return pc.outline(-0.5);
}

// ───────────────────────────────── shop decorations

export function drawLavaLamp(): PixelCanvas {
  const pc = new PixelCanvas(10, 24);
  const glass = '#ff6fa8';
  pc.rect(3, 19, 4, 4, '#3a3a44');
  pc.hline(2, 22, 6, '#2a2a32');
  pc.round(2, 5, 6, 14, glass);
  pc.vline(3, 7, 9, shade(glass, 0.25));
  pc.round(4, 8, 3, 3, '#ffd166');
  pc.round(3, 13, 3, 4, '#ffd166');
  pc.rect(3, 3, 4, 2, '#3a3a44');
  return pc.outline(-0.5);
}

export function drawTrophy(): PixelCanvas {
  const pc = new PixelCanvas(14, 26);
  const gold = '#f2c230';
  const dark = '#b58410';
  pc.rect(2, 16, 10, 9, '#5a4636');
  pc.hline(2, 16, 10, '#7a604a');
  pc.rect(5, 19, 4, 2, gold);
  pc.rect(5, 12, 4, 4, dark);
  pc.round(2, 2, 10, 9, gold);
  pc.vline(4, 3, 6, shade(gold, 0.3));
  pc.vline(10, 3, 6, dark);
  pc.round(0, 3, 3, 5, dark);
  pc.round(11, 3, 3, 5, dark);
  pc.hline(4, 11, 6, dark);
  return pc.outline(-0.5);
}

export function drawCat(): PixelCanvas {
  const pc = new PixelCanvas(18, 12);
  const cushion = '#6a8fd6';
  const fur = '#e89a4c';
  pc.ellipse(9, 8, 8, 3, cushion);
  pc.hline(2, 10, 14, shade(cushion, -0.25));
  pc.ellipse(9, 6, 6, 3, fur);
  pc.round(3, 3, 5, 4, fur);
  pc.px(3, 2, fur);
  pc.px(6, 2, fur);
  pc.hline(4, 5, 1, '#3a2a20');
  pc.hline(6, 5, 1, '#3a2a20');
  for (const x of [9, 12]) pc.vline(x, 4, 2, shade(fur, -0.2));
  pc.hline(11, 8, 5, shade(fur, -0.15));
  return pc.outline(-0.5);
}

export function drawJukebox(): PixelCanvas {
  const pc = new PixelCanvas(20, 32);
  const wood = '#7a3b2e';
  pc.round(1, 1, 18, 30, wood);
  pc.round(3, 3, 14, 12, '#ffb347');
  pc.round(5, 5, 10, 8, '#ff6f61');
  pc.round(7, 7, 6, 5, '#ffd166');
  pc.rect(4, 17, 12, 6, '#2b2233');
  for (let x = 5; x < 15; x += 2) pc.vline(x, 18, 4, '#62e6ff');
  pc.rect(4, 25, 12, 4, shade(wood, -0.2));
  pc.vline(18, 4, 24, shade(wood, -0.3));
  return pc.outline(-0.45);
}

export function drawAquarium(): PixelCanvas {
  const pc = new PixelCanvas(34, 28);
  const water = '#3e8fd1';
  pc.rect(2, 16, 30, 11, '#3b3440');
  pc.hline(2, 16, 30, '#524857');
  pc.rect(1, 2, 32, 14, water, 0.9);
  pc.hline(1, 2, 32, '#bfe6ff');
  pc.rect(2, 4, 30, 2, shade(water, 0.15));
  pc.rect(1, 13, 32, 3, '#d9c48f');
  pc.vline(6, 7, 6, '#4caf6a');
  pc.vline(7, 9, 4, '#4caf6a');
  pc.vline(26, 8, 5, '#4caf6a');
  pc.rect(12, 7, 4, 2, '#ff8a3d');
  pc.px(11, 8, '#ff8a3d');
  pc.px(14, 7, '#232029');
  pc.rect(20, 10, 3, 2, '#ffd166');
  pc.px(23, 10, '#ffd166');
  pc.px(18, 5, WHITE);
  pc.px(19, 3, WHITE);
  return pc.outline(-0.45);
}

/** Decorations sold in the shop (see CATALOG in team-protocol). */
export const SHOP_FURNITURE = ['lava_lamp', 'trophy', 'cat', 'jukebox', 'aquarium'] as const;

export const FURNITURE: Record<string, FurnitureDef> = {
  desk: { fw: 2, fh: 1, bottomPad: 0, ox: -1, blocks: true, draw: (t) => drawDesk(t) },
  plant_monstera: { fw: 1, fh: 1, bottomPad: 1, ox: -6, blocks: true, draw: (t) => drawMonstera(t) },
  plant_fiddle: { fw: 1, fh: 1, bottomPad: 1, ox: -2, blocks: true, draw: (t) => drawFiddle(t) },
  plant_succulent: { fw: 1, fh: 1, bottomPad: 0, ox: 1, blocks: true, draw: (t) => drawSucculent(t) },
  bookshelf: { fw: 2, fh: 1, bottomPad: 0, ox: -1, blocks: true, draw: (t) => drawBookshelf(t) },
  sofa: { fw: 3, fh: 1, bottomPad: 2, ox: -1, blocks: true, draw: (t) => drawSofa(t) },
  coffee_table: { fw: 2, fh: 1, bottomPad: 0, ox: 1, blocks: true, draw: (t) => drawCoffeeTable(t) },
  coffee_bar: { fw: 4, fh: 1, bottomPad: 0, ox: -1, blocks: true, draw: (t) => drawCoffeeBar(t) },
  meeting_table: { fw: 3, fh: 2, bottomPad: -2, ox: 0, blocks: true, draw: (t) => drawMeetingTable(t) },
  whiteboard: { fw: 2, fh: 1, bottomPad: 1, ox: -2, blocks: true, draw: (t) => drawWhiteboard(t) },
  floor_lamp: {
    fw: 1,
    fh: 1,
    bottomPad: 0,
    ox: 1,
    blocks: true,
    light: { x: 7, y: 8, r: 34, color: 'warm', strength: 0.9 },
    draw: (t) => drawFloorLamp(t),
  },
  server_rack: { fw: 1, fh: 1, bottomPad: 0, ox: -2, blocks: true, light: { x: 10, y: 20, r: 18, color: 'screen', strength: 0.35 }, draw: (t) => drawServerRack(t) },
  water_cooler: { fw: 1, fh: 1, bottomPad: 0, ox: 1, blocks: true, draw: () => drawWaterCooler() },
  arcade: { fw: 1, fh: 1, bottomPad: 0, ox: -2, blocks: true, light: { x: 10, y: 14, r: 26, color: 'accent', strength: 0.7 }, draw: (t) => drawArcade(t) },
  beanbag: { fw: 1, fh: 1, bottomPad: 0, ox: -2, blocks: true, draw: (t) => drawBeanbag(t) },
  lava_lamp: { fw: 1, fh: 1, bottomPad: 0, ox: 3, blocks: true, light: { x: 5, y: 10, r: 22, color: 'accent', strength: 0.6 }, draw: () => drawLavaLamp() },
  trophy: { fw: 1, fh: 1, bottomPad: 0, ox: 1, blocks: true, draw: () => drawTrophy() },
  cat: { fw: 1, fh: 1, bottomPad: 0, ox: -1, blocks: true, draw: () => drawCat() },
  jukebox: { fw: 1, fh: 1, bottomPad: 0, ox: -2, blocks: true, light: { x: 10, y: 9, r: 26, color: 'warm', strength: 0.6 }, draw: () => drawJukebox() },
  aquarium: { fw: 2, fh: 1, bottomPad: 0, ox: -1, blocks: true, light: { x: 17, y: 8, r: 26, color: 'screen', strength: 0.5 }, draw: () => drawAquarium() },
};


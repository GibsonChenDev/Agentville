import { PixelCanvas, bandedRadial, mix, rng, shade, type Color } from '../engine/pixel';
import { WHITE } from '../assets/palette';
import type { ThemeStyle } from '../assets/themes';
import { FURNITURE } from '../furniture/furniture';
import { CLOCK_RADIUS } from './clock';
import { TILE, type Rug, type SceneDefinition, type WallDecor } from './layouts';

export const CAP = 8;

/** Static background: floor, rugs, back wall with decor, wall caps and contact shadows. */
export function drawRoom(t: ThemeStyle, scene: SceneDefinition): PixelCanvas {
  const W = scene.cols * TILE;
  const H = scene.rows * TILE;
  const wallH = scene.wallRows * TILE;
  const pc = new PixelCanvas(W, H);
  pc.rect(0, 0, W, H, t.void);

  drawFloor(pc, t, W, H, wallH);
  for (const rug of scene.rugs) drawRug(pc, t, rug);
  drawWall(pc, t, W, wallH);
  for (const d of scene.wallDecor) drawDecor(pc, t, d, wallH);
  drawShadows(pc, t, scene, wallH, W, H);

  // wall caps (the top of the side and front walls, seen from above)
  pc.rect(0, 0, CAP, H, t.cap);
  pc.rect(W - CAP, 0, CAP, H, t.cap);
  pc.rect(0, H - CAP, W, CAP, t.cap);
  pc.vline(CAP - 1, wallH, H - wallH - CAP, shade(t.cap, 0.25));
  pc.vline(W - CAP, wallH, H - wallH - CAP, shade(t.cap, 0.25));
  pc.hline(CAP, H - CAP, W - CAP * 2, shade(t.cap, 0.25));
  return pc;
}

function drawFloor(pc: PixelCanvas, t: ThemeStyle, W: number, H: number, wallH: number) {
  const { base, alt, seam } = t.floor;
  const rand = rng(1234);
  const y0 = wallH;
  if (t.floor.kind === 'planks') {
    const plankH = 6;
    for (let y = y0; y < H; y += plankH) {
      let x = -Math.floor(rand() * 30);
      while (x < W) {
        const len = 28 + Math.floor(rand() * 34);
        const tone = rand();
        const c = tone < 0.33 ? base : tone < 0.66 ? alt : mix(base, alt, 0.5);
        pc.rect(x, y, len, plankH, c);
        pc.hline(x, y, len, shade(c, 0.07));
        // grain
        for (let g = 0; g < 3; g++) {
          const gx = x + 2 + Math.floor(rand() * (len - 8));
          pc.hline(gx, y + 2 + Math.floor(rand() * 3), 3 + Math.floor(rand() * 6), shade(c, -0.08));
        }
        if (rand() < 0.08) pc.px(x + 4 + Math.floor(rand() * (len - 8)), y + 3, shade(c, -0.22));
        pc.vline(x, y, plankH, seam);
        x += len;
      }
      pc.hline(0, y + plankH - 1, W, shade(seam, 0.15));
    }
  } else if (t.floor.kind === 'tiles') {
    const size = 32;
    for (let y = y0; y < H; y += size) {
      for (let x = 0; x < W; x += size) {
        const c = ((x + y) / size) % 2 === 0 ? base : alt;
        pc.rect(x, y, size, size, c);
        for (let i = 0; i < 6; i++) pc.px(x + Math.floor(rand() * size), y + Math.floor(rand() * size), shade(c, rand() > 0.5 ? 0.05 : -0.05));
        pc.hline(x, y, size, seam);
        pc.vline(x, y, size, seam);
        pc.hline(x + 1, y + 1, size - 1, shade(c, 0.08));
      }
    }
  } else if (t.floor.kind === 'tatami') {
    // Mats two tiles by one, laid in the traditional alternating pattern, with dark cloth borders.
    const u = 32;
    for (let y = y0, row = 0; y < H; y += u, row++) {
      for (let x = 0, col = 0; x < W; x += u * 2, col++) {
        const across = (row + col) % 2 === 0;
        const mats = across ? [[x, y, u * 2, u]] : [[x, y, u, u], [x + u, y, u, u]];
        for (const [mx, my, mw, mh] of mats) {
          const c = rand() < 0.5 ? base : alt;
          pc.rect(mx!, my!, mw!, mh!, c);
          // woven rush: fine lines along the mat
          for (let i = 2; i < (across ? mh! : mw!) - 1; i += 2) {
            if (across) pc.hline(mx! + 2, my! + i, mw! - 4, shade(c, -0.06));
            else pc.vline(mx! + i, my! + 2, mh! - 4, shade(c, -0.06));
          }
          pc.hline(mx!, my!, mw!, seam);
          pc.hline(mx!, my! + mh! - 1, mw!, seam);
          pc.hline(mx!, my! + 1, mw!, shade(seam, 0.25), 0.6);
          pc.vline(mx!, my!, mh!, shade(c, -0.18));
        }
      }
    }
  } else if (t.floor.kind === 'metal') {
    // Riveted deck plates with glowing seams every few panels.
    const size = 32;
    for (let y = y0; y < H; y += size) {
      for (let x = 0; x < W; x += size) {
        const c = ((x + y) / size) % 2 === 0 ? base : alt;
        pc.rect(x, y, size, size, c);
        // diamond tread
        for (let j = 4; j < size - 2; j += 6) for (let i = 4 + ((j / 6) % 2) * 3; i < size - 2; i += 6) pc.px(x + i, y + j, shade(c, 0.14));
        pc.hline(x, y, size, seam);
        pc.vline(x, y, size, seam);
        pc.hline(x + 1, y + 1, size - 1, shade(c, 0.1));
        for (const [rx, ry] of [[3, 3], [size - 4, 3], [3, size - 4], [size - 4, size - 4]] as const) pc.px(x + rx, y + ry, shade(c, 0.3));
      }
    }
    for (let y = y0 + size * 2; y < H; y += size * 3) pc.hline(0, y, W, t.accent, 0.45);
  } else {
    const size = 16;
    for (let y = y0; y < H; y += size) {
      for (let x = 0; x < W; x += size) {
        const c = ((x + y) / size) % 2 === 0 ? base : alt;
        pc.rect(x, y, size, size, c);
        // carpet texture: grain direction alternates per tile
        const vertical = ((x + y) / size) % 2 === 0;
        for (let i = 0; i < size; i += 3) {
          if (vertical) pc.vline(x + i, y + 1, size - 2, shade(c, -0.05));
          else pc.hline(x + 1, y + i, size - 2, shade(c, -0.05));
        }
        for (let i = 0; i < 4; i++) pc.px(x + Math.floor(rand() * size), y + Math.floor(rand() * size), shade(c, 0.08));
      }
    }
    for (let y = y0; y < H; y += size) pc.hline(0, y, W, seam, 0.6);
  }
}

function drawRug(pc: PixelCanvas, t: ThemeStyle, rug: Rug) {
  const x = rug.x * TILE;
  const y = rug.y * TILE;
  const w = rug.w * TILE;
  const h = rug.h * TILE;
  const { base, border, pattern } = t.rug;
  if (rug.style === 'round') {
    pc.ellipse(x + w / 2, y + h / 2 + 1, w / 2, h / 2, shade(base, -0.4), 0.35);
    pc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, border);
    pc.ellipse(x + w / 2, y + h / 2, w / 2 - 3, h / 2 - 3, base);
    pc.ellipse(x + w / 2, y + h / 2, w / 2 - 10, h / 2 - 8, pattern);
    pc.ellipse(x + w / 2, y + h / 2, w / 2 - 13, h / 2 - 10, base);
    return;
  }
  pc.rect(x, y + 1, w, h, shade(base, -0.4), 0.35);
  pc.rect(x, y, w, h, border);
  pc.rect(x + 3, y + 3, w - 6, h - 6, base);
  if (rug.style === 'persian') {
    pc.rect(x + 6, y + 6, w - 12, h - 12, shade(base, -0.08));
    pc.rect(x + 8, y + 8, w - 16, h - 16, base);
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let i = 0; i < 6; i++) {
      pc.hline(cx - 12 + i * 2, cy - 6 + i, 24 - i * 4, pattern);
      pc.hline(cx - 12 + i * 2, cy + 6 - i, 24 - i * 4, pattern);
    }
    pc.rect(cx - 2, cy - 1, 4, 3, border);
    for (let i = x + 12; i < x + w - 12; i += 8) {
      pc.px(i, y + 6, border);
      pc.px(i, y + h - 7, border);
    }
    // tassels
    for (let i = x + 2; i < x + w - 2; i += 3) {
      pc.vline(i, y - 2, 2, border);
      pc.vline(i, y + h, 2, border);
    }
  } else if (rug.style === 'stripe') {
    for (let i = 0; i < h - 6; i += 8) pc.rect(x + 3, y + 3 + i, w - 6, 3, pattern);
  } else {
    for (let i = x + 3; i < x + w - 3; i += 12) pc.vline(i, y + 3, h - 6, pattern, 0.6);
    for (let j = y + 3; j < y + h - 3; j += 12) pc.hline(x + 3, j, w - 6, pattern, 0.6);
  }
}

function drawWall(pc: PixelCanvas, t: ThemeStyle, W: number, wallH: number) {
  const { base, alt, mortar, crown, baseboard } = t.wall;
  const rand = rng(77);
  pc.rect(0, 0, W, wallH, base);
  if (t.wall.kind === 'brick') {
    const bw = 12;
    const bh = 5;
    for (let row = 0, y = 4; y < wallH - 6; row++, y += bh) {
      const offset = row % 2 ? bw / 2 : 0;
      for (let x = -offset; x < W; x += bw) {
        const r = rand();
        const c = r < 0.4 ? base : r < 0.75 ? alt : r < 0.9 ? shade(base, 0.08) : shade(alt, -0.1);
        pc.rect(x, y, bw - 1, bh - 1, c);
        pc.hline(x, y, bw - 1, shade(c, 0.07));
        if (rand() < 0.15) pc.px(x + 2 + Math.floor(rand() * 7), y + 2, shade(c, -0.15));
      }
      pc.hline(0, y + bh - 1, W, mortar);
    }
    // whitewash wear toward the top
    for (let i = 0; i < 260; i++) pc.px(Math.floor(rand() * W), 4 + Math.floor(rand() * 18), '#e8d6c4', 0.18);
  } else if (t.wall.kind === 'plaster') {
    for (let i = 0; i < 500; i++) pc.px(Math.floor(rand() * W), Math.floor(rand() * wallH), alt, 0.5);
    // colour-block band
    pc.rect(0, wallH - 22, W, 14, shade(t.accent, 0.35), 0.35);
  } else if (t.wall.kind === 'shiplap') {
    // Painted horizontal boards with a shadow line under each one.
    for (let y = 4; y < wallH - 6; y += 6) {
      pc.rect(0, y, W, 6, (y / 6) % 2 ? base : alt);
      pc.hline(0, y + 5, W, mortar);
      for (let i = 0; i < 4; i++) pc.px(Math.floor(rand() * W), y + 2, shade(base, -0.05));
    }
    // a rope-trimmed band, beach-house style
    for (let x = 0; x < W; x += 4) {
      pc.px(x, wallH - 24, '#c9a46a');
      pc.px(x + 1, wallH - 23, '#b08850');
      pc.px(x + 2, wallH - 24, '#c9a46a');
    }
  } else if (t.wall.kind === 'shoji') {
    // Paper screens in dark wooden frames, a lattice of small panes.
    for (let x = 0; x < W; x += 48) {
      pc.rect(x, 4, 48, wallH - 10, (x / 48) % 2 ? base : alt);
      for (let gx = x + 8; gx < x + 48; gx += 8) pc.vline(gx, 6, wallH - 14, mortar, 0.55);
      for (let gy = 12; gy < wallH - 8; gy += 10) pc.hline(x, gy, 48, mortar, 0.55);
      pc.rect(x, 4, 3, wallH - 10, mortar);
      pc.vline(x + 3, 4, wallH - 10, shade(mortar, 0.2));
    }
    // a lacquered rail along the top
    pc.rect(0, 4, W, 2, shade(mortar, -0.1));
  } else if (t.wall.kind === 'hull') {
    // Bolted hull panels with a lit conduit and status lights.
    for (let x = 0; x < W; x += 32) {
      pc.rect(x, 4, 32, wallH - 10, (x / 32) % 2 ? base : alt);
      pc.vline(x, 4, wallH - 10, mortar);
      pc.vline(x + 1, 4, wallH - 10, shade(alt, 0.12));
      for (const ry of [8, wallH - 12]) {
        pc.px(x + 4, ry, shade(alt, 0.35));
        pc.px(x + 27, ry, shade(alt, 0.35));
      }
      if (rand() < 0.5) pc.px(x + 16, wallH - 14, rand() < 0.5 ? '#43f0d6' : '#ff5fa2');
    }
    pc.hline(0, wallH - 20, W, mortar);
    pc.hline(0, wallH - 19, W, t.accent, 0.7);
    pc.hline(0, wallH - 18, W, t.accent, 0.2);
  } else {
    for (let x = 0; x < W; x += 24) {
      pc.rect(x, 4, 24, wallH - 10, x % 48 === 0 ? base : alt);
      pc.vline(x, 4, wallH - 10, mortar);
      pc.vline(x + 1, 4, wallH - 10, shade(alt, 0.08));
    }
    // LED strip under the crown
    pc.hline(0, 5, W, '#43f0d6', 0.9);
    pc.hline(0, 6, W, '#43f0d6', 0.25);
  }
  // crown moulding and baseboard
  pc.rect(0, 0, W, 4, crown);
  pc.hline(0, 3, W, shade(crown, 0.2));
  pc.rect(0, wallH - 6, W, 6, baseboard);
  pc.hline(0, wallH - 6, W, shade(baseboard, 0.2));
  pc.hline(0, wallH - 1, W, shade(baseboard, -0.3));
}

function drawWindow(pc: PixelCanvas, t: ThemeStyle, x: number, w: number, panes: number, wallH: number) {
  const y = 8;
  const h = wallH - 18;
  const { skyTop, skyBottom, frame } = t.window;
  // sky in hard bands
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    pc.rect(x, y + Math.floor((h * i) / bands), w, Math.ceil(h / bands) + 1, mix(skyTop, skyBottom, i / (bands - 1)));
  }
  const rand = rng(x * 13 + 5);
  /** A horizontal run clipped to the glass. */
  const glass = (x1: number, yy: number, len: number, c: Color, alpha?: number) => {
    const a = Math.max(x, x1);
    const b = Math.min(x + w, x1 + len);
    if (b > a && yy >= y && yy < y + h) pc.hline(a, yy, b - a, c, alpha);
  };
  if (t.window.scenery === 'city') {
    pc.round(x + 8, y + 6, 12, 4, WHITE, 0.8);
    pc.round(x + 12, y + 4, 8, 3, WHITE, 0.8);
    let bx = x;
    while (bx < x + w) {
      const bw = 6 + Math.floor(rand() * 10);
      const bh = 10 + Math.floor(rand() * 22);
      const c = mix('#7b8fb0', '#a7b6cc', rand());
      pc.rect(bx, y + h - bh, bw, bh, c);
      for (let wy = y + h - bh + 2; wy < y + h - 2; wy += 3) for (let wx = bx + 1; wx < bx + bw - 1; wx += 2) if (rand() < 0.35) pc.px(wx, wy, '#dce6f2');
      bx += bw;
    }
  } else if (t.window.scenery === 'sea') {
    // Sunset over the sea: low sun, glittering water, a sailboat, a strip of sand.
    const horizon = y + Math.round(h * 0.55);
    pc.ellipse(x + Math.round(w * 0.65), horizon - 2, 6, 6, '#fff1c1');
    pc.rect(x, horizon, w, y + h - horizon, '#3d7fa6');
    for (let i = 0; i < w; i += 3) pc.px(x + i + Math.floor(rand() * 3), horizon + 2 + Math.floor(rand() * (y + h - horizon - 6)), rand() < 0.5 ? '#ffd9a0' : '#7fc2e0');
    pc.hline(x + Math.round(w * 0.65) - 5, horizon + 1, 10, '#ffd9a0');
    const bx = x + Math.round(w * 0.25);
    pc.rect(bx, horizon - 1, 7, 2, '#f4f7f8');
    pc.vline(bx + 3, horizon - 8, 7, '#5a4030');
    for (let i = 0; i < 5; i++) pc.hline(bx + 4, horizon - 7 + i, 1 + Math.floor(i / 2), '#f4f7f8');
    pc.rect(x, y + h - 3, w, 3, '#e8d2a0');
  } else if (t.window.scenery === 'garden') {
    // Greenhouse glass onto a garden: hedges, flower beds, a fruit tree.
    pc.round(x + 10, y + 5, 12, 4, WHITE, 0.85);
    pc.rect(x, y + h - 12, w, 12, '#5f9a4e');
    for (let i = 0; i < w; i += 4) pc.round(x + i, y + h - 15 + Math.floor(rand() * 3), 5, 5, rand() < 0.5 ? '#4e8a42' : '#69a957');
    for (let i = 0; i < w; i += 3) pc.px(x + i + Math.floor(rand() * 2), y + h - 5 - Math.floor(rand() * 4), ['#ff9db0', '#ffd166', '#f4f7f8', '#c7a3ff'][Math.floor(rand() * 4)]!);
    const tx = x + Math.round(w * 0.7);
    pc.vline(tx, y + h - 22, 10, '#6e4a30');
    pc.round(tx - 7, y + h - 32, 15, 12, '#4e8a42');
    for (let i = 0; i < 5; i++) pc.px(tx - 5 + Math.floor(rand() * 11), y + h - 30 + Math.floor(rand() * 8), '#ff7f5f');
  } else if (t.window.scenery === 'sakura') {
    // Mount Fuji behind cherry trees in bloom, petals drifting past.
    const cx = x + Math.round(w * 0.45);
    for (let i = 0; i < h - 10; i++) glass(cx - i, y + 10 + i, i * 2 + 1, i < 7 ? '#f6f8fb' : '#8aa3c4');
    pc.rect(x, y + h - 10, w, 10, '#7fa36a');
    for (let i = 0; i < w - 12; i += 12) {
      const tx = x + i + Math.floor(rand() * 6);
      pc.vline(tx + 4, y + h - 14, 8, '#5a3a2a');
      pc.round(tx - 2, y + h - 24, 13, 11, rand() < 0.5 ? '#f6b6c8' : '#f9c8d5');
      for (let k = 0; k < 4; k++) pc.px(tx + Math.floor(rand() * 10), y + h - 22 + Math.floor(rand() * 8), '#e889a6');
    }
    for (let i = 0; i < 10; i++) pc.px(x + Math.floor(rand() * w), y + Math.floor(rand() * (h - 12)), '#ffd0dc');
  } else if (t.window.scenery === 'space') {
    // Deep space: stars, a ringed planet and the curve of a blue world below.
    for (let i = 0; i < 26; i++) pc.px(x + Math.floor(rand() * w), y + Math.floor(rand() * h), rand() < 0.8 ? '#e8ecff' : '#ffd27a', 0.6 + rand() * 0.4);
    const px0 = x + Math.round(w * 0.68);
    pc.ellipse(px0, y + 12, 6, 6, '#e7a86a');
    pc.hline(px0 - 3, y + 10, 6, '#f5c896');
    glass(px0 - 11, y + 13, 23, '#cfd6ff', 0.8);
    glass(px0 - 9, y + 14, 4, '#cfd6ff', 0.6);
    // the planet below: an ellipse whose top shows over the sill
    const ecx = x + Math.round(w * 0.3);
    const ecy = y + h + 18;
    const rx = Math.round(w * 0.55);
    for (let yy = ecy - 24; yy < y + h; yy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - ((yy - ecy) / 24) ** 2)));
      glass(ecx - half, yy, half * 2, yy - (ecy - 24) < 2 ? '#7fb4ff' : '#3d86e6');
    }
    for (let i = 0; i < 5; i++) glass(x + Math.floor(rand() * w * 0.6), y + h - 3 + Math.floor(rand() * 2), 6, '#f4f7f8', 0.7);
  } else if (t.window.scenery === 'hills') {
    pc.round(x + w - 30, y + 5, 14, 4, WHITE, 0.9);
    for (let i = 0; i < w; i++) {
      const hh = 8 + Math.round(5 * Math.sin((i + x) / 13) + 3 * Math.sin((i + x) / 5));
      pc.vline(x + i, y + h - hh, hh, '#d8b46a');
      pc.px(x + i, y + h - hh, '#e8cc86');
    }
    for (let i = 0; i < w; i += 9) {
      const tx = x + i + Math.floor(rand() * 4);
      pc.round(tx, y + h - 13, 6, 6, '#4e8a52');
      pc.vline(tx + 3, y + h - 7, 4, '#5a4030');
    }
    pc.rect(x, y + h - 4, w, 4, '#7aa457');
  } else {
    // night city: moon, stars, lit windows
    pc.round(x + w - 22, y + 4, 8, 8, '#fff2c4');
    pc.round(x + w - 19, y + 4, 6, 6, mix(skyTop, skyBottom, 0.1));
    for (let i = 0; i < 18; i++) pc.px(x + Math.floor(rand() * w), y + Math.floor(rand() * (h / 2)), '#cfd6ff', 0.7);
    let bx = x;
    while (bx < x + w) {
      const bw = 7 + Math.floor(rand() * 10);
      const bh = 12 + Math.floor(rand() * 22);
      pc.rect(bx, y + h - bh, bw, bh, mix('#0e1029', '#1d2050', rand()));
      for (let wy = y + h - bh + 2; wy < y + h - 1; wy += 3)
        for (let wx = bx + 1; wx < bx + bw - 1; wx += 2) if (rand() < 0.3) pc.px(wx, wy, rand() < 0.8 ? '#ffd27a' : '#7fe6ff');
      if (rand() < 0.4) pc.px(bx + Math.floor(bw / 2), y + h - bh - 1, '#ff5f5f');
      bx += bw;
    }
  }
  // frame and mullions
  pc.rect(x - 2, y - 2, w + 4, 2, frame);
  pc.rect(x - 2, y + h, w + 4, 3, frame);
  pc.vline(x - 2, y, h, frame);
  pc.vline(x - 1, y, h, frame);
  pc.vline(x + w, y, h, frame);
  pc.vline(x + w + 1, y, h, frame);
  for (let i = 1; i < panes; i++) pc.rect(x + Math.round((w * i) / panes) - 1, y, 2, h, frame);
  pc.rect(x, y + Math.round(h * 0.42), w, 1, frame);
  // sill + glass glare
  pc.rect(x - 4, y + h + 3, w + 8, 2, shade(t.wall.crown, 0.3));
  for (let i = 0; i < 6; i++) pc.px(x + 4 + i, y + 10 - i, WHITE, 0.4);
  for (let i = 0; i < 4; i++) pc.px(x + 8 + i, y + 10 - i, WHITE, 0.25);
}

function drawDecor(pc: PixelCanvas, t: ThemeStyle, d: WallDecor, wallH: number) {
  switch (d.kind) {
    case 'window':
      drawWindow(pc, t, d.x, d.w, d.panes ?? 3, wallH);
      return;
    case 'door': {
      const x = d.x;
      const y = 10;
      const w = 32;
      const h = wallH - y;
      const frame = t.id === 'studio' ? '#cfc8bb' : t.id === 'midnight' ? '#2c2e4a' : '#3b2a20';
      pc.rect(x - 3, y - 3, w + 6, h + 3, frame);
      pc.hline(x - 3, y - 3, w + 6, shade(frame, 0.2));
      // hallway glimpse
      pc.rect(x, y, w, h, t.id === 'midnight' ? '#3a3560' : '#efe3cc');
      pc.rect(x, y + h - 14, w, 14, t.id === 'midnight' ? '#2a2645' : '#d8c4a4');
      pc.rect(x, y, w, 4, shade(t.id === 'midnight' ? '#3a3560' : '#efe3cc', -0.2));
      // open door leaf
      const leaf = t.id === 'studio' ? '#bfe3f2' : t.id === 'midnight' ? '#24263f' : '#8a5a35';
      pc.rect(x, y, 7, h, leaf, t.id === 'studio' ? 0.7 : 1);
      pc.vline(x + 6, y, h, shade(leaf, -0.25));
      pc.rect(x + 3, y + h / 2, 2, 3, '#e0c070');
      if (t.id === 'midnight') pc.rect(x + w + 5, y + 14, 3, 5, '#43f0d6');
      // exit sign
      pc.rect(x + 9, y - 9, 14, 5, t.id === 'midnight' ? '#2d6b4a' : '#3a8a5a');
      pc.hline(x + 11, y - 7, 10, '#c8ffd6');
      return;
    }
    case 'office_door': {
      const x = d.x;
      const y = 10;
      const w = 32;
      const h = wallH - y;
      const frame = '#2a2a2f';
      const leaf = '#8a5a35';
      pc.rect(x - 3, y - 3, w + 6, h + 3, frame);
      pc.hline(x - 3, y - 3, w + 6, shade(frame, 0.25));
      pc.rect(x, y, w, h, leaf);
      pc.vline(x + 15, y, h, shade(leaf, -0.3));
      for (const px of [x + 3, x + 18]) {
        pc.rect(px, y + 4, 11, 12, shade(leaf, 0.1));
        pc.rect(px + 1, y + 5, 9, 10, '#bfe3f2', 0.85);
        pc.hline(px + 2, y + 6, 4, WHITE, 0.8);
      }
      pc.rect(x + 12, y + h / 2 + 2, 2, 3, '#e0c070');
      pc.rect(x + 17, y + h / 2 + 2, 2, 3, '#e0c070');
      // name plate (the name itself is drawn as a sign by the renderer)
      pc.rect(x + 2, y - 10, w - 4, 6, d.plate);
      pc.hline(x + 2, y - 10, w - 4, shade(d.plate, 0.25));
      return;
    }
    case 'poster': {
      const palettes = [
        ['#e0a93d', '#e2705c', '#2f4170'],
        ['#e2705c', '#f2eee7', '#2b8a8a'],
        ['#ff5fa2', '#43f0d6', '#1d1f38'],
      ][d.variant % 3]!;
      const [a, b, c] = palettes as [Color, Color, Color];
      pc.rect(d.x - 1, d.y - 1, 22, 28, '#2d2c33');
      pc.rect(d.x, d.y, 20, 26, c);
      pc.ellipse(d.x + 10, d.y + 10, 6, 6, a);
      pc.rect(d.x + 3, d.y + 17, 14, 2, b);
      pc.rect(d.x + 5, d.y + 21, 10, 1, b);
      return;
    }
    case 'clock': {
      // Face and hour marks only: the renderer draws the hands at the current time.
      const cy = d.y + 7;
      pc.ellipse(d.x, cy, CLOCK_RADIUS, CLOCK_RADIUS, '#2d2c33');
      pc.ellipse(d.x, cy, CLOCK_RADIUS - 1, CLOCK_RADIUS - 1, '#f4efe6');
      for (const [x, y] of [
        [0, -6],
        [6, 0],
        [0, 6],
        [-6, 0],
      ] as const)
        pc.px(d.x + x, cy + y, '#8a8592');
      pc.px(d.x, cy, '#e2705c');
      return;
    }
    case 'chalkboard': {
      pc.rect(d.x - 2, d.y - 2, 52, 26, '#6e4329');
      pc.rect(d.x, d.y, 48, 22, '#2f3b36');
      // "menu" scribbles
      pc.hline(d.x + 4, d.y + 4, 16, '#f4efe6');
      pc.hline(d.x + 4, d.y + 9, 22, '#f4efe6', 0.7);
      pc.hline(d.x + 4, d.y + 13, 18, '#f4efe6', 0.7);
      pc.hline(d.x + 4, d.y + 17, 20, '#f4efe6', 0.7);
      pc.round(d.x + 33, d.y + 6, 9, 9, '#f4efe6', 0.8);
      pc.round(d.x + 34, d.y + 7, 7, 7, '#2f3b36');
      pc.px(d.x + 42, d.y + 9, '#f4efe6');
      return;
    }
    case 'shelf': {
      pc.rect(d.x, d.y + 12, d.w, 3, shade(t.wall.crown, 0.35));
      pc.rect(d.x + 3, d.y + 4, 6, 8, '#4b8a4a');
      pc.rect(d.x + 3, d.y + 8, 6, 4, t.accent);
      pc.rect(d.x + 13, d.y + 3, 3, 9, '#e2705c');
      pc.rect(d.x + 16, d.y + 5, 3, 7, '#2f4170');
      pc.rect(d.x + 19, d.y + 4, 2, 8, '#e0a93d');
      pc.rect(d.x + 25, d.y + 7, 7, 5, '#c9ccd6');
      return;
    }
    case 'neon': {
      const c = t.accent;
      const c2 = '#43f0d6';
      bandedRadial(pc, d.x + 22, d.y + 10, 40, 22, c, 0.25, 4);
      // "</>" glyph
      const glyph = [
        '..x...........x..',
        '.x.....x.....x...',
        'x.....x.......x..',
        '.x...x.......x...',
        '..x.x.......x....',
      ];
      glyph.forEach((row, gy) =>
        [...row].forEach((ch, gx) => {
          if (ch === 'x') pc.rect(d.x + gx * 2 + 5, d.y + gy * 3 + 3, 2, 3, gx > 4 && gx < 9 ? c2 : c);
        }),
      );
      return;
    }
    case 'wall_whiteboard': {
      const y = 10;
      const h = wallH - 26;
      pc.rect(d.x - 2, y - 2, d.w + 4, h + 4, '#9da1ad');
      pc.rect(d.x, y, d.w, h, '#fafaf6');
      pc.round(d.x + 6, y + 4, 18, 9, '#3d6fb5');
      pc.round(d.x + 7, y + 5, 16, 7, '#fafaf6');
      pc.hline(d.x + 24, y + 8, 14, '#2d2c33');
      pc.round(d.x + 38, y + 4, 18, 9, '#e2705c');
      pc.round(d.x + 39, y + 5, 16, 7, '#fafaf6');
      for (let i = 0; i < 4; i++) pc.rect(d.x + 62 + (i % 2) * 12, y + 3 + Math.floor(i / 2) * 11, 10, 9, ['#ffd166', '#9be3c3', '#ff9ec7', '#bcd7ff'][i]!);
      pc.hline(d.x + 6, y + 19, 30, '#9aa3b5');
      pc.hline(d.x + 6, y + 23, 22, '#9aa3b5');
      pc.rect(d.x, y + h, d.w, 2, '#c9ccd6');
      return;
    }
    case 'pendant': {
      pc.vline(d.x, 0, 14, '#2d2c33');
      pc.rect(d.x - 5, 14, 11, 4, '#2d2c33');
      pc.rect(d.x - 6, 17, 13, 2, shade('#2d2c33', 0.2));
      pc.rect(d.x - 3, 19, 7, 1, '#fff2c4');
      return;
    }
    case 'slats': {
      for (let x = d.x; x < d.x + d.w; x += 4) {
        pc.rect(x, 4, 3, wallH - 10, '#c8945e');
        pc.vline(x + 2, 4, wallH - 10, '#a8744a');
      }
      pc.round(d.x + d.w / 2 - 10, 14, 20, 12, '#2f4170');
      pc.rect(d.x + d.w / 2 - 6, 18, 12, 4, '#e0a93d');
      return;
    }
  }
}

/** Soft contact shadows under every piece of floor furniture. */
function drawShadows(pc: PixelCanvas, t: ThemeStyle, scene: SceneDefinition, wallH: number, W: number, H: number) {
  const shadow = shade(t.floor.base, -0.6);
  for (const p of scene.furniture) {
    const def = FURNITURE[p.kind];
    if (!def) continue;
    const x = p.x * TILE;
    const y = (p.y + def.fh) * TILE;
    const w = def.fw * TILE;
    pc.rect(x + 1, y - 4, w - 2, 5, shadow, 0.28);
    pc.rect(x + 3, y + 1, w - 4, 1, shadow, 0.18);
  }
  // ambient occlusion along the back wall and side caps
  for (let i = 0; i < 6; i++) pc.hline(0, wallH + i, W, shadow, 0.22 - i * 0.035);
  for (let i = 0; i < 4; i++) {
    pc.vline(CAP + i, wallH, H - wallH, shadow, 0.18 - i * 0.04);
    pc.vline(W - CAP - 1 - i, wallH, H - wallH, shadow, 0.18 - i * 0.04);
  }
}

export interface LightSource {
  x: number;
  y: number;
  r: number;
  color: Color;
  strength: number;
}

/** Darkness overlay with banded light holes (used strongly at night, subtly by day). */
export function drawLightmap(t: ThemeStyle, W: number, H: number, lights: LightSource[]): PixelCanvas | null {
  if (t.darkness.alpha <= 0) return null;
  const pc = new PixelCanvas(W, H);
  pc.rect(0, 0, W, H, t.darkness.color, t.darkness.alpha);
  pc.ctx.globalCompositeOperation = 'destination-out';
  for (const l of lights) bandedRadial(pc, l.x, l.y, l.r, l.r * 0.75, '#000000', l.strength, 5);
  pc.ctx.globalCompositeOperation = 'source-over';
  return pc;
}

/** Additive warm pools and window light shafts. */
export function drawGlowLayer(t: ThemeStyle, scene: SceneDefinition, lights: LightSource[]): PixelCanvas {
  const W = scene.cols * TILE;
  const H = scene.rows * TILE;
  const pc = new PixelCanvas(W, H);
  const wallH = scene.wallRows * TILE;
  if (!t.window.night) {
    for (const d of scene.wallDecor) {
      if (d.kind !== 'window') continue;
      // slanted shaft from window onto the floor, in hard-edged bands
      const steps = 5;
      for (let i = 0; i < 70; i++) {
        const y = wallH + i;
        const skew = Math.floor(i * 0.55);
        const fade = Math.floor(((70 - i) / 70) * steps) / steps;
        pc.hline(d.x + skew + 4, y, d.w - 8, t.warmLight, 0.16 * fade);
      }
    }
  }
  for (const l of lights) bandedRadial(pc, l.x, l.y, l.r, l.r * 0.7, l.color, l.strength * 0.22, 4);
  return pc;
}

import type { CharacterAppearance } from '@agentville/domain';
import { PixelCanvas, mix, shade, type Color } from '../engine/pixel';
import { BLUSH, HAIR, INK, OUTFIT, SKIN, WHITE } from './palette';

/**
 * Procedural, layered character sprites. A character is composed from layers
 * (legs → shoes → torso → arms → head → face → hair → accessory) drawn on a
 * shared 24×36 frame with fixed anchors, so every outfit/accessory combination
 * lines up on every animation frame. Frames are then auto-outlined.
 */

export const FRAME_W = 24;
export const FRAME_H = 36;
/** Anchor (feet centre) inside the frame. */
export const ANCHOR_X = 12;
export const ANCHOR_Y = 35;

export type View = 'front' | 'back' | 'side';

export type ArmPose =
  | 'down'
  | 'swingA'
  | 'swingB'
  | 'type0'
  | 'type1'
  | 'read'
  | 'chin'
  | 'raise0'
  | 'raise1'
  | 'cheer'
  | 'slump'
  | 'gesture'
  | 'phone'
  | 'stretch';

export type EyePose = 'open' | 'blink' | 'down' | 'up' | 'closed' | 'happy' | 'focused';

export interface Pose {
  view: View;
  sit: boolean;
  /** Walk cycle phase 0..3; 0 and 2 are passing poses. */
  step: number;
  /** Vertical body offset in pixels (negative = up). */
  bob: number;
  arms: ArmPose;
  eyes: EyePose;
  mouth?: 'smile' | 'open' | 'flat' | 'o';
  extras?: ('paper' | 'sweat' | 'notebook' | 'zzz' | 'zzz2')[];
}

interface Resolved {
  skin: Color;
  hair: Color;
  top: Color;
  bottom: Color;
  shoes: Color;
  a: CharacterAppearance;
}

function resolve(a: CharacterAppearance): Resolved {
  return { skin: SKIN[a.skin], hair: HAIR[a.hairColor], top: OUTFIT[a.topColor], bottom: OUTFIT[a.bottomColor], shoes: OUTFIT[a.shoesColor], a };
}

/** Head occupies rows HEAD_Y..HEAD_Y+11 in standing pose; widths per row. */
const HEAD_ROWS = [8, 10, 12, 12, 12, 12, 12, 12, 12, 12, 10, 8];
const HEAD_Y = 4;

export function drawCharacter(r: Resolved, pose: Pose): PixelCanvas {
  const pc = new PixelCanvas(FRAME_W, FRAME_H);
  // Seated characters drop 3px; their legs are hidden by desks/chairs.
  const dy = pose.bob + (pose.sit ? 3 : 0);

  if (pose.view !== 'side') drawLongHairBehind(pc, r, pose, dy);
  drawLegs(pc, r, pose, dy);
  drawTorso(pc, r, pose, dy);
  drawArms(pc, r, pose, dy, 'behind');
  drawHead(pc, r, pose, dy);
  drawHair(pc, r, pose, dy);
  drawAccessory(pc, r, pose, dy);
  drawArms(pc, r, pose, dy, 'front');
  drawExtras(pc, pose, dy);
  pc.outline(-0.6);
  return pc;
}

// ───────────────────────────────── legs & shoes

function drawLegs(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const { bottom, skin, shoes } = r;
  const b0 = bottom;
  const b1 = shade(bottom, -0.18);
  const b2 = shade(bottom, -0.32);
  const top = 26 + dy;
  const legLen = 7;
  // A dress's skirt replaces whatever is chosen below; a pleated skirt is a skirt with pleats.
  const dress = r.a.top === 'dress';
  const kind = dress || r.a.bottom === 'pleated' ? 'skirt' : r.a.bottom;
  const skirt = dress ? r.top : b0;
  const skirtLen = dress ? 5 : 4;

  if (pose.sit) {
    // Seated: short thighs facing camera / hidden behind.
    if (pose.view === 'front') {
      pc.rect(8, top, 8, 4, dress ? skirt : b0);
      pc.vline(11, top + 1, 3, shade(dress ? skirt : b0, -0.18));
      pc.rect(8, top + 3, 8, 1, shade(dress ? skirt : b0, -0.18));
    } else if (pose.view === 'back') {
      pc.rect(8, top, 8, 3, shade(dress ? skirt : b0, -0.18));
    }
    return;
  }

  if (pose.view === 'side') {
    // Side walk: front and back leg swing horizontally.
    const offsets: [number, number][] = [
      [0, 0],
      [-2, 2],
      [0, 0],
      [2, -2],
    ];
    const [fwd, back] = offsets[pose.step % 4]!;
    const legs: [number, Color][] = [
      [10 + back, b2],
      [10 + fwd, b0],
    ];
    for (const [lx, col] of legs) {
      const short = kind === 'shorts' || kind === 'skirt';
      pc.rect(lx, top, 4, short ? 3 : legLen, col);
      if (short) pc.rect(lx + 1, top + 3, 2, legLen - 3, shade(skin, col === b2 ? -0.2 : 0));
      pc.rect(lx - 1, top + legLen, 5, 2, col === b2 ? shade(shoes, -0.25) : shoes);
      pc.hline(lx - 1, top + legLen + 2, 5, shade(shoes, -0.4));
    }
    if (kind === 'skirt') pc.rect(8, top, 8, skirtLen, skirt);
    return;
  }

  // Front/back: two legs, lifting alternately while walking.
  const liftL = pose.step === 1 ? 1 : 0;
  const liftR = pose.step === 3 ? 1 : 0;
  const leg = (x: number, lift: number, inner: number) => {
    const h = legLen - lift;
    if (kind === 'shorts') {
      pc.rect(x, top, 4, 3, b0);
      pc.rect(x + 1, top + 3, 2, h - 3, skin);
      pc.vline(x + 2, top + 3, h - 3, shade(skin, -0.12));
    } else if (kind === 'skirt') {
      pc.rect(x + 1, top + 3, 2, h - 3, skin);
    } else {
      pc.rect(x, top, 4, h, b0);
      pc.vline(inner, top + 2, h - 2, b1);
      if (kind === 'jeans') pc.px(x + (inner === x ? 3 : 0), top + h - 1, shade(b0, 0.15));
      if (kind === 'joggers') pc.hline(x, top + h - 1, 4, b1);
      if (kind === 'cargo') pc.rect(inner === x ? x : x + 3, top + 2, 1, 3, b2); // side pocket
    }
    const sy = top + h;
    pc.rect(x - 1, sy, 5, 2, shoes);
    pc.hline(x - 1, sy, 5, shade(shoes, 0.18));
    pc.hline(x - 1, sy + 2, 5, shade(shoes, -0.35));
    if (r.a.shoes === 'sneakers' || r.a.shoes === 'hightops') pc.hline(x - 1, sy + 1, 5, WHITE, 0.85);
    if (r.a.shoes === 'hightops') pc.rect(x, sy - 1, 4, 1, shoes);
  };
  leg(8, liftL, 11);
  leg(12, liftR, 12);
  if (kind !== 'shorts' && kind !== 'skirt') pc.hline(8, top, 8, b1);
  if (kind === 'skirt') {
    const s1 = shade(skirt, -0.18);
    pc.rect(7, top, 10, skirtLen, skirt);
    pc.hline(7, top + skirtLen - 1, 10, s1);
    if (r.a.bottom === 'pleated' && !dress) for (let i = 8; i < 17; i += 2) pc.vline(i, top + 1, skirtLen - 1, s1);
    else {
      pc.px(10, top + 1, s1);
      pc.px(13, top + 1, s1);
    }
  }
}

// ───────────────────────────────── torso

function drawTorso(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const t0 = r.top;
  const t1 = shade(t0, -0.16);
  const t2 = shade(t0, -0.3);
  const hi = shade(t0, 0.14);
  const y = 16 + dy;
  const side = pose.view === 'side';
  const x = side ? 9 : 7;
  const w = side ? 7 : 10;
  const h = 10;

  pc.round(x, y, w, h, t0);
  pc.vline(x + w - 1, y + 1, h - 2, t1); // right-side shading
  pc.vline(x + w - 2, y + 2, h - 4, t1, 0.5);
  pc.hline(x + 1, y + h - 1, w - 2, t2); // hem shadow
  pc.hline(x + 1, y, w - 3, hi);

  // A slightly narrower waist on women's characters (front and back).
  if (r.a.gender === 'female' && !side && r.a.top !== 'dress') {
    pc.clear(x, y + 5, 1, 3);
    pc.clear(x + w - 1, y + 5, 1, 3);
  }

  // Neck
  if (pose.view === 'front') {
    pc.rect(11, y - 1, 2, 2, shade(r.skin, -0.15));
  } else if (side) {
    pc.rect(11, y - 1, 2, 1, shade(r.skin, -0.15));
  }

  const kind = r.a.top;
  if (pose.view === 'front') {
    if (kind === 'hoodie') {
      pc.hline(8, y, 8, t1);
      pc.px(9, y + 1, t2);
      pc.px(14, y + 1, t2);
      pc.vline(10, y + 1, 3, WHITE, 0.8);
      pc.vline(13, y + 1, 3, WHITE, 0.8);
      pc.rect(9, y + 6, 6, 2, t1);
      pc.hline(9, y + 6, 6, t2);
    } else if (kind === 'shirt') {
      pc.px(10, y, WHITE);
      pc.px(13, y, WHITE);
      pc.px(11, y + 1, WHITE);
      pc.px(12, y + 1, WHITE);
      for (let i = 3; i < 9; i += 2) pc.px(12, y + i, t2);
      pc.px(9, y + 4, t1);
    } else if (kind === 'blazer') {
      pc.rect(10, y, 4, 7, '#efe6d4');
      pc.vline(11, y + 1, 5, shade('#efe6d4', -0.1));
      pc.vline(9, y + 1, 6, t2);
      pc.vline(14, y + 1, 6, t2);
      pc.px(10, y + 7, t1);
      pc.px(13, y + 7, t1);
      pc.px(15, y + 4, hi);
    } else if (kind === 'sweater') {
      for (let i = 0; i < w - 2; i += 2) pc.px(x + 1 + i, y + h - 1, t1);
      pc.hline(10, y, 4, t2);
      pc.px(9, y + 4, hi);
      pc.px(14, y + 6, hi);
    } else if (kind === 'vest') {
      pc.rect(10, y, 4, h - 1, '#ece5d6');
      pc.vline(12, y + 2, h - 3, shade('#ece5d6', -0.15));
      pc.px(11, y + 4, t2);
      pc.px(11, y + 6, t2);
    } else if (kind === 'polo') {
      // Collar points and a short placket
      pc.px(10, y, hi);
      pc.px(13, y, hi);
      pc.px(10, y + 1, t2);
      pc.px(13, y + 1, t2);
      pc.vline(12, y + 1, 3, t2);
      pc.px(12, y + 2, WHITE, 0.8);
    } else if (kind === 'suit') {
      // White shirt, tie and lapels
      pc.rect(10, y, 4, 6, WHITE);
      pc.rect(11, y + 1, 2, 5, '#c0233f');
      pc.px(11, y + 6, '#c0233f');
      pc.vline(9, y, 7, t2);
      pc.vline(14, y, 7, t2);
      pc.px(12, y + 8, hi);
    } else if (kind === 'blouse') {
      // Round collar and small buttons
      pc.hline(9, y, 6, WHITE);
      pc.px(9, y + 1, WHITE);
      pc.px(14, y + 1, WHITE);
      for (let i = 2; i < 8; i += 2) pc.px(12, y + i, shade(t0, 0.3));
    } else if (kind === 'cardigan') {
      // Open knit over a light tee
      pc.rect(11, y, 2, h - 1, '#f4efe6');
      pc.vline(10, y, h - 1, t2);
      pc.vline(13, y, h - 1, t2);
      for (let i = 2; i < 8; i += 2) pc.px(10, y + i, hi);
      for (let i = 0; i < w - 2; i += 2) pc.px(x + 1 + i, y + h - 1, t1);
    } else if (kind === 'camisole') {
      // Bare shoulders with thin straps
      pc.rect(x, y, w, 2, r.skin);
      pc.rect(x + 1, y + 2, w - 2, 1, shade(r.skin, -0.08));
      pc.vline(9, y, 3, t0);
      pc.vline(14, y, 3, t0);
      pc.hline(9, y + 3, 6, hi);
    } else if (kind === 'dress') {
      // Bodice with a waist seam; the skirt is drawn with the legs.
      pc.hline(10, y, 4, t2);
      pc.hline(x + 1, y + 6, w - 2, t2);
      pc.px(11, y + 2, hi);
    } else {
      // tee
      pc.hline(10, y, 4, t2);
      pc.px(11, y + 3, hi);
      pc.px(12, y + 3, hi);
    }
  } else if (pose.view === 'back') {
    if (kind === 'hoodie') {
      pc.round(9, y, 6, 3, t1);
      pc.hline(10, y + 2, 4, t2);
    } else if (kind === 'blazer') {
      pc.vline(12, y + 5, 4, t2);
    } else {
      pc.hline(9, y, 6, t1);
    }
  } else if (kind === 'hoodie') {
    pc.rect(13, y, 3, 3, t1);
  }
}

// ───────────────────────────────── arms

const SHORT_SLEEVES = new Set(['tee', 'vest', 'polo', 'dress']);
const SLEEVELESS = new Set(['camisole']);

function drawArms(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number, layer: 'behind' | 'front') {
  const sleeve = r.a.top === 'vest' ? '#ece5d6' : r.a.top === 'camisole' ? r.skin : r.top;
  const s1 = shade(sleeve, -0.18);
  const skin = r.skin;
  const sk1 = shade(skin, -0.14);
  const shortSleeve = SHORT_SLEEVES.has(r.a.top);
  const y = 17 + dy;

  /** Draws a vertical arm segment from (x, y0) of length len; sleeve covers the top part. */
  const sleeveless = SLEEVELESS.has(r.a.top);
  const arm = (x: number, y0: number, len: number, shadeSide: boolean) => {
    const sleeveLen = sleeveless ? 0 : shortSleeve ? 3 : len - 2;
    pc.rect(x, y0, 2, sleeveLen, shadeSide ? s1 : sleeve);
    pc.rect(x, y0 + sleeveLen, 2, len - sleeveLen, shadeSide ? sk1 : skin);
    if (!shortSleeve && !sleeveless) pc.hline(x, y0 + sleeveLen - 1, 2, shade(sleeve, -0.3));
  };
  const hand = (x: number, yy: number) => {
    pc.rect(x, yy, 2, 2, skin);
    pc.px(x + 1, yy + 1, sk1);
  };

  if (pose.view === 'side') {
    if (layer === 'behind') return;
    const swing = pose.arms === 'swingA' ? -2 : pose.arms === 'swingB' ? 2 : 0;
    if (pose.arms === 'type0' || pose.arms === 'type1') {
      pc.rect(11, y + 1, 2, 4, sleeve);
      pc.rect(8, y + 5 - (pose.arms === 'type1' ? 1 : 0), 4, 2, sleeve);
      hand(6, y + 5 - (pose.arms === 'type1' ? 1 : 0));
      return;
    }
    pc.rect(11 + Math.sign(swing), y + 1, 3, 4, sleeve);
    pc.vline(13 + Math.sign(swing), y + 1, 4, s1);
    if (shortSleeve) pc.rect(11 + swing, y + 4, 2, 4, skin);
    else pc.rect(11 + swing, y + 4, 2, 4, sleeve);
    hand(11 + swing, y + 8);
    return;
  }

  const back = pose.view === 'back';
  const L = 5;
  const R = 17;
  switch (pose.arms) {
    case 'down':
    case 'swingA':
    case 'swingB': {
      if (layer === 'front') return;
      const a = pose.arms === 'swingA' ? 1 : pose.arms === 'swingB' ? -1 : 0;
      arm(L, y + 1, 7, false);
      arm(R, y + 1, 7, true);
      hand(L, y + 7 + a);
      hand(R, y + 7 - a);
      if (back) {
        pc.rect(L, y + 7 + a, 2, 2, sk1);
        pc.rect(R, y + 7 - a, 2, 2, sk1);
      }
      return;
    }
    case 'type0':
    case 'type1': {
      if (layer === 'behind') {
        arm(L, y + 1, 5, false);
        arm(R, y + 1, 5, true);
        return;
      }
      if (back) {
        // Elbows out, forearms toward the keyboard (hidden by the torso).
        const k = pose.arms === 'type1' ? 1 : 0;
        pc.rect(L, y + 5, 3, 2, sleeve);
        pc.rect(R - 1, y + 5, 3, 2, s1);
        pc.px(L + 2, y + 7 - k, skin);
        pc.px(R - 1, y + 6 + k, skin);
        return;
      }
      const k0 = pose.arms === 'type0' ? 0 : 1;
      pc.rect(L + 1, y + 5, 3, 2, sleeve);
      pc.rect(R - 2, y + 5, 3, 2, s1);
      hand(8, y + 7 - k0);
      hand(14, y + 6 + k0);
      return;
    }
    case 'read': {
      if (layer === 'behind') {
        arm(L, y + 1, 5, false);
        arm(R, y + 1, 5, true);
        return;
      }
      if (!back) {
        hand(7, y + 7);
        hand(15, y + 7);
      } else {
        pc.rect(L, y + 5, 2, 2, sleeve);
        pc.rect(R, y + 5, 2, 2, s1);
      }
      return;
    }
    case 'chin': {
      if (layer === 'behind') {
        arm(L, y + 1, 7, false);
        hand(L, y + 7);
        arm(R, y + 1, 3, true);
        return;
      }
      if (back) {
        pc.rect(R - 1, y - 2, 2, 4, s1);
        pc.rect(R - 2, y - 4, 2, 2, skin);
        return;
      }
      pc.rect(R - 2, y + 2, 2, 3, s1);
      pc.rect(14, y - 1, 2, 3, sleeve);
      hand(13, y - 3);
      return;
    }
    case 'raise0':
    case 'raise1': {
      const wave = pose.arms === 'raise1' ? 1 : 0;
      if (layer === 'behind') {
        arm(L, y + 1, 7, false);
        hand(L, y + 7);
        return;
      }
      pc.rect(R, y - 6, 2, 8, back ? s1 : sleeve);
      if (shortSleeve) pc.rect(R, y - 6, 2, 5, skin);
      pc.rect(R + wave, y - 9, 2, 3, skin);
      pc.px(R + 1 + wave, y - 10, skin);
      return;
    }
    case 'cheer': {
      if (layer === 'behind') return;
      for (const [x, dir] of [
        [L, -1],
        [R, 1],
      ] as const) {
        pc.rect(x, y - 3, 2, 5, x === R ? s1 : sleeve);
        if (shortSleeve) pc.rect(x, y - 3, 2, 3, skin);
        pc.rect(x + dir, y - 6, 2, 3, skin);
      }
      return;
    }
    case 'slump': {
      if (layer === 'front') return;
      arm(L + 1, y + 2, 7, false);
      arm(R - 1, y + 2, 7, true);
      return;
    }
    case 'gesture': {
      if (layer === 'behind') {
        arm(L, y + 1, 7, false);
        hand(L, y + 7);
        return;
      }
      pc.rect(R, y + 1, 2, 4, s1);
      pc.rect(R + 1, y + 3, 3, 2, sleeve);
      hand(R + 3, y + 1);
      return;
    }
    case 'phone': {
      // Scrolling a phone held at the chest, screen lit toward the face.
      if (layer === 'behind') {
        arm(L, y + 1, 5, false);
        arm(R, y + 1, 5, true);
        return;
      }
      // Held up at chin height, so it shows above the desk.
      pc.rect(L + 1, y + 3, 3, 2, sleeve);
      pc.rect(R - 2, y + 3, 3, 2, s1);
      if (back) return;
      pc.rect(10, y - 3, 4, 6, '#23232b');
      pc.rect(11, y - 2, 2, 4, '#7fd1ff');
      hand(9, y + 1);
      hand(13, y + 1);
      return;
    }
    case 'stretch': {
      // Both arms thrown up and out in a V, clear of the head.
      if (layer === 'behind') return;
      for (const [x, out] of [
        [L, -1],
        [R, 1],
      ] as const) {
        const c = x === R ? s1 : sleeve;
        pc.rect(x, y - 2, 2, 4, c);
        pc.rect(x + out, y - 6, 2, 4, shortSleeve ? skin : c);
        pc.rect(x + out * 2, y - 10, 2, 4, skin);
        pc.rect(x + out * 2, y - 12, 2, 2, skin);
      }
      return;
    }
  }
}

// ───────────────────────────────── head & face

function headShape(pc: PixelCanvas, x0: number, y0: number, c: Color) {
  HEAD_ROWS.forEach((w, i) => pc.hline(x0 + (12 - w) / 2, y0 + i, w, c));
}

function drawHead(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const skin = r.skin;
  const sk1 = shade(skin, -0.12);
  const sk2 = shade(skin, -0.25);
  const hiSkin = shade(skin, 0.1);
  const slumpDrop = pose.arms === 'slump' ? 1 : 0;
  const y0 = HEAD_Y + dy + slumpDrop;
  const x0 = 6;

  headShape(pc, x0, y0, skin);
  // jaw shading on the right and under the chin
  pc.vline(x0 + 11, y0 + 3, 6, sk1);
  pc.hline(x0 + 3, y0 + 11, 6, sk1);
  pc.hline(x0 + 2, y0 + 2, 3, hiSkin);

  if (pose.view === 'front') {
    // ears
    pc.rect(x0 - 1, y0 + 6, 1, 2, sk1);
    pc.rect(x0 + 12, y0 + 6, 1, 2, sk2);
    drawFace(pc, r, pose, x0, y0);
  } else if (pose.view === 'side') {
    pc.px(x0 - 1, y0 + 7, skin); // nose
    pc.px(x0 - 1, y0 + 8, sk1);
    pc.rect(x0 + 6, y0 + 6, 2, 2, sk1); // ear
    pc.px(x0 + 7, y0 + 7, sk2);
    const eyeY = y0 + 6 + (pose.eyes === 'down' ? 1 : pose.eyes === 'up' ? -1 : 0);
    if (pose.eyes === 'blink' || pose.eyes === 'closed' || pose.eyes === 'happy') pc.hline(x0 + 1, eyeY + 1, 2, INK);
    else {
      pc.rect(x0 + 1, eyeY, 2, 2, INK);
      pc.px(x0 + 1, eyeY, WHITE);
    }
    if (r.a.gender === 'female') pc.px(x0 + 3, eyeY - 1, INK);
    pc.px(x0 + 3, y0 + 9, BLUSH, 0.55);
    pc.px(x0 + 1, y0 + 10, shade(skin, -0.35));
  }
}

function drawFace(pc: PixelCanvas, r: Resolved, pose: Pose, x0: number, y0: number) {
  const face = r.a.face;
  const eyeShift = pose.eyes === 'down' ? 1 : pose.eyes === 'up' ? -1 : 0;
  const ey = y0 + 6 + eyeShift;
  const lx = x0 + 2;
  const rx = x0 + 8;
  const eyes = pose.eyes === 'open' && face === 'calm' ? 'calm' : pose.eyes;
  for (const ex of [lx, rx]) {
    switch (eyes) {
      case 'blink':
      case 'closed':
        pc.hline(ex, ey + 1, 2, INK);
        break;
      case 'happy':
        pc.px(ex, ey + 1, INK);
        pc.px(ex + 1, ey, INK);
        break;
      case 'calm':
        pc.hline(ex, ey + 1, 2, INK);
        pc.px(ex, ey, INK, 0.5);
        break;
      default:
        pc.rect(ex, ey, 2, 2, INK);
        pc.px(ex, ey, WHITE);
    }
  }
  if (pose.eyes === 'focused' || face === 'focused') {
    pc.hline(lx, ey - 2, 2, shade(r.hair, -0.1));
    pc.hline(rx, ey - 2, 2, shade(r.hair, -0.1));
  } else if (r.a.gender === 'male') {
    // Heavier brows
    pc.hline(lx, ey - 2, 2, shade(r.hair, -0.25), 0.85);
    pc.hline(rx, ey - 2, 2, shade(r.hair, -0.25), 0.85);
  }
  if (r.a.gender === 'female') {
    // Lashes at the outer corners
    pc.px(lx - 1, ey, INK);
    pc.px(rx + 2, ey, INK);
  }
  // blush
  pc.px(x0 + 1, y0 + 8, BLUSH, face === 'cheerful' ? 0.8 : 0.45);
  pc.px(x0 + 10, y0 + 8, BLUSH, face === 'cheerful' ? 0.8 : 0.45);
  // mouth
  const mouth = pose.mouth ?? (face === 'focused' ? 'flat' : 'smile');
  const my = y0 + 9;
  // Women's characters get a hint of lip colour.
  const mc = r.a.gender === 'female' ? mix(shade(r.skin, -0.35), '#c4566a', 0.8) : shade(r.skin, -0.45);
  if (mouth === 'open') {
    pc.rect(x0 + 5, my, 2, 2, '#7a2f3a');
    pc.px(x0 + 5, my, WHITE);
  } else if (mouth === 'o') {
    pc.px(x0 + 5, my, mc);
  } else if (mouth === 'flat') {
    pc.hline(x0 + 5, my, 2, mc);
  } else {
    pc.px(x0 + 4, my, mc);
    pc.hline(x0 + 5, my + 1, 2, mc);
    pc.px(x0 + 7, my, mc);
  }
}

// ───────────────────────────────── hair

function drawLongHairBehind(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const style = r.a.hairStyle;
  if (style !== 'long' && style !== 'curly') return;
  const h1 = shade(r.hair, -0.2);
  const y = HEAD_Y + dy + 5;
  const len = style === 'long' ? 13 : 7;
  if (pose.view === 'back') {
    pc.round(5, y, 14, len, r.hair);
    pc.vline(12, y + 2, len - 3, h1);
    pc.hline(6, y + len - 1, 12, h1);
  } else {
    pc.rect(5, y, 3, len, h1);
    pc.rect(16, y, 3, len, shade(r.hair, -0.28));
  }
}

function drawHair(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const style = r.a.hairStyle;
  const c = r.hair;
  const c1 = shade(c, -0.18);
  const c2 = shade(c, -0.32);
  const hi = shade(c, 0.22);
  const slumpDrop = pose.arms === 'slump' ? 1 : 0;
  const y0 = HEAD_Y + dy + slumpDrop;
  const x0 = 6;

  if (pose.view === 'back') {
    // Hair covers the whole back of the head.
    if (style === 'buzz') {
      headShape(pc, x0, y0, c1);
      pc.hline(x0 + 3, y0 + 10, 6, shade(r.skin, -0.1));
      pc.hline(x0 + 2, y0 + 11, 8, r.skin);
    } else if (style === 'undercut') {
      // Longer on top, clipped short at the back and sides
      headShape(pc, x0, y0, shade(c1, 0.05));
      pc.rect(x0 + 1, y0, 10, 5, c);
      pc.hline(x0 + 3, y0, 4, hi);
      pc.hline(x0 + 2, y0 + 11, 8, shade(r.skin, -0.05));
    } else if (style === 'mohawk') {
      headShape(pc, x0, y0, shade(r.skin, -0.08));
      pc.rect(x0 + 4, y0 - 3, 4, 13, c);
      pc.vline(x0 + 7, y0 - 3, 13, c1);
    } else {
      headShape(pc, x0, y0, c);
      pc.rect(x0, y0 + 9, 12, style === 'bob' ? 4 : 2, c);
      pc.vline(x0 + 6, y0 + 2, 9, c1);
      pc.vline(x0 + 10, y0 + 3, 8, c2);
      pc.hline(x0 + 3, y0 + 1, 4, hi);
      if (style === 'curly') {
        for (let i = 0; i < 12; i += 3) pc.px(x0 + i, y0 + 11, c1);
        pc.rect(x0 - 1, y0 + 1, 14, 8, c);
        pc.hline(x0 + 1, y0, 10, c);
        for (let i = 1; i < 12; i += 3) pc.px(x0 + i, y0 + 4, c1);
      }
    }
    if (style === 'bun') {
      pc.round(x0 + 3, y0 - 4, 6, 5, c);
      pc.hline(x0 + 4, y0 - 4, 3, hi);
      pc.hline(x0 + 4, y0 + 1, 4, c2);
    }
    if (style === 'ponytail') {
      pc.rect(x0 + 5, y0 + 9, 3, 1, c2);
      pc.rect(x0 + 5, y0 + 10, 3, 7, c);
      pc.vline(x0 + 7, y0 + 10, 7, c1);
      pc.px(x0 + 6, y0 + 17, c1);
    }
    if (style === 'twintails') {
      for (const tx of [x0 - 2, x0 + 12]) {
        pc.rect(tx, y0 + 3, 2, 9, tx < x0 ? c : c1);
        pc.px(tx, y0 + 3, '#ff5f8f');
      }
    }
    return;
  }

  if (pose.view === 'side') {
    // Facing left: hair covers top and back (right side) of the head.
    switch (style) {
      case 'buzz':
        pc.hline(x0 + 2, y0, 8, c1);
        pc.rect(x0 + 1, y0 + 1, 11, 2, c1);
        pc.rect(x0 + 9, y0 + 3, 3, 4, c1);
        break;
      case 'mohawk':
        pc.rect(x0 + 2, y0 - 3, 9, 3, c);
        pc.hline(x0 + 2, y0 - 3, 6, hi);
        break;
      case 'undercut':
        pc.hline(x0 + 2, y0 - 2, 8, c);
        pc.rect(x0, y0 - 1, 11, 3, c);
        pc.hline(x0 + 2, y0 - 2, 5, hi);
        pc.rect(x0 + 9, y0 + 2, 3, 3, c2);
        break;
      default: {
        pc.hline(x0 + 2, y0 - 1, 8, c);
        pc.rect(x0 + 1, y0, 11, 4, c);
        pc.rect(x0 + 7, y0 + 4, 5, style === 'bob' || style === 'long' ? 8 : 5, c);
        pc.rect(x0, y0 + 2, 3, 3, c);
        pc.hline(x0 + 2, y0, 5, hi);
        pc.vline(x0 + 11, y0 + 2, 6, c2);
        pc.px(x0 + 7, y0 + 5, c1);
        if (style === 'long') pc.rect(x0 + 8, y0 + 11, 4, 8, c);
        if (style === 'curly') {
          pc.rect(x0 - 1, y0 - 1, 14, 6, c);
          pc.rect(x0 + 6, y0 + 4, 7, 8, c);
          for (let i = 0; i < 12; i += 3) pc.px(x0 + i, y0 + 1, c1);
        }
        if (style === 'bun') {
          pc.round(x0 + 9, y0 - 3, 5, 5, c);
          pc.px(x0 + 10, y0 - 2, hi);
        }
        if (style === 'ponytail') {
          pc.rect(x0 + 12, y0 + 3, 2, 2, c2);
          pc.rect(x0 + 13, y0 + 4, 3, 7, c);
          pc.vline(x0 + 15, y0 + 5, 6, c1);
        }
        if (style === 'twintails') {
          pc.px(x0 + 12, y0 + 3, '#ff5f8f');
          pc.rect(x0 + 12, y0 + 4, 2, 9, c);
          pc.vline(x0 + 13, y0 + 5, 7, c1);
        }
      }
    }
    return;
  }

  // Front view
  switch (style) {
    case 'buzz':
      pc.hline(x0 + 2, y0, 8, c1);
      pc.rect(x0 + 1, y0 + 1, 10, 2, c1);
      pc.px(x0, y0 + 3, c1);
      pc.px(x0 + 11, y0 + 3, c1);
      pc.hline(x0 + 3, y0 + 1, 3, c);
      break;
    case 'mohawk':
      pc.rect(x0 + 4, y0 - 3, 4, 5, c);
      pc.vline(x0 + 7, y0 - 3, 5, c1);
      pc.hline(x0 + 4, y0 - 3, 2, hi);
      pc.px(x0, y0 + 4, shade(r.skin, -0.2));
      pc.px(x0 + 11, y0 + 4, shade(r.skin, -0.2));
      break;
    case 'undercut':
      // Swept-back top, short sides
      pc.hline(x0 + 2, y0 - 2, 8, c);
      pc.rect(x0 + 1, y0 - 1, 10, 3, c);
      pc.hline(x0 + 3, y0 - 2, 4, hi);
      pc.rect(x0 + 1, y0 + 2, 5, 1, c1);
      pc.rect(x0, y0 + 1, 1, 4, c2);
      pc.rect(x0 + 11, y0 + 1, 1, 4, c2);
      break;
    case 'curly': {
      pc.rect(x0 - 1, y0 - 1, 14, 5, c);
      pc.hline(x0 + 1, y0 - 2, 10, c);
      pc.rect(x0 - 2, y0 + 2, 3, 7, c);
      pc.rect(x0 + 11, y0 + 2, 3, 7, c1);
      for (const [px, py] of [
        [1, 3],
        [4, 4],
        [7, 3],
        [10, 4],
        [2, 0],
        [6, -1],
        [9, 0],
      ] as const)
        pc.px(x0 + px, y0 + py, c1);
      pc.hline(x0 + 2, y0 - 1, 3, hi);
      pc.px(x0 + 8, y0, hi);
      break;
    }
    default: {
      // short / bob / long / bun / ponytail share a fringe
      pc.hline(x0 + 2, y0 - 1, 8, c);
      pc.rect(x0, y0, 12, 3, c);
      // side-swept fringe
      pc.rect(x0, y0 + 3, 7, 1, c);
      pc.rect(x0, y0 + 4, 3, 1, c);
      pc.px(x0 + 9, y0 + 3, c);
      pc.rect(x0 + 10, y0 + 3, 2, 2, c1);
      pc.hline(x0 + 3, y0, 4, hi);
      pc.px(x0 + 8, y0 + 1, hi);
      pc.hline(x0 + 3, y0 + 3, 3, c1);
      if (style === 'short' || style === 'ponytail' || style === 'bun') {
        pc.rect(x0 - 1, y0 + 2, 1, 4, c1);
        pc.rect(x0 + 12, y0 + 2, 1, 4, c2);
      }
      if (style === 'bob') {
        pc.rect(x0 - 1, y0 + 2, 2, 9, c);
        pc.rect(x0 + 11, y0 + 2, 2, 9, c1);
        pc.hline(x0 - 1, y0 + 10, 2, c1);
      }
      if (style === 'long') {
        pc.rect(x0 - 1, y0 + 2, 2, 12, c);
        pc.rect(x0 + 11, y0 + 2, 2, 12, c1);
      }
      if (style === 'bun') {
        pc.round(x0 + 3, y0 - 5, 6, 5, c);
        pc.hline(x0 + 4, y0 - 5, 3, hi);
        pc.hline(x0 + 4, y0 - 1, 4, c2);
      }
      if (style === 'ponytail') {
        pc.rect(x0 + 12, y0 + 4, 2, 6, c1);
      }
      if (style === 'twintails') {
        for (const tx of [x0 - 2, x0 + 12]) {
          pc.px(tx + (tx < x0 ? 1 : 0), y0 + 3, '#ff5f8f');
          pc.rect(tx, y0 + 4, 2, 9, tx < x0 ? c : c1);
          pc.px(tx + (tx < x0 ? 1 : 0), y0 + 13, tx < x0 ? c1 : c2);
        }
      }
    }
  }
}

// ───────────────────────────────── accessories & props

function drawAccessory(pc: PixelCanvas, r: Resolved, pose: Pose, dy: number) {
  const slumpDrop = pose.arms === 'slump' ? 1 : 0;
  const y0 = HEAD_Y + dy + slumpDrop;
  const x0 = 6;
  const acc = r.a.accessory;
  const accent = r.top === OUTFIT.charcoal ? OUTFIT.coral : r.top;
  switch (acc) {
    case 'glasses': {
      if (pose.view === 'back') return;
      const frame = '#2c2836';
      const ey = y0 + 5 + (pose.eyes === 'down' ? 1 : 0);
      if (pose.view === 'side') {
        pc.rect(x0, ey, 4, 1, frame);
        pc.rect(x0, ey + 3, 4, 1, frame);
        pc.vline(x0 + 3, ey, 4, frame);
        pc.hline(x0 + 4, ey + 1, 4, frame);
        return;
      }
      for (const ex of [x0 + 1, x0 + 7]) {
        pc.hline(ex, ey, 4, frame);
        pc.hline(ex, ey + 3, 4, frame);
        pc.vline(ex, ey, 4, frame);
        pc.vline(ex + 3, ey, 4, frame);
        pc.px(ex + 2, ey + 1, WHITE, 0.6);
      }
      pc.hline(x0 + 5, ey + 1, 2, frame);
      return;
    }
    case 'headphones': {
      const band = '#2b2a33';
      if (pose.view === 'side') {
        pc.hline(x0 + 3, y0 - 2, 6, band);
        pc.vline(x0 + 9, y0 - 1, 5, band);
        pc.round(x0 + 6, y0 + 4, 4, 5, band);
        pc.rect(x0 + 7, y0 + 5, 2, 3, accent);
        return;
      }
      pc.hline(x0 + 1, y0 - 2, 10, band);
      pc.px(x0, y0 - 1, band);
      pc.px(x0 + 11, y0 - 1, band);
      pc.vline(x0 - 1, y0, 4, band);
      pc.vline(x0 + 12, y0, 4, band);
      pc.round(x0 - 2, y0 + 4, 3, 5, band);
      pc.round(x0 + 11, y0 + 4, 3, 5, band);
      pc.vline(x0 - 1, y0 + 5, 3, accent);
      pc.vline(x0 + 12, y0 + 5, 3, accent);
      return;
    }
    case 'cap':
    case 'beanie': {
      const col = acc === 'cap' ? accent : shade(accent, -0.05);
      const c1 = shade(col, -0.2);
      pc.hline(x0 + 2, y0 - 2, 8, col);
      pc.rect(x0, y0 - 1, 12, 3, col);
      pc.hline(x0 + 3, y0 - 2, 3, shade(col, 0.2));
      if (acc === 'beanie') {
        pc.rect(x0, y0 + 1, 12, 2, c1);
        for (let i = 0; i < 12; i += 2) pc.px(x0 + i, y0 + 1, shade(col, -0.32));
        pc.round(x0 + 4, y0 - 5, 4, 3, WHITE);
      } else if (pose.view === 'front') {
        pc.rect(x0 - 1, y0 + 2, 10, 1, c1);
        pc.px(x0 + 5, y0 - 1, WHITE);
      } else if (pose.view === 'side') {
        pc.rect(x0 - 3, y0 + 2, 6, 1, c1);
      } else {
        pc.px(x0 + 5, y0 + 2, c1);
        pc.px(x0 + 6, y0 + 2, c1);
      }
      return;
    }
    case 'scarf': {
      const col = r.a.topColor === 'coral' ? OUTFIT.mustard : OUTFIT.coral;
      const y = 15 + dy;
      if (pose.view === 'side') {
        pc.rect(10, y, 6, 2, col);
        pc.rect(14, y + 2, 2, 4, shade(col, -0.15));
        return;
      }
      pc.rect(8, y, 8, 2, col);
      pc.hline(8, y + 1, 8, shade(col, -0.2));
      if (pose.view === 'front') {
        pc.rect(13, y + 2, 2, 5, col);
        pc.px(13, y + 7, shade(col, -0.2));
        pc.px(14, y + 7, shade(col, -0.2));
      }
      return;
    }
    case 'flower': {
      // A blossom tucked over the left ear.
      const petal = '#ff8fb8';
      const fx = pose.view === 'side' ? x0 + 8 : pose.view === 'back' ? x0 + 9 : x0;
      const fy = y0 + 1;
      for (const [dx, dy2] of [
        [1, 0],
        [0, 1],
        [2, 1],
        [1, 2],
      ] as const)
        pc.px(fx + dx, fy + dy2, petal);
      pc.px(fx + 1, fy + 1, '#ffd166');
      pc.px(fx + 2, fy + 3, '#5c9e5a');
      return;
    }
    case 'cat_ears': {
      const fur = shade(r.hair, 0.05);
      const inner = '#f2a3b5';
      const ears = pose.view === 'side' ? [x0 + 5] : [x0 + 1, x0 + 8];
      for (const ex of ears) {
        pc.px(ex + 1, y0 - 4, fur);
        pc.hline(ex, y0 - 3, 3, fur);
        pc.hline(ex, y0 - 2, 3, fur);
        if (pose.view !== 'back') pc.px(ex + 1, y0 - 2, inner);
      }
      return;
    }
    case 'wizard_hat': {
      const hat = '#4b3b9a';
      const band = '#ffd166';
      pc.rect(x0 - 1, y0, 14, 2, hat);
      pc.hline(x0 - 2, y0 + 1, 16, shade(hat, -0.2));
      pc.rect(x0 + 2, y0 - 3, 8, 3, hat);
      pc.rect(x0 + 3, y0 - 6, 6, 3, hat);
      pc.rect(x0 + 4, y0 - 8, 4, 2, hat);
      pc.px(x0 + 6, y0 - 9, hat);
      pc.px(x0 + 7, y0 - 10, shade(hat, 0.15));
      pc.hline(x0 + 2, y0 - 1, 8, band);
      if (pose.view !== 'back') {
        pc.px(x0 + 4, y0 - 5, band);
        pc.px(x0 + 7, y0 - 7, WHITE);
      }
      return;
    }
    case 'crown': {
      const gold = '#f2c230';
      const dark = '#b58410';
      pc.rect(x0 + 1, y0 - 2, 10, 2, gold);
      pc.hline(x0 + 1, y0 - 1, 10, dark);
      for (const cx of [x0 + 1, x0 + 5, x0 + 10]) pc.vline(cx, y0 - 4, 2, gold);
      pc.px(x0 + 6, y0 - 4, gold);
      pc.px(x0 + 3, y0 - 3, gold);
      pc.px(x0 + 8, y0 - 3, gold);
      if (pose.view !== 'back') {
        pc.px(x0 + 5, y0 - 2, '#e5625c');
        pc.px(x0 + 2, y0 - 2, '#5cc7e8');
        pc.px(x0 + 9, y0 - 2, '#5cc77a');
      }
      return;
    }
    case 'bow': {
      const c = '#ff5f8f';
      const bx = pose.view === 'side' ? x0 + 5 : x0 + 7;
      pc.rect(bx, y0 - 2, 2, 3, c);
      pc.rect(bx + 4, y0 - 2, 2, 3, c);
      pc.rect(bx + 2, y0 - 1, 2, 2, shade(c, -0.25));
      return;
    }
    case 'sunglasses': {
      if (pose.view === 'back') return;
      const lens = '#1b1a22';
      const ey = y0 + 5;
      if (pose.view === 'side') {
        pc.rect(x0, ey, 3, 3, lens);
        pc.hline(x0 + 3, ey + 1, 5, lens);
        return;
      }
      for (const ex of [x0 + 1, x0 + 7]) {
        pc.rect(ex, ey, 4, 3, lens);
        pc.px(ex + 1, ey, '#7fd1ff');
      }
      pc.hline(x0 + 5, ey + 1, 2, lens);
      return;
    }
    case 'party_hat': {
      for (let i = 0; i < 8; i++) {
        const w = 1 + Math.floor(i / 2) * 2;
        pc.hline(x0 + 6 - Math.floor(w / 2), y0 - 8 + i, w, i % 3 === 0 ? '#ffd166' : '#5cc7e8');
      }
      pc.round(x0 + 5, y0 - 10, 3, 3, '#ff5f8f');
      return;
    }
    case 'bunny_ears': {
      const fur = '#f4f1ea';
      for (const ex of pose.view === 'side' ? [x0 + 5] : [x0 + 2, x0 + 7]) {
        pc.round(ex, y0 - 8, 3, 8, fur);
        if (pose.view !== 'back') pc.vline(ex + 1, y0 - 7, 5, '#f2a3b5');
      }
      return;
    }
    case 'chef_hat': {
      pc.rect(x0 + 1, y0 - 2, 10, 3, WHITE);
      pc.hline(x0 + 1, y0, 10, shade(WHITE, -0.12));
      pc.round(x0, y0 - 8, 12, 7, WHITE);
      pc.vline(x0 + 4, y0 - 6, 3, shade(WHITE, -0.1));
      pc.vline(x0 + 8, y0 - 6, 3, shade(WHITE, -0.1));
      return;
    }
    case 'santa_hat': {
      const red = '#d33a3a';
      pc.rect(x0 + 1, y0 - 4, 10, 3, red);
      pc.rect(x0 + 3, y0 - 6, 7, 2, red);
      pc.rect(x0 + 7, y0 - 7, 4, 1, red);
      pc.rect(x0, y0 - 1, 12, 2, WHITE);
      pc.round(x0 + 10, y0 - 8, 3, 3, WHITE);
      return;
    }
    case 'antenna': {
      const stalk = '#3a3a44';
      pc.hline(x0 + 1, y0 - 1, 10, stalk);
      for (const ex of [x0 + 3, x0 + 8]) {
        pc.vline(ex, y0 - 5, 4, stalk);
        pc.round(ex - 1, y0 - 8, 3, 3, '#7dff9a');
      }
      return;
    }
    case 'devil_horns': {
      const red = '#d33a3a';
      pc.rect(x0 + 1, y0 - 2, 2, 2, red);
      pc.px(x0, y0 - 3, red);
      pc.rect(x0 + 9, y0 - 2, 2, 2, red);
      pc.px(x0 + 11, y0 - 3, red);
      return;
    }
    case 'top_hat': {
      const felt = '#1c1b22';
      pc.rect(x0 - 1, y0, 14, 2, felt);
      pc.rect(x0 + 2, y0 - 8, 8, 8, felt);
      pc.rect(x0 + 2, y0 - 2, 8, 2, '#c0233f');
      pc.vline(x0 + 3, y0 - 7, 5, '#3a3944');
      return;
    }
    case 'viking': {
      const steel = '#9aa3b5';
      const horn = '#f4efe6';
      pc.round(x0, y0 - 3, 12, 5, steel);
      pc.hline(x0, y0 + 1, 12, shade(steel, -0.25));
      for (const rx of [x0 + 2, x0 + 6, x0 + 10]) pc.px(rx, y0 + 1, WHITE);
      pc.rect(x0 - 2, y0 - 2, 2, 2, horn);
      pc.rect(x0 - 3, y0 - 5, 2, 3, horn);
      pc.rect(x0 + 12, y0 - 2, 2, 2, horn);
      pc.rect(x0 + 13, y0 - 5, 2, 3, horn);
      return;
    }
    case 'halo': {
      const gold = '#ffe066';
      pc.hline(x0 + 2, y0 - 5, 8, gold);
      pc.hline(x0 + 2, y0 - 3, 8, gold);
      pc.px(x0 + 1, y0 - 4, gold);
      pc.px(x0 + 10, y0 - 4, gold);
      return;
    }
    case 'lanyard': {
      if (pose.view !== 'front') return;
      const y = 16 + dy;
      const strap = '#3d6fb5';
      pc.px(9, y, strap);
      pc.px(10, y + 1, strap);
      pc.px(14, y, strap);
      pc.px(13, y + 1, strap);
      pc.vline(11, y + 2, 2, strap);
      pc.rect(10, y + 4, 4, 3, WHITE);
      pc.hline(11, y + 5, 2, '#3d6fb5');
      return;
    }
  }
}

function drawExtras(pc: PixelCanvas, pose: Pose, dy: number) {
  for (const extra of pose.extras ?? []) {
    if (extra === 'paper' && pose.view === 'front') {
      const y = 22 + dy;
      pc.rect(8, y, 8, 6, WHITE);
      pc.hline(9, y + 1, 5, '#9aa3b5');
      pc.hline(9, y + 3, 6, '#9aa3b5');
      pc.hline(9, y + 5, 4, '#9aa3b5');
      pc.px(7, y + 2, shade('#efc39f', 0));
    }
    if (extra === 'notebook' && pose.view === 'front') {
      const y = 23 + dy;
      pc.rect(8, y, 8, 5, '#3d5a80');
      pc.rect(9, y + 1, 6, 3, WHITE);
      pc.hline(10, y + 2, 4, '#9aa3b5');
    }
    if (extra === 'zzz' || extra === 'zzz2') {
      // Little z's drifting up from a napping head.
      const up = extra === 'zzz2' ? 2 : 0;
      const z = (x: number, y: number, n: number) => {
        pc.hline(x, y, n, WHITE);
        for (let i = 1; i < n - 1; i++) pc.px(x + n - 1 - i, y + i, WHITE);
        pc.hline(x, y + n - 1, n, WHITE);
      };
      z(18, 6 + dy - up, 3);
      z(20, 1 + dy - up, 4);
    }
    if (extra === 'sweat') {
      pc.px(19, 7 + dy, '#8fd3ff');
      pc.rect(19, 8 + dy, 2, 2, '#8fd3ff');
      pc.px(19, 8 + dy, WHITE);
    }
  }
}

// ───────────────────────────────── animation sheet

export type AnimName =
  | 'idle_front'
  | 'idle_back'
  | 'idle_side'
  | 'walk_front'
  | 'walk_back'
  | 'walk_side'
  | 'sit_front_idle'
  | 'sit_front_type'
  | 'sit_front_read'
  | 'sit_front_think'
  | 'sit_front_plan'
  | 'sit_front_debug'
  | 'sit_front_raise'
  | 'sit_front_cheer'
  | 'sit_front_slump'
  | 'sit_front_nap'
  | 'sit_front_phone'
  | 'sit_front_stretch'
  | 'sit_back_idle'
  | 'sit_back_type'
  | 'sit_back_read'
  | 'sit_back_think'
  | 'sit_back_plan'
  | 'sit_back_debug'
  | 'sit_back_raise'
  | 'sit_back_cheer'
  | 'sit_back_slump'
  | 'sit_back_nap'
  | 'sit_back_phone'
  | 'sit_back_stretch'
  | 'stand_cheer'
  | 'stand_raise'
  | 'stand_talk_side'
  | 'stand_talk_front'
  | 'stand_talk_back'
  | 'stand_play_back';

export interface AnimDef {
  frames: Pose[];
  /** Milliseconds per frame. */
  frameMs: number;
}

const P = (view: View, sit: boolean, over: Partial<Pose> = {}): Pose => ({ view, sit, step: 0, bob: 0, arms: 'down', eyes: 'open', ...over });

function sitSet(view: 'front' | 'back'): Record<string, AnimDef> {
  const v = view;
  return {
    idle: { frameMs: 900, frames: [P(v, true), P(v, true, { bob: 1 }), P(v, true), P(v, true, { eyes: 'blink' })] },
    type: { frameMs: 140, frames: [P(v, true, { arms: 'type0', eyes: 'down' }), P(v, true, { arms: 'type1', eyes: 'down' })] },
    read: {
      frameMs: 700,
      frames: [
        P(v, true, { arms: 'read', eyes: 'down', extras: ['paper'], mouth: 'flat' }),
        P(v, true, { arms: 'read', eyes: 'down', extras: ['paper'], mouth: 'flat', bob: 1 }),
      ],
    },
    think: { frameMs: 800, frames: [P(v, true, { arms: 'chin', eyes: 'up', mouth: 'flat' }), P(v, true, { arms: 'chin', eyes: 'up', mouth: 'o' })] },
    plan: {
      frameMs: 500,
      frames: [
        P(v, true, { arms: 'read', eyes: 'down', extras: ['notebook'] }),
        P(v, true, { arms: 'read', eyes: 'down', extras: ['notebook'], bob: 1 }),
      ],
    },
    debug: {
      frameMs: 110,
      frames: [
        P(v, true, { arms: 'type0', eyes: 'focused', mouth: 'flat', bob: -1 }),
        P(v, true, { arms: 'type1', eyes: 'focused', mouth: 'flat', bob: -1 }),
      ],
    },
    raise: { frameMs: 260, frames: [P(v, true, { arms: 'raise0', mouth: 'open' }), P(v, true, { arms: 'raise1', mouth: 'open' })] },
    cheer: {
      frameMs: 220,
      frames: [P(v, true, { arms: 'cheer', eyes: 'happy', mouth: 'open', bob: -2 }), P(v, true, { arms: 'cheer', eyes: 'happy', mouth: 'open' })],
    },
    // Slacking off after a while with nothing to do.
    nap: {
      frameMs: 1000,
      frames: [
        P(v, true, { arms: 'slump', eyes: 'closed', mouth: 'flat', extras: ['zzz'] }),
        P(v, true, { arms: 'slump', eyes: 'closed', mouth: 'o', bob: 1, extras: ['zzz2'] }),
      ],
    },
    phone: {
      frameMs: 750,
      frames: [
        P(v, true, { arms: 'phone', eyes: 'down', mouth: 'smile' }),
        P(v, true, { arms: 'phone', eyes: 'down', mouth: 'smile', bob: 1 }),
        P(v, true, { arms: 'phone', eyes: 'down', mouth: 'open' }),
        P(v, true, { arms: 'phone', eyes: 'blink', mouth: 'smile' }),
      ],
    },
    stretch: {
      frameMs: 600,
      frames: [P(v, true, { arms: 'stretch', eyes: 'closed', mouth: 'o', bob: -1 }), P(v, true, { arms: 'stretch', eyes: 'closed', mouth: 'o', bob: -2 })],
    },
    slump: {
      frameMs: 1100,
      frames: [
        P(v, true, { arms: 'slump', eyes: 'closed', mouth: 'flat', extras: ['sweat'] }),
        P(v, true, { arms: 'slump', eyes: 'closed', mouth: 'flat', bob: 1, extras: ['sweat'] }),
      ],
    },
  };
}

function buildAnimDefs(): Record<AnimName, AnimDef> {
  const walk = (view: View): AnimDef => ({
    frameMs: 130,
    frames: [0, 1, 2, 3].map((step) =>
      P(view, false, { step, bob: step % 2 === 1 ? -1 : 0, arms: step === 1 ? 'swingA' : step === 3 ? 'swingB' : 'down' }),
    ),
  });
  const idle = (view: View): AnimDef => ({ frameMs: 650, frames: [P(view, false), P(view, false, { bob: 1 }), P(view, false), P(view, false, { eyes: 'blink' })] });
  const front = sitSet('front');
  const back = sitSet('back');
  const defs: Partial<Record<AnimName, AnimDef>> = {
    idle_front: idle('front'),
    idle_back: idle('back'),
    idle_side: idle('side'),
    walk_front: walk('front'),
    walk_back: walk('back'),
    walk_side: walk('side'),
    stand_cheer: { frameMs: 220, frames: [P('front', false, { arms: 'cheer', eyes: 'happy', mouth: 'open', bob: -2 }), P('front', false, { arms: 'cheer', eyes: 'happy', mouth: 'open' })] },
    stand_raise: { frameMs: 260, frames: [P('front', false, { arms: 'raise0', mouth: 'open' }), P('front', false, { arms: 'raise1', mouth: 'open' })] },
    stand_talk_side: { frameMs: 420, frames: [P('side', false, { mouth: 'open' }), P('side', false, { mouth: 'smile', bob: 1 })] },
    stand_talk_front: { frameMs: 420, frames: [P('front', false, { arms: 'gesture', mouth: 'open' }), P('front', false, { mouth: 'smile', bob: 1 })] },
    stand_talk_back: { frameMs: 420, frames: [P('back', false, { arms: 'gesture' }), P('back', false, { bob: 1 })] },
    stand_play_back: { frameMs: 120, frames: [P('back', false, { arms: 'type0' }), P('back', false, { arms: 'type1', bob: -1 }), P('back', false, { arms: 'type1' }), P('back', false, { arms: 'type0', bob: -1 })] },
  };
  for (const [k, v] of Object.entries(front)) defs[`sit_front_${k}` as AnimName] = v;
  for (const [k, v] of Object.entries(back)) defs[`sit_back_${k}` as AnimName] = v;
  return defs as Record<AnimName, AnimDef>;
}

export const ANIMS = buildAnimDefs();

export interface CharacterSheet {
  /** Frames per animation; side animations face left, use `flipped` for right. */
  frames: Record<AnimName, HTMLCanvasElement[]>;
  flipped: Partial<Record<AnimName, HTMLCanvasElement[]>>;
  portrait: HTMLCanvasElement;
}

/** Builds every frame for one appearance. ~70 tiny canvases; cached per appearance key. */
export function buildCharacterSheet(appearance: CharacterAppearance): CharacterSheet {
  const r = resolve(appearance);
  const frames = {} as Record<AnimName, HTMLCanvasElement[]>;
  const flipped: Partial<Record<AnimName, HTMLCanvasElement[]>> = {};
  for (const [name, def] of Object.entries(ANIMS) as [AnimName, AnimDef][]) {
    const pcs = def.frames.map((pose) => drawCharacter(r, pose));
    frames[name] = pcs.map((p) => p.canvas);
    if (def.frames[0]?.view === 'side') flipped[name] = pcs.map((p) => p.flipped().canvas);
  }
  return { frames, flipped, portrait: drawPortrait(r) };
}

/** 24×24 bust used in the inspector and roster. */
function drawPortrait(r: Resolved): HTMLCanvasElement {
  const full = drawCharacter(r, P('front', false));
  const pc = new PixelCanvas(24, 24);
  pc.ctx.drawImage(full.canvas, 0, -1);
  return pc.canvas;
}

export function appearanceKey(a: CharacterAppearance): string {
  return Object.values(a).join('|');
}

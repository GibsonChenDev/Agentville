/**
 * Pixel-grid drawing toolkit. Every procedural asset in Agentville is drawn
 * here at native art resolution (1 unit = 1 art pixel) and later scaled by an
 * integer factor with nearest-neighbour sampling.
 */

export type Color = string;

interface HSL {
  h: number;
  s: number;
  l: number;
}

const cache = new Map<string, Color>();

export function hexToRgb(hex: Color): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): Color {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function toHsl(hex: Color): HSL {
  const [r, g, b] = hexToRgb(hex).map((n) => n / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

function fromHsl({ h, s, l }: HSL): Color {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function hueToward(h: number, target: number, amount: number): number {
  let diff = target - h;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (h + diff * amount + 360) % 360;
}

/**
 * Hue-shifted shading: shadows drift toward cool violet, highlights toward warm
 * yellow — the core shading rule of the art direction. `amount` in [-1, 1].
 */
export function shade(hex: Color, amount: number): Color {
  const key = `${hex}${amount}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const hsl = toHsl(hex);
  let out: HSL;
  if (amount < 0) {
    const a = -amount;
    out = {
      h: hsl.s < 0.05 ? 250 : hueToward(hsl.h, 255, a * 0.35),
      s: Math.min(1, hsl.s + a * 0.12 + (hsl.s < 0.05 ? a * 0.15 : 0)),
      l: Math.max(0, hsl.l - a * 0.55),
    };
  } else {
    out = {
      h: hsl.s < 0.05 ? 45 : hueToward(hsl.h, 50, amount * 0.3),
      s: Math.max(0, hsl.s - amount * 0.05),
      l: Math.min(1, hsl.l + amount * 0.5),
    };
  }
  const result = fromHsl(out);
  cache.set(key, result);
  return result;
}

/**
 * Darkens without the cool hue shift `shade` applies. For skin outlines: the
 * shifted version of a light skin tone turns a saturated red, which reads as
 * a sunburn around bare arms and legs.
 */
export function darkenWarm(hex: Color, amount: number): Color {
  const hsl = toHsl(hex);
  return fromHsl({ h: hsl.h, s: Math.min(1, hsl.s * 0.8), l: Math.max(0, hsl.l - amount * 0.55) });
}

/** Whether `hex` is `base` or one of its shades (same hue family, similar saturation). */
export function sameFamily(hex: Color, base: Color, hueTolerance = 14): boolean {
  const a = toHsl(hex);
  const b = toHsl(base);
  const dh = Math.abs(((a.h - b.h + 540) % 360) - 180);
  return dh <= hueTolerance && Math.abs(a.s - b.s) <= 0.3 && a.l >= 0.2;
}

export function mix(a: Color, b: Color, t: number): Color {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Small deterministic PRNG so procedural assets are identical on every launch. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  px(x: number, y: number, c: Color, alpha = 1) {
    this.rect(x, y, 1, 1, c, alpha);
  }

  rect(x: number, y: number, w: number, h: number, c: Color, alpha = 1) {
    if (w <= 0 || h <= 0) return;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  hline(x: number, y: number, w: number, c: Color, alpha = 1) {
    this.rect(x, y, w, 1, c, alpha);
  }

  vline(x: number, y: number, h: number, c: Color, alpha = 1) {
    this.rect(x, y, 1, h, c, alpha);
  }

  clear(x: number, y: number, w: number, h: number) {
    this.ctx.clearRect(x, y, w, h);
  }

  /** Rectangle with the four corner pixels removed. */
  round(x: number, y: number, w: number, h: number, c: Color, alpha = 1) {
    this.rect(x + 1, y, w - 2, h, c, alpha);
    this.rect(x, y + 1, 1, h - 2, c, alpha);
    this.rect(x + w - 1, y + 1, 1, h - 2, c, alpha);
  }

  /** Pixel ellipse (filled) using a midpoint-style scan. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, alpha = 1) {
    for (let y = -ry; y <= ry; y++) {
      const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.25))));
      this.rect(cx - span, cy + y, span * 2 + 1, 1, c, alpha);
    }
  }

  draw(src: PixelCanvas | HTMLCanvasElement, x: number, y: number) {
    this.ctx.drawImage(src instanceof PixelCanvas ? src.canvas : src, Math.round(x), Math.round(y));
  }

  /**
   * Selective outline ("sel-out"): every transparent pixel touching an opaque
   * one becomes a darkened, hue-shifted version of that neighbour. Gives all
   * sprites a consistent 1px outline that respects local colour.
   */
  outline(strength = -0.55, alphaThreshold = 200, colorFor?: (neighbour: Color) => Color | undefined) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const out = new Uint8ClampedArray(d);
    const W = this.w;
    const opaque = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < this.h && (d[(y * W + x) * 4 + 3] ?? 0) >= alphaThreshold;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if ((d[i + 3] ?? 0) > 0) continue;
        const n = [
          [x, y + 1],
          [x, y - 1],
          [x + 1, y],
          [x - 1, y],
        ].find(([nx, ny]) => opaque(nx!, ny!));
        if (!n) continue;
        const j = (n[1]! * W + n[0]!) * 4;
        const neighbour = rgbToHex(d[j]!, d[j + 1]!, d[j + 2]!);
        const [r, g, b] = hexToRgb(colorFor?.(neighbour) ?? shade(neighbour, strength));
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }
    }
    this.ctx.putImageData(new ImageData(out, W, this.h), 0, 0);
    return this;
  }

  flipped(): PixelCanvas {
    const f = new PixelCanvas(this.w, this.h);
    f.ctx.save();
    f.ctx.translate(this.w, 0);
    f.ctx.scale(-1, 1);
    f.ctx.drawImage(this.canvas, 0, 0);
    f.ctx.restore();
    return f;
  }
}

/**
 * Quantized radial light: alpha falls off in hard bands so light pools keep a
 * pixel-art look instead of a smooth airbrushed gradient.
 */
export function bandedRadial(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, color: Color, maxAlpha: number, bands = 4) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= 1) continue;
      const band = Math.ceil((1 - dist) * bands) / bands;
      pc.px(x, y, color, maxAlpha * band);
    }
  }
}

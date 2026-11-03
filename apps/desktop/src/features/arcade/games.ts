import type { GameId } from '@agentville/team-protocol';

/**
 * Arcade cabinet games. Each runs on a 256×224 pixel screen, updated with the
 * elapsed time and the current input, and draws itself with plain canvas calls.
 */
export const W = 256;
export const H = 224;

export interface Input {
  /** Keys held, lower-cased (`arrowleft`, `a`, ` `…). */
  held: Set<string>;
  /** Keys pressed since the last frame. */
  pressed: Set<string>;
  /** Pointer x on the game screen, when over it. */
  pointerX?: number;
  clicked: boolean;
}

export interface Game {
  readonly id: GameId;
  score: number;
  over: boolean;
  update(dt: number, input: Input): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
}

const FONT = '"Pixelify Sans", ui-monospace, monospace';
const any = (input: Input, ...keys: string[]) => keys.some((k) => input.pressed.has(k));
const held = (input: Input, ...keys: string[]) => keys.some((k) => input.held.has(k));

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size = 10, color = '#fdf6e3', align: CanvasTextAlign = 'left') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// ───────────────────────────────── Snake

export class Snake implements Game {
  readonly id = 'snake';
  score = 0;
  over = false;
  private readonly cell = 8;
  private readonly cols = W / 8;
  private readonly rows = (H - 16) / 8;
  private body = [
    { x: 8, y: 12 },
    { x: 7, y: 12 },
    { x: 6, y: 12 },
  ];
  private dir = { x: 1, y: 0 };
  private queued: { x: number; y: number }[] = [];
  private food = { x: 20, y: 12 };
  private acc = 0;

  constructor(private readonly random = Math.random) {
    this.placeFood();
  }

  private get stepMs() {
    return Math.max(55, 120 - this.body.length * 2);
  }

  private placeFood() {
    do this.food = { x: Math.floor(this.random() * this.cols), y: Math.floor(this.random() * this.rows) };
    while (this.body.some((b) => b.x === this.food.x && b.y === this.food.y));
  }

  update(dt: number, input: Input) {
    if (this.over) return;
    const turns: [string[], { x: number; y: number }][] = [
      [['arrowup', 'w'], { x: 0, y: -1 }],
      [['arrowdown', 's'], { x: 0, y: 1 }],
      [['arrowleft', 'a'], { x: -1, y: 0 }],
      [['arrowright', 'd'], { x: 1, y: 0 }],
    ];
    for (const [keys, d] of turns) {
      if (!any(input, ...keys)) continue;
      const last = this.queued.at(-1) ?? this.dir;
      if (last.x + d.x !== 0 || last.y + d.y !== 0) this.queued.push(d);
    }
    this.acc += dt;
    while (this.acc >= this.stepMs && !this.over) {
      this.acc -= this.stepMs;
      this.dir = this.queued.shift() ?? this.dir;
      const head = { x: this.body[0]!.x + this.dir.x, y: this.body[0]!.y + this.dir.y };
      if (head.x < 0 || head.y < 0 || head.x >= this.cols || head.y >= this.rows || this.body.some((b) => b.x === head.x && b.y === head.y)) {
        this.over = true;
        return;
      }
      this.body.unshift(head);
      if (head.x === this.food.x && head.y === this.food.y) {
        this.score += 10;
        this.placeFood();
      } else this.body.pop();
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    ctx.fillStyle = '#0f1a14';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#13241a';
    for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) if ((x + y) % 2) ctx.fillRect(x * this.cell, 16 + y * this.cell, this.cell, this.cell);
    const pulse = Math.sin(now / 150) > 0 ? 1 : 0;
    ctx.fillStyle = '#ff5f5f';
    ctx.fillRect(this.food.x * this.cell + 1 - pulse, 16 + this.food.y * this.cell + 1 - pulse, 6 + pulse * 2, 6 + pulse * 2);
    this.body.forEach((b, i) => {
      ctx.fillStyle = i === 0 ? '#b8ff7a' : i % 2 ? '#5cc77a' : '#4fb36a';
      ctx.fillRect(b.x * this.cell, 16 + b.y * this.cell, this.cell - 1, this.cell - 1);
    });
    ctx.fillStyle = '#0a120d';
    ctx.fillRect(0, 0, W, 16);
    text(ctx, `SCORE ${this.score}`, 6, 3);
  }
}

// ───────────────────────────────── Breakout

export class Breakout implements Game {
  readonly id = 'breakout';
  score = 0;
  over = false;
  private paddle = { x: W / 2 - 20, w: 40 };
  private ball = { x: W / 2, y: 170, vx: 70, vy: -110, stuck: true };
  private bricks: { x: number; y: number; hp: number; color: string }[] = [];
  private lives = 3;
  private level = 1;

  constructor() {
    this.buildLevel();
  }

  private buildLevel() {
    const colors = ['#ff5f5f', '#ffb347', '#ffd166', '#5cc77a', '#62e6ff', '#c7a3ff'];
    this.bricks = [];
    const rows = Math.min(6, 3 + this.level);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 10; c++) this.bricks.push({ x: 8 + c * 24, y: 28 + r * 10, hp: r < this.level - 1 ? 2 : 1, color: colors[r % colors.length]! });
  }

  private reset() {
    this.ball = { x: this.paddle.x + this.paddle.w / 2, y: 196, vx: 70, vy: -110 - this.level * 12, stuck: true };
  }

  update(dt: number, input: Input) {
    if (this.over) return;
    const s = dt / 1000;
    if (input.pointerX !== undefined) this.paddle.x = input.pointerX - this.paddle.w / 2;
    if (held(input, 'arrowleft', 'a')) this.paddle.x -= 200 * s;
    if (held(input, 'arrowright', 'd')) this.paddle.x += 200 * s;
    this.paddle.x = Math.max(0, Math.min(W - this.paddle.w, this.paddle.x));
    const b = this.ball;
    if (b.stuck) {
      b.x = this.paddle.x + this.paddle.w / 2;
      b.y = 196;
      if (any(input, ' ', 'arrowup', 'w', 'enter') || input.clicked) b.stuck = false;
      return;
    }
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (b.x < 3 || b.x > W - 3) {
      b.vx = -b.vx;
      b.x = Math.max(3, Math.min(W - 3, b.x));
    }
    if (b.y < 19) {
      b.vy = Math.abs(b.vy);
      b.y = 19;
    }
    if (b.vy > 0 && b.y >= 200 && b.y <= 206 && b.x >= this.paddle.x - 2 && b.x <= this.paddle.x + this.paddle.w + 2) {
      // Where it hits the paddle sets the angle.
      const hit = (b.x - (this.paddle.x + this.paddle.w / 2)) / (this.paddle.w / 2);
      const speed = Math.min(260, Math.hypot(b.vx, b.vy) * 1.02);
      b.vx = speed * hit * 0.8;
      b.vy = -Math.sqrt(Math.max(1, speed * speed - b.vx * b.vx));
    }
    for (const brick of this.bricks) {
      if (brick.hp <= 0 || b.x < brick.x - 2 || b.x > brick.x + 22 || b.y < brick.y - 2 || b.y > brick.y + 8) continue;
      brick.hp -= 1;
      b.vy = -b.vy;
      this.score += 10;
      break;
    }
    this.bricks = this.bricks.filter((x) => x.hp > 0);
    if (!this.bricks.length) {
      this.level += 1;
      this.score += 100;
      this.buildLevel();
      this.reset();
    }
    if (b.y > H) {
      this.lives -= 1;
      if (this.lives <= 0) this.over = true;
      else this.reset();
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#120f22';
    ctx.fillRect(0, 0, W, H);
    for (const brick of this.bricks) {
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, 22, 8);
      ctx.fillStyle = brick.hp > 1 ? '#ffffff' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(brick.x, brick.y, 22, 1);
    }
    ctx.fillStyle = '#e8e3ff';
    ctx.fillRect(Math.round(this.paddle.x), 202, this.paddle.w, 5);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(Math.round(this.ball.x) - 2, Math.round(this.ball.y) - 2, 4, 4);
    ctx.fillStyle = '#0a0816';
    ctx.fillRect(0, 0, W, 16);
    text(ctx, `SCORE ${this.score}`, 6, 3);
    text(ctx, `LV ${this.level}   ${'♥'.repeat(this.lives)}`, W - 6, 3, 10, '#ff8fb8', 'right');
    if (this.ball.stuck) text(ctx, 'SPACE / CLICK', W / 2, 150, 10, '#9aa3b5', 'center');
  }
}

// ───────────────────────────────── Flappy

export class Flappy implements Game {
  readonly id = 'flappy';
  score = 0;
  over = false;
  private y = 100;
  private vy = 0;
  private pipes: { x: number; gap: number; passed: boolean }[] = [];
  private started = false;
  private spawn = 0;

  constructor(private readonly random = Math.random) {}

  update(dt: number, input: Input) {
    if (this.over) return;
    const s = Math.min(dt, 50) / 1000;
    const flap = any(input, ' ', 'arrowup', 'w', 'enter') || input.clicked;
    if (!this.started) {
      if (flap) this.started = true;
      else return;
    }
    if (flap) this.vy = -150;
    this.vy += 420 * s;
    this.y += this.vy * s;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      this.spawn = 1500;
      this.pipes.push({ x: W + 10, gap: 50 + this.random() * (H - 140), passed: false });
    }
    const speed = 70 + Math.min(40, this.score * 2);
    for (const p of this.pipes) {
      p.x -= speed * s;
      if (!p.passed && p.x + 22 < 60) {
        p.passed = true;
        this.score += 1;
      }
      const inX = 60 + 6 > p.x && 60 - 6 < p.x + 22;
      if (inX && (this.y - 5 < p.gap || this.y + 5 > p.gap + 56)) this.over = true;
    }
    this.pipes = this.pipes.filter((p) => p.x > -30);
    if (this.y > H - 14 || this.y < 0) this.over = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#5aa9e6');
    sky.addColorStop(1, '#bfe6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) ctx.fillRect(((i * 80 - now / 40) % (W + 40)) + W - 40 - (i % 2) * 20, 30 + i * 22, 28, 8);
    for (const p of this.pipes) {
      ctx.fillStyle = '#4caf6a';
      ctx.fillRect(p.x, 0, 22, p.gap);
      ctx.fillRect(p.x, p.gap + 56, 22, H - p.gap - 56);
      ctx.fillStyle = '#2e7d4a';
      ctx.fillRect(p.x - 2, p.gap - 6, 26, 6);
      ctx.fillRect(p.x - 2, p.gap + 56, 26, 6);
    }
    ctx.fillStyle = '#d9b26a';
    ctx.fillRect(0, H - 12, W, 12);
    // the bird
    const wing = this.vy < 0 && Math.floor(now / 80) % 2 ? -2 : 1;
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(54, Math.round(this.y) - 5, 12, 10);
    ctx.fillStyle = '#ff8a3d';
    ctx.fillRect(66, Math.round(this.y) - 1, 4, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(61, Math.round(this.y) - 4, 3, 3);
    ctx.fillStyle = '#e0a93d';
    ctx.fillRect(55, Math.round(this.y) + wing, 6, 3);
    text(ctx, String(this.score), W / 2, 10, 20, '#ffffff', 'center');
    if (!this.started) text(ctx, 'SPACE / CLICK', W / 2, 140, 10, '#2f4170', 'center');
  }
}

// ───────────────────────────────── 2048

export class G2048 implements Game {
  readonly id = 'g2048';
  score = 0;
  over = false;
  grid: number[] = Array(16).fill(0);

  constructor(private readonly random = Math.random) {
    this.add();
    this.add();
  }

  private add() {
    const empty = this.grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (!empty.length) return;
    this.grid[empty[Math.floor(this.random() * empty.length)]!] = this.random() < 0.9 ? 2 : 4;
  }

  /** Slides one line toward its start; returns the new line and points scored. */
  static slide(line: number[]): { line: number[]; points: number } {
    const vals = line.filter((v) => v);
    const out: number[] = [];
    let points = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === vals[i + 1]) {
        out.push(vals[i]! * 2);
        points += vals[i]! * 2;
        i++;
      } else out.push(vals[i]!);
    }
    while (out.length < 4) out.push(0);
    return { line: out, points };
  }

  move(dir: 'left' | 'right' | 'up' | 'down'): boolean {
    const idx = (r: number, c: number) => {
      if (dir === 'left') return r * 4 + c;
      if (dir === 'right') return r * 4 + (3 - c);
      if (dir === 'up') return c * 4 + r;
      return (3 - c) * 4 + r;
    };
    let moved = false;
    for (let r = 0; r < 4; r++) {
      const line = [0, 1, 2, 3].map((c) => this.grid[idx(r, c)]!);
      const { line: next, points } = G2048.slide(line);
      next.forEach((v, c) => {
        if (this.grid[idx(r, c)] !== v) moved = true;
        this.grid[idx(r, c)] = v;
      });
      this.score += points;
    }
    if (moved) this.add();
    this.over = !this.canMove();
    return moved;
  }

  private canMove() {
    for (let i = 0; i < 16; i++) {
      if (!this.grid[i]) return true;
      if (i % 4 < 3 && this.grid[i] === this.grid[i + 1]) return true;
      if (i < 12 && this.grid[i] === this.grid[i + 4]) return true;
    }
    return false;
  }

  update(_dt: number, input: Input) {
    if (this.over) return;
    if (any(input, 'arrowleft', 'a')) this.move('left');
    else if (any(input, 'arrowright', 'd')) this.move('right');
    else if (any(input, 'arrowup', 'w')) this.move('up');
    else if (any(input, 'arrowdown', 's')) this.move('down');
  }

  draw(ctx: CanvasRenderingContext2D) {
    const colors: Record<number, string> = { 0: '#3a3248', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
    ctx.fillStyle = '#231d2b';
    ctx.fillRect(0, 0, W, H);
    text(ctx, `SCORE ${this.score}`, 6, 3);
    const size = 46;
    const x0 = (W - (size * 4 + 15)) / 2;
    const y0 = 20;
    this.grid.forEach((v, i) => {
      const x = x0 + (i % 4) * (size + 5);
      const y = y0 + Math.floor(i / 4) * (size + 5);
      ctx.fillStyle = colors[v] ?? '#3c3a32';
      ctx.fillRect(x, y, size, size);
      if (v) text(ctx, String(v), x + size / 2, y + (v >= 1024 ? 17 : 14), v >= 1024 ? 12 : v >= 128 ? 15 : 18, v <= 4 ? '#776e65' : '#ffffff', 'center');
    });
  }
}

export const GAME_LIST: { id: GameId; make: () => Game; controls: 'keys' | 'mouse' | 'flap' }[] = [
  { id: 'snake', make: () => new Snake(), controls: 'keys' },
  { id: 'breakout', make: () => new Breakout(), controls: 'mouse' },
  { id: 'flappy', make: () => new Flappy(), controls: 'flap' },
  { id: 'g2048', make: () => new G2048(), controls: 'keys' },
];

import type { AgentRecord, Facing, TilePoint } from '@agentville/domain';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { IntentScheduler, type Activity, type VisualIntent } from '../animations/intent';
import { ANCHOR_X, ANCHOR_Y, ANIMS, type AnimName } from '../assets/characterSprites';
import { iconForActivity, type IconKind } from '../assets/icons';
import type { NavGrid } from '../navigation/grid';
import { TILE } from '../scenes/layouts';
import type { CharacterTextures, WorldTextures } from '../engine/textures';

export interface Seat {
  /** Feet position in world px when seated. */
  x: number;
  y: number;
  tile: TilePoint;
  facing: 'up' | 'down';
  /** zIndex while seated (seated-up characters draw in front of their desk). */
  z: number;
}

export interface Spot {
  x: number;
  y: number;
  tile: TilePoint;
  facing: Facing;
}

export interface BadgeInfo {
  name: string;
  status: string;
  tone: 'neutral' | 'busy' | 'attention' | 'success' | 'danger' | 'muted';
  subtitle?: string;
}

const WALK_SPEED = 46; // art px per second
const TONE_COLORS: Record<BadgeInfo['tone'], number> = {
  neutral: 0x8b93a7,
  busy: 0x4fb3a9,
  attention: 0xf2b33d,
  success: 0x5cc77a,
  danger: 0xe5625c,
  muted: 0x6b6f7d,
};
const FONT = '-apple-system, "SF Pro Text", "Segoe UI", "PingFang TC", "Heiti TC", "Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif';

type Phase = 'hidden' | 'walking' | 'seated' | 'standing' | 'leaving';

export class CharacterActor {
  readonly root = new Container();
  readonly badge = new Container();
  private readonly body = new Sprite();
  private readonly shadow: Sprite;
  private readonly ring: Sprite;
  private readonly icon = new Sprite();
  private readonly badgeBg = new Graphics();
  private readonly nameText: Text;
  private readonly statusText: Text;
  private readonly statusDot = new Graphics();

  scheduler: IntentScheduler;
  x = 0;
  y = 0;
  private path: { x: number; y: number }[] = [];
  private phase: Phase = 'hidden';
  private facing: Facing = 'down';
  private destination: 'seat' | 'spot' | 'door' | null = null;
  private anim: AnimName = 'idle_front';
  private animStart = 0;
  private iconKind: IconKind | null = null;
  private badgeKey = '';
  private settle?: { fromX: number; fromY: number; t: number };
  selected = false;
  hovered = false;
  showStatus = false;
  record: AgentRecord;

  constructor(
    record: AgentRecord,
    private textures: CharacterTextures,
    private readonly world: WorldTextures,
    initial: VisualIntent,
    now: number,
    onSelect: (id: string) => void,
  ) {
    this.record = record;
    this.scheduler = new IntentScheduler(initial, now);
    this.shadow = new Sprite(world.shadow);
    this.shadow.anchor.set(0.5, 0.5);
    this.ring = new Sprite(world.ring);
    this.ring.anchor.set(0.5, 0.5);
    this.ring.visible = false;
    this.body.anchor.set(ANCHOR_X / 24, ANCHOR_Y / 36);
    this.icon.anchor.set(0.5, 1);
    this.icon.visible = false;
    for (const decor of [this.ring, this.shadow, this.icon]) decor.eventMode = 'none';
    this.root.addChild(this.ring, this.shadow, this.body, this.icon);
    this.root.visible = false;

    this.body.eventMode = 'static';
    this.body.cursor = 'pointer';
    this.body.on('pointertap', (e) => {
      e.stopPropagation();
      onSelect(record.id);
    });
    this.body.on('pointerover', () => (this.hovered = true));
    this.body.on('pointerout', () => (this.hovered = false));

    this.nameText = new Text({ text: record.name, style: { fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: 0xffffff } });
    this.statusText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 10, fontWeight: '500', fill: 0xd9dce6 } });
    this.badge.addChild(this.badgeBg, this.statusDot, this.nameText, this.statusText);
    this.badge.visible = false;
    this.badge.eventMode = 'static';
    this.badge.cursor = 'pointer';
    this.badge.on('pointertap', (e) => {
      e.stopPropagation();
      onSelect(record.id);
    });
  }

  setTextures(textures: CharacterTextures) {
    this.textures = textures;
    this.animStart = 0; // force frame refresh
  }

  get isVisible() {
    return this.phase !== 'hidden';
  }

  /** Places the character in the doorway and walks it to `target`. */
  spawnAt(door: { x: number; y: number }) {
    this.x = door.x;
    this.y = door.y;
    this.phase = 'standing';
    this.root.visible = true;
    this.root.alpha = 1;
  }

  walkTo(nav: NavGrid, target: TilePoint, kind: 'seat' | 'spot' | 'door', allow: TilePoint[]) {
    const from = this.tile();
    const start = nav.isWalkable(from.x, from.y) ? from : (nav.nearestWalkable(from) ?? from);
    const tiles = nav.findPath(start, target, [...allow, start]);
    this.destination = kind;
    this.settle = undefined;
    if (!tiles) {
      // Unreachable (e.g. layout changed underneath): teleport as a last resort.
      this.path = [{ x: target.x * TILE + TILE / 2, y: target.y * TILE + TILE / 2 + 4 }];
    } else {
      this.path = tiles.slice(1).map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 + 4 }));
    }
    this.phase = 'walking';
  }

  tile(): TilePoint {
    return { x: Math.floor(this.x / TILE), y: Math.floor((this.y - 4) / TILE) };
  }

  hide() {
    this.phase = 'hidden';
    this.root.visible = false;
    this.badge.visible = false;
    this.path = [];
  }

  /** Advances movement. Returns 'arrived' when the path completes this frame. */
  move(dtMs: number): 'arrived' | null {
    if (this.phase === 'walking' || this.phase === 'leaving') {
      let budget = (WALK_SPEED * dtMs) / 1000;
      while (budget > 0 && this.path.length) {
        const next = this.path[0]!;
        const dx = next.x - this.x;
        const dy = next.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > Math.abs(dy) + 0.5) this.facing = dx < 0 ? 'left' : 'right';
        else if (Math.abs(dy) > 0.01) this.facing = dy < 0 ? 'up' : 'down';
        if (dist <= budget) {
          this.x = next.x;
          this.y = next.y;
          this.path.shift();
          budget -= dist;
        } else {
          this.x += (dx / dist) * budget;
          this.y += (dy / dist) * budget;
          budget = 0;
        }
      }
      if (!this.path.length) return 'arrived';
    }
    return null;
  }

  get arrivedKind() {
    return this.destination;
  }

  sit(seat: Seat) {
    this.settle = this.x === seat.x && this.y === seat.y ? undefined : { fromX: this.x, fromY: this.y, t: 0 };
    this.x = seat.x;
    this.y = seat.y;
    this.facing = seat.facing;
    this.phase = 'seated';
    this.root.zIndex = seat.z;
  }

  stand(spot: Spot) {
    this.x = spot.x;
    this.y = spot.y;
    this.facing = spot.facing;
    this.phase = 'standing';
  }

  startLeaving(nav: NavGrid, door: TilePoint) {
    this.walkTo(nav, door, 'door', [door]);
    this.phase = 'leaving';
  }

  get isSeated() {
    return this.phase === 'seated';
  }
  get isLeaving() {
    return this.phase === 'leaving';
  }
  get isWalking() {
    return this.phase === 'walking';
  }

  /** Chooses and renders the current frame, icon and selection ring. */
  render(now: number, intent: VisualIntent, reduceMotion: boolean) {
    if (this.phase === 'hidden') return;
    let anim: AnimName;
    let flip = false;
    const sideDir = this.facing === 'left' || this.facing === 'right';
    if (this.phase === 'walking' || this.phase === 'leaving') {
      anim = sideDir ? 'walk_side' : this.facing === 'up' ? 'walk_back' : 'walk_front';
      flip = this.facing === 'right';
    } else if (this.phase === 'seated') {
      const view = this.facing === 'up' ? 'back' : 'front';
      const activity: Activity = intent.activity === 'talk' ? 'idle' : intent.activity;
      anim = `sit_${view}_${activity}` as AnimName;
    } else if (intent.place === 'meeting') {
      anim = sideDir ? 'stand_talk_side' : this.facing === 'up' ? 'stand_talk_back' : 'stand_talk_front';
      flip = this.facing === 'right';
    } else if (intent.activity === 'raise') {
      anim = 'stand_raise';
    } else if (intent.activity === 'cheer') {
      anim = 'stand_cheer';
    } else {
      anim = sideDir ? 'idle_side' : this.facing === 'up' ? 'idle_back' : 'idle_front';
      flip = this.facing === 'right';
    }
    if (anim !== this.anim) {
      this.anim = anim;
      this.animStart = now;
    }
    const def = ANIMS[anim];
    const isIdle = anim.startsWith('idle') || anim.endsWith('_idle');
    const frameIndex = reduceMotion && isIdle ? 0 : Math.floor((now - this.animStart) / def.frameMs) % def.frames.length;
    const set = flip ? this.textures.flipped[anim] : this.textures.frames[anim];
    const tex: Texture | undefined = set?.[frameIndex];
    if (tex && this.body.texture !== tex) this.body.texture = tex;

    // Short ease when sliding into a chair so it doesn't look like a teleport.
    let rx = this.x;
    let ry = this.y;
    if (this.settle) {
      this.settle.t = Math.min(1, this.settle.t + 1 / 10);
      const k = 1 - (1 - this.settle.t) ** 2;
      rx = this.settle.fromX + (this.x - this.settle.fromX) * k;
      ry = this.settle.fromY + (this.y - this.settle.fromY) * k;
      if (this.settle.t >= 1) this.settle = undefined;
    }
    this.root.position.set(Math.round(rx), Math.round(ry));
    if (this.phase !== 'seated') this.root.zIndex = Math.round(ry);
    this.shadow.visible = this.phase !== 'seated';
    this.shadow.position.set(0, 0);

    this.ring.visible = this.selected || this.hovered;
    this.ring.alpha = this.selected ? 0.75 + 0.25 * Math.sin(now / 220) : 0.45;
    this.ring.position.set(0, this.phase === 'seated' ? -2 : 0);

    // floating activity icon
    const kind = this.phase === 'walking' || this.phase === 'leaving' ? null : iconForActivity(intent.activity, intent.screen);
    if (kind !== this.iconKind) {
      this.iconKind = kind;
      this.icon.texture = kind ? this.world.icons[kind] : Texture.EMPTY;
    }
    this.icon.visible = !!kind;
    const bob = reduceMotion ? 0 : Math.round(Math.sin(now / 400) * 1);
    const headTop = this.phase === 'seated' ? -31 : -35;
    this.icon.position.set(9, headTop + 2 + bob);
  }

  /** Positions the screen-space badge; `toScreen` maps world → overlay coordinates. */
  renderBadge(info: BadgeInfo, toScreen: (x: number, y: number) => { x: number; y: number }, zoom: number) {
    if (this.phase === 'hidden') {
      this.badge.visible = false;
      return;
    }
    const showStatus = this.selected || this.hovered || this.showStatus || info.tone === 'attention' || info.tone === 'danger';
    const key = `${info.name}|${info.status}|${info.tone}|${showStatus}|${info.subtitle ?? ''}`;
    if (key !== this.badgeKey) {
      this.badgeKey = key;
      this.nameText.text = info.subtitle ? `${info.name} · ${info.subtitle}` : info.name;
      this.statusText.text = info.status;
      this.statusText.visible = showStatus;
      const padX = 7;
      const nameW = this.nameText.width;
      const statusW = showStatus ? this.statusText.width + 12 : 0;
      const w = Math.ceil(Math.max(nameW, statusW) + padX * 2);
      const h = showStatus ? 32 : 18;
      this.badgeBg.clear();
      this.badgeBg.roundRect(-w / 2, -h, w, h, 6).fill({ color: 0x17141f, alpha: 0.86 });
      this.badgeBg.roundRect(-w / 2, -h, w, h, 6).stroke({ color: this.selected ? 0xf2b33d : 0xffffff, alpha: this.selected ? 0.9 : 0.12, width: 1 });
      this.nameText.position.set(-w / 2 + padX, -h + 2);
      this.statusDot.clear();
      if (showStatus) {
        this.statusDot.circle(-w / 2 + padX + 3, -10, 3).fill(TONE_COLORS[info.tone]);
        this.statusText.position.set(-w / 2 + padX + 10, -17);
      }
    }
    const headTop = this.phase === 'seated' ? -33 : -37;
    const p = toScreen(this.root.x, this.root.y + headTop - 3);
    this.badge.position.set(Math.round(p.x), Math.round(p.y - (this.icon.visible ? 4 * zoom : 0)));
    this.badge.visible = zoom >= 2 || this.selected || this.hovered;
  }

  destroy() {
    this.root.destroy({ children: true });
    this.badge.destroy({ children: true });
  }
}

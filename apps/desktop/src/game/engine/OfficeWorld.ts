// Pixi generates shader/uniform code with eval by default; this module swaps in
// CSP-safe implementations so the Tauri webview needs no 'unsafe-eval'.
import 'pixi.js/unsafe-eval';
import type { AgentRecord, CharacterAppearance, Equipment, Facing, OfficeTheme, TilePoint, Workstation } from '@agentville/domain';
import type { PoseKind, Presence } from '@agentville/team-protocol';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { intentFor, isSlacking, type SlackActivity, type VisualIntent } from '../animations/intent';
import { drawDocument, drawGlow } from '../assets/icons';
import { LOBBY_STYLE, THEMES, type ThemeStyle } from '../assets/themes';
import { CharacterActor, type BadgeInfo, type Seat, type Spot } from '../characters/CharacterActor';
import { FURNITURE, SERVER_LEDS, drawChair, drawDesk, drawEquipment } from '../furniture/furniture';
import { drawScreen } from '../furniture/screens';
import { NavGrid } from '../navigation/grid';
import { DEFAULT_SCENES, TILE, type SceneDefinition } from '../scenes/layouts';
import { interactableAt, interactablesFor, type Interactable } from '../scenes/interactables';
import { waitingSpots } from '../scenes/crowd';
import { CAP, drawGlowLayer, drawLightmap, drawRoom, type LightSource } from '../scenes/room';
import { characterTextures, texture, worldTextures } from './textures';
import type { AgentStatus, ToolCategory } from '@agentville/domain';

export interface WorldAgent {
  record: AgentRecord;
  status: AgentStatus;
  category?: ToolCategory;
  badge: BadgeInfo;
  /** Ids of meeting participants, ordered, when collaborating. */
  meetingIndex?: number;
}

export interface WorldOptions {
  reduceMotion: boolean;
  alwaysShowLabels: boolean;
  /** Badge status while an idle agent slacks off, already localized. */
  slackLabels?: Record<SlackActivity, string>;
  /** Badge status for an agent waiting for a free desk, already localized. */
  waitingLabel?: string;
}

export interface EditView {
  selectedId?: string;
  placingKind?: string;
}

export interface EditCallbacks {
  onPick: (id: string | undefined) => void;
  onDrop: (id: string, x: number, y: number) => void;
  onPlace: (kind: string, x: number, y: number) => void;
  /** Whether `item` (an existing id, or a kind when placing) may sit at tile (x, y). */
  validate: (item: { id?: string; kind: string }, x: number, y: number) => boolean;
}

/** You (the person at this computer) and teammates in a shared office. */
export interface HumanInfo {
  name: string;
  appearance: CharacterAppearance;
  badge: BadgeInfo;
}

export interface PeerInfo extends HumanInfo {
  /** World id, e.g. `peer:<memberId>`. */
  id: string;
  presence?: Presence;
}

export const PLAYER_ID = 'player:self';

/** A door you can walk through: lobby doors lead to offices, an office's door leads back to the lobby. */
export interface WorldDoor {
  id: string;
  /** Floor tile right in front of the door; stepping onto it goes through. */
  tile: TilePoint;
  label?: string;
  /** Draw it swinging open (closed lobby doors); office doorways are always open. */
  opens?: boolean;
}

/** World key: an office theme, or the lobby hallway. */
export type SceneKey = OfficeTheme | 'lobby';

interface Human {
  actor: CharacterActor;
  badge: BadgeInfo;
  appearanceKey: string;
  /** Interactable in use. */
  seat?: string;
  /** Interactable to use once the walk there ends (player only). */
  pending?: string;
  /** Door to go through once the walk there ends (player only). */
  pendingDoor?: string;
  /** Where a click-walk is heading, to resume it if the layout changes underneath. */
  walkTarget?: TilePoint;
  /** Latest network presence (teammates only). */
  target?: Presence;
}

const PLAYER_SPEED = 72; // art px per second, a little brisker than agents
const PEER_SPEED = 110; // catch-up speed toward a teammate's reported position
const IDLE_INTENT: VisualIntent = { place: 'desk', activity: 'idle', screen: 'off' };
const TYPING_INTENT: VisualIntent = { place: 'desk', activity: 'type', screen: 'code' };
const MOVE_KEYS: Record<string, [number, number]> = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };

export interface CameraState {
  zoom: number;
  following?: string;
}

interface StationView {
  ws: Workstation;
  seat: Seat;
  desk: Sprite;
  chair: Sprite;
  equipment?: Sprite;
  equipmentKind?: Equipment;
  screenRects: { x: number; y: number; w: number; h: number }[];
  screen: Graphics;
  glow: Sprite;
  occupant?: string;
}

const ZOOMS = [1, 2, 3, 4, 5, 6];
const CONFETTI = [0xff5f8f, 0xffd166, 0x5cc7e8, 0x7dff9a, 0xc7a3ff, 0xff8a3d, 0xfbf7ef];
const SIGN_FONT = '-apple-system, "SF Pro Text", "Segoe UI", "PingFang TC", "Microsoft JhengHei UI", "Noto Sans TC", system-ui, sans-serif';
const SCREEN_FPS = 8;
const GLOW_TINT: Record<string, string> = {
  code: '#7fd1ff',
  terminal: '#7dff9a',
  doc: '#e8f0ff',
  web: '#e8f0ff',
  question: '#ffd166',
  success: '#7dff9a',
  error: '#ff6b6b',
  plan: '#c7a3ff',
  delegate: '#c7a3ff',
  idle: '#6f8fd6',
};

/**
 * The PixiJS office. Owns rendering only: it receives already-derived agent
 * statuses and localized labels and never talks to Claude or the store.
 */
export class OfficeWorld {
  private app = new Application();
  private camera = new Container();
  private entities = new Container();
  private fxBelow = new Container();
  private fxAbove = new Container();
  /** Above the lightmap, so confetti stays bright in dark offices. */
  private fxConfetti = new Container();
  private overlay = new Container();
  private confetti: { g: Graphics; vx: number; vy: number; life: number }[] = [];
  private banner?: { root: Container; text: Text; bg: Graphics; start: number };
  /** Teammates who just arrived: they say hello once their character shows up. */
  private greetings = new Map<string, { text: string; until: number }>();
  private bg?: Sprite;
  private glowLayer?: Sprite;
  private lightmap?: Sprite;
  private nav!: NavGrid;
  private scene!: SceneDefinition;
  private theme!: ThemeStyle;
  private stations: StationView[] = [];
  private actors = new Map<string, CharacterActor>();
  /** Agents no longer in the office, walking out the door before they're removed. */
  private departing = new Map<string, CharacterActor>();
  /** Open floor where agents wait when every desk is taken (nearest the door first). */
  private waiting: TilePoint[] = [];
  private agents = new Map<string, WorldAgent>();
  private assignments = new Map<string, string>(); // agentId → workstation id
  private glowTextures = new Map<string, Texture>();
  private particles: { s: Sprite; vx: number; vy: number; life: number; x0: number; y0: number; w: number; h: number; kind: 'dust' | 'rain' }[] = [];
  private leds: { g: Graphics; phase: number }[] = [];
  private zoom = 3;
  private cx = 0;
  private cy = 0;
  private followId?: string;
  private options: WorldOptions = { reduceMotion: false, alwaysShowLabels: false };
  private drag?: { x: number; y: number; cx: number; cy: number; moved: boolean };
  private lastScreenFrame = -1;
  private handoffs: { sprite: Sprite; from: string; to: string; start: number; done?: Sprite; doneAt?: number }[] = [];
  private furnitureSprites = new Map<string, { sprite: Sprite; kind: string; x: number; y: number }>();
  private editLayer = new Container();
  private editGrid = new Graphics();
  private editSelection = new Graphics();
  private ghost = new Sprite();
  private ghostTextures = new Map<string, Texture>();
  private edit?: { view: EditView; cb: EditCallbacks };
  private dragItem?: { id?: string; kind: string; grabDx: number; grabDy: number; tile?: { x: number; y: number }; moved: boolean };
  /** Actors to place directly at their destination after a theme switch (no walk-in). */
  private reseat = new Set<string>();
  private interactables: Interactable[] = [];
  /** Non-desk interactables in use → human id (desks use StationView.occupant). */
  private seatUsers = new Map<string, string>();
  private player?: Human;
  private peers = new Map<string, Human>();
  private keys = new Set<string>();
  private keyMoving = false;
  private lastPresence?: { p: Presence; at: number };
  private removeKeyListeners?: () => void;
  private sceneKey: SceneKey = 'loft';
  private doors: WorldDoor[] = [];
  private doorSigns = new Map<string, { root: Container; text: Text; bg: Graphics; key: string }>();
  private doorOpen = new Graphics();
  /** Door the player is standing in (fires once until they step off it). */
  private doorUnder?: string;
  private doorAnim?: { tile: TilePoint; start: number; fromX: number; fromY: number; done: () => void; opens: boolean };
  /** Next scene: bring the player in through this door. */
  private arrival?: TilePoint;
  private arrivalOpenUntil = 0;
  private arrivalGraceUntil = 0;
  private destroyed = false;
  private initialized = false;

  constructor(
    private readonly callbacks: {
      onSelect: (id?: string) => void;
      onCamera: (state: CameraState) => void;
      /** Your avatar moved or sat down; sent to teammates. */
      onPresence?: (p: Presence) => void;
      onPlayerClick?: () => void;
      /** The player walked through a door. */
      onDoor?: (id: string) => void;
      /** The player stepped up to an arcade cabinet. */
      onArcade?: () => void;
      /** The player stepped up to a dice table. */
      onDice?: () => void;
    },
  ) {}

  async init(host: HTMLElement, theme: SceneKey, scene?: SceneDefinition) {
    await this.app.init({
      resizeTo: host,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: false,
      roundPixels: true,
      background: theme === 'lobby' ? LOBBY_STYLE.void : THEMES[theme].void,
      preference: 'webgl',
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.imageRendering = 'pixelated';
    this.entities.sortableChildren = true;
    this.camera.addChild(this.fxBelow, this.entities, this.fxAbove, this.fxConfetti, this.editLayer);
    this.editLayer.addChild(this.editGrid, this.editSelection, this.ghost);
    this.editLayer.visible = false;
    this.ghost.alpha = 0.75;
    // The stage is interactive, so Pixi hit-tests every descendant and stops at the
    // first one under the pointer. Purely visual layers must opt out entirely or
    // they swallow clicks meant for characters and furniture.
    for (const layer of [this.fxBelow, this.fxAbove, this.fxConfetti, this.editLayer]) layer.eventMode = 'none';
    this.app.stage.addChild(this.camera, this.overlay);
    this.installInput(host);
    this.setTheme(theme, scene);
    this.fitZoom();
    // elapsedMS, not deltaMS: Pixi caps deltaMS at 100 ms (minFPS 10), which would slow walking 10x in a throttled background window.
    this.app.ticker.add((t) => this.update(t.elapsedMS));
    this.app.renderer.on('resize', () => this.clampCamera());
    this.initialized = true;
  }

  // ───────────────────────────────── scene building

  setTheme(themeId: SceneKey, scene?: SceneDefinition) {
    if (this.destroyed) return;
    if (!scene) scene = themeId === 'lobby' ? this.scene : DEFAULT_SCENES[themeId];
    this.sceneKey = themeId;
    this.theme = themeId === 'lobby' ? LOBBY_STYLE : THEMES[themeId];
    this.scene = scene;
    this.furnitureSprites.clear();
    this.app.renderer.background.color = this.theme.void;
    // Tear down the previous scene; actors survive and are re-seated below.
    for (const p of this.particles) p.s.destroy();
    this.particles = [];
    this.handoffs = []; // their sprites live in `entities` and are destroyed below
    this.leds = [];
    this.stations = [];
    for (const a of this.departing.values()) a.destroy();
    this.departing.clear();
    const keep = new Set([...this.actors.values(), ...this.humanActors()].map((a) => a.root));
    // Where you were sitting, so you can stand up in front of it in the new layout.
    const playerSeat = this.player?.seat ? this.interactables.find((i) => i.id === this.player!.seat)?.approach : undefined;
    for (const child of [...this.entities.children]) {
      if (keep.has(child)) continue;
      this.entities.removeChild(child);
      child.destroy();
    }
    this.fxBelow.removeChildren().forEach((c) => c.destroy());
    this.fxAbove.removeChildren().forEach((c) => c.destroy());
    this.fxConfetti.removeChildren().forEach((c) => c.destroy());
    this.confetti = [];
    this.bg?.destroy();
    this.glowLayer?.destroy();
    this.lightmap = undefined;
    this.glowTextures.clear();

    const { theme } = this;
    const W = scene.cols * TILE;
    const H = scene.rows * TILE;
    this.nav = new NavGrid(scene.cols, scene.rows);
    for (let x = 0; x < scene.cols; x++) for (let y = 0; y < scene.wallRows; y++) this.nav.setBlocked(x, y);
    for (let y = 0; y < scene.rows; y++) {
      this.nav.setBlocked(0, y);
      this.nav.setBlocked(scene.cols - 1, y);
    }
    for (let x = 0; x < scene.cols; x++) this.nav.setBlocked(x, scene.rows - 1);

    this.bg = new Sprite(texture(drawRoom(theme, scene).canvas));
    this.bg.eventMode = 'none';
    this.camera.addChildAt(this.bg, 0);

    const lights: LightSource[] = [];
    const lightColor = (c: 'warm' | 'screen' | 'accent') => (c === 'warm' ? theme.warmLight : c === 'screen' ? theme.screenGlow : theme.accent);

    for (const p of scene.furniture) {
      if (p.kind === 'desk') continue;
      const def = FURNITURE[p.kind];
      if (!def) continue;
      const canvas = def.draw(theme, p.variant ?? 0).canvas;
      const sprite = new Sprite(texture(canvas));
      const bottom = (p.y + def.fh) * TILE + def.bottomPad;
      sprite.position.set(p.x * TILE + def.ox, bottom - canvas.height);
      sprite.zIndex = (p.y + def.fh) * TILE - 1;
      this.entities.addChild(sprite);
      this.registerFurniture(p.id, p.kind, p.x, p.y, sprite);
      if (def.blocks) for (let dx = 0; dx < def.fw; dx++) for (let dy = 0; dy < def.fh; dy++) this.nav.setBlocked(p.x + dx, p.y + dy);
      if (def.light) lights.push({ x: sprite.x + def.light.x, y: sprite.y + def.light.y, r: def.light.r, color: lightColor(def.light.color), strength: def.light.strength });
      if (p.kind === 'server_rack') {
        for (const led of SERVER_LEDS) {
          const g = new Graphics();
          g.rect(0, 0, 1, 1).fill(Math.random() < 0.5 ? 0x7dff9a : 0x62e6ff);
          g.position.set(sprite.x + led.x, sprite.y + led.y);
          g.zIndex = sprite.zIndex + 0.5;
          g.eventMode = 'none';
          this.entities.addChild(g);
          this.leds.push({ g, phase: Math.random() * 10 });
        }
      }
    }

    for (const ws of scene.workstations) this.buildStation(ws, lights);
    this.interactables = interactablesFor(scene);
    this.waiting = waitingSpots(scene);

    // window + neon light sources for the lightmap
    for (const d of scene.wallDecor) {
      if (d.kind === 'window') lights.push({ x: d.x + d.w / 2, y: scene.wallRows * TILE + 10, r: d.w * 0.7, color: theme.window.night ? '#7f8cff' : theme.warmLight, strength: theme.window.night ? 0.55 : 0.4 });
      if (d.kind === 'neon') lights.push({ x: d.x + 22, y: d.y + 30, r: 52, color: theme.accent, strength: 0.75 });
      if (d.kind === 'door') lights.push({ x: d.x + 16, y: scene.wallRows * TILE + 4, r: 30, color: theme.warmLight, strength: 0.5 });
      if (d.kind === 'pendant') lights.push({ x: d.x, y: scene.wallRows * TILE + 14, r: 40, color: theme.warmLight, strength: 0.6 });
    }

    this.glowLayer = new Sprite(texture(drawGlowLayer(theme, scene, lights).canvas));
    this.glowLayer.blendMode = 'add';
    this.fxBelow.addChild(this.glowLayer);
    const lm = drawLightmap(theme, W, H, lights);
    if (lm) {
      this.lightmap = new Sprite(texture(lm.canvas));
      this.fxAbove.addChildAt(this.lightmap, 0);
    }
    for (const s of this.stations) this.fxAbove.addChild(s.glow);
    this.spawnAmbientParticles();

    this.cx = W / 2;
    this.cy = H / 2;
    this.clampCamera();
    // Re-seat everyone at the new layout.
    this.assignments.clear();
    for (const actor of this.actors.values()) {
      if (actor.isVisible) this.reseat.add(actor.record.id);
      actor.hide();
    }
    // People stand up; you stay where you were if that's still floor.
    this.seatUsers.clear();
    for (const [id, h] of this.allHumans()) {
      h.seat = undefined;
      h.pending = undefined;
      h.actor.standAnim = undefined;
      h.actor.scheduler.current = IDLE_INTENT;
      if (id !== PLAYER_ID) h.actor.hide();
      else if (this.arrival) this.arriveThrough(h, this.arrival);
      else if (h.walkTarget && h.actor.isWalking && this.nav.isWalkable(h.walkTarget.x, h.walkTarget.y)) h.actor.walkTo(this.nav, h.walkTarget, 'player', [h.walkTarget]);
      else if (playerSeat && this.nav.isWalkable(playerSeat.x, playerSeat.y)) h.actor.stand({ x: playerSeat.x * TILE + TILE / 2, y: playerSeat.y * TILE + 12, tile: playerSeat, facing: 'down' });
      else if (h.actor.isVisible && this.freeAt(h.actor.x, h.actor.y)) h.actor.halt();
      else this.placeAtDoor(h);
    }
    this.arrival = undefined;
    this.doorOpen = new Graphics();
    this.doorOpen.eventMode = 'none';
    this.fxBelow.addChild(this.doorOpen);
    this.emitPresence();
    this.drawEditGrid();
    this.applyEditView();
  }

  /** Swaps the layout of the current theme in place, keeping the camera where it is. */
  setScene(scene: SceneDefinition) {
    const { cx, cy } = this;
    this.setTheme(this.sceneKey, scene);
    this.cx = cx;
    this.cy = cy;
    this.clampCamera();
  }

  private buildStation(ws: Workstation, lights: LightSource[]) {
    const deskPlacement = this.scene.furniture.find((f) => f.id === ws.deskId)!;
    const deskCanvas = drawDesk(this.theme).canvas;
    const desk = new Sprite(texture(deskCanvas));
    const deskBottom = (deskPlacement.y + 1) * TILE;
    desk.position.set(deskPlacement.x * TILE - 1, deskBottom - deskCanvas.height);
    desk.zIndex = deskBottom - 1;
    this.entities.addChild(desk);
    this.registerFurniture(deskPlacement.id, 'desk', deskPlacement.x, deskPlacement.y, desk);
    this.nav.setBlocked(deskPlacement.x, deskPlacement.y);
    this.nav.setBlocked(deskPlacement.x + 1, deskPlacement.y);

    const up = ws.facing === 'up';
    const seat: Seat = up
      ? { x: deskPlacement.x * TILE + 16, y: deskPlacement.y * TILE + 17, tile: ws.seat, facing: 'up', z: deskBottom + 6 }
      : { x: deskPlacement.x * TILE + 21, y: deskPlacement.y * TILE + 4, tile: ws.seat, facing: 'down', z: deskBottom - 3 };
    const chairCanvas = drawChair(this.theme, up ? 'back' : 'front').canvas;
    const chair = new Sprite(texture(chairCanvas));
    chair.anchor.set(0.5, 1);
    chair.position.set(seat.x, up ? seat.y + 6 : seat.y - 1);
    chair.zIndex = up ? seat.z + 1 : seat.z - 1;
    chair.eventMode = 'none';
    this.entities.addChild(chair);

    const screen = new Graphics();
    screen.zIndex = desk.zIndex + 0.6;
    screen.eventMode = 'none';
    this.entities.addChild(screen);
    const glow = new Sprite();
    glow.blendMode = 'add';
    glow.visible = false;
    lights.push({ x: seat.x, y: deskPlacement.y * TILE - 4, r: 18, color: this.theme.screenGlow, strength: 0.45 });
    this.stations.push({ ws, seat, desk, chair, screen, glow, screenRects: [] });
  }

  private setStationEquipment(station: StationView, kind: Equipment | undefined, seed: number) {
    if (station.equipmentKind === kind) return;
    station.equipment?.destroy();
    station.equipment = undefined;
    station.screenRects = [];
    station.equipmentKind = kind;
    const equipKind: Equipment = kind ?? 'laptop';
    const e = drawEquipment(this.theme, equipKind, station.ws.facing === 'up' ? 'screen' : 'back', seed);
    const sprite = new Sprite(texture(e.canvas.canvas));
    sprite.position.set(station.desk.x, station.desk.y + 2 - 16);
    sprite.zIndex = station.desk.zIndex + 0.5;
    sprite.eventMode = 'none';
    this.entities.addChild(sprite);
    station.equipment = sprite;
    station.screenRects = e.screens.map((r) => ({ ...r, x: r.x + sprite.x, y: r.y + sprite.y }));
  }

  private spawnAmbientParticles() {
    if (this.options.reduceMotion) return;
    const { scene, theme } = this;
    const dot = texture(dotCanvas(theme.window.night ? '#b8c4ff' : '#fff6dc'));
    if (!theme.window.night) {
      for (const d of scene.wallDecor) {
        if (d.kind !== 'window') continue;
        for (let i = 0; i < 9; i++) {
          const s = new Sprite(dot);
          s.blendMode = 'add';
          const p = { s, vx: 1.5 + Math.random() * 2, vy: -1 - Math.random() * 1.5, life: Math.random() * 10, x0: d.x + 10, y0: scene.wallRows * TILE + 4, w: d.w + 30, h: 64, kind: 'dust' as const };
          this.particles.push(p);
          this.fxAbove.addChild(s);
        }
      }
    } else {
      const rain = texture(rainCanvas());
      for (const d of scene.wallDecor) {
        if (d.kind !== 'window') continue;
        for (let i = 0; i < 14; i++) {
          const s = new Sprite(rain);
          s.alpha = 0.35;
          const p = { s, vx: -6, vy: 70 + Math.random() * 30, life: Math.random() * 10, x0: d.x, y0: 8, w: d.w - 3, h: scene.wallRows * TILE - 22, kind: 'rain' as const };
          this.particles.push(p);
          s.eventMode = 'none';
          this.camera.addChildAt(s, 1);
        }
      }
    }
  }

  // ───────────────────────────────── agents

  sync(agents: WorldAgent[], selectedId: string | undefined, options: WorldOptions) {
    if (!this.initialized) return;
    const motionChanged = options.reduceMotion !== this.options.reduceMotion;
    this.options = options;
    if (motionChanged) this.setTheme(this.sceneKey, this.scene);
    const now = performance.now();
    const ids = new Set(agents.map((a) => a.record.id));
    for (const [id, actor] of this.actors) {
      if (ids.has(id)) continue;
      this.releaseStation(id);
      this.actors.delete(id);
      // Gone from the office (a teammate closed the app, a session was removed): walk out rather than vanish.
      if (actor.isVisible && !actor.isLeaving && !options.reduceMotion && this.departing.size < 40) {
        actor.selected = actor.hovered = false;
        actor.startLeaving(this.nav, this.scene.door);
        this.departing.set(id, actor);
      } else actor.destroy();
    }
    for (const agent of agents) {
      this.agents.set(agent.record.id, agent);
      const intent = intentFor(agent.status, agent.category);
      let actor = this.actors.get(agent.record.id);
      if (!actor) {
        this.departing.get(agent.record.id)?.destroy();
        this.departing.delete(agent.record.id);
        actor = new CharacterActor(agent.record, characterTextures(agent.record.appearance), worldTextures(), intent, now, (id) => this.callbacks.onSelect(id));
        this.actors.set(agent.record.id, actor);
        this.entities.addChild(actor.root);
        this.overlay.addChild(actor.badge, actor.bubble);
      } else {
        if (actor.record.appearance !== agent.record.appearance) actor.setTextures(characterTextures(agent.record.appearance));
        // A new preferred desk: free the current one so steering walks the character over.
        if (actor.record.workstationId !== agent.record.workstationId) this.releaseStation(agent.record.id);
        actor.record = agent.record;
        actor.scheduler.propose(intent, now);
      }
      actor.selected = agent.record.id === selectedId;
      actor.showStatus = options.alwaysShowLabels;
    }
    for (const id of this.agents.keys()) if (!ids.has(id)) this.agents.delete(id);
  }

  private assignStation(agentId: string): StationView | undefined {
    const existing = this.assignments.get(agentId);
    if (existing) return this.stations.find((s) => s.ws.id === existing);
    const agent = this.agents.get(agentId);
    const preferred = agent?.record.workstationId && this.stations.find((s) => s.ws.id === agent.record.workstationId && !s.occupant);
    // Your own agents come first: when the office is full, a teammate's agent gives up its desk.
    const bumpable = isPeerAgent(agentId) ? undefined : this.stations.find((s) => s.occupant && isPeerAgent(s.occupant) && this.actors.has(s.occupant));
    const station = preferred || this.stations.find((s) => !s.occupant) || bumpable;
    if (!station) return undefined;
    if (station.occupant) this.releaseStation(station.occupant);
    station.occupant = agentId;
    this.assignments.set(agentId, station.ws.id);
    return station;
  }

  private releaseStation(agentId: string) {
    const id = this.assignments.get(agentId);
    const station = this.stations.find((s) => s.ws.id === id);
    if (station) station.occupant = undefined;
    this.assignments.delete(agentId);
  }

  /** Agents at their desks' place with no desk free: each gets its own waiting tile, in arrival order. */
  private waitingTile(agentId: string): TilePoint | undefined {
    if (!this.waiting.length) return undefined;
    let index = 0;
    for (const [id, a] of this.actors) {
      if (id === agentId) return this.waiting[index % this.waiting.length];
      if (!this.assignments.has(id) && !a.isLeaving && a.scheduler.current.place === 'desk') index++;
    }
    return undefined;
  }

  /** No desk free: stand at a waiting tile until one opens up (steer re-checks every frame). */
  private wait(actor: CharacterActor) {
    const tile = this.waitingTile(actor.record.id);
    if (!tile) return;
    if (actor.isWalking) {
      const goal = actor.goalTile;
      if (actor.arrivedKind === 'wait' && goal?.x === tile.x && goal.y === tile.y) return;
    } else if (!actor.isSeated) {
      const at = actor.tile();
      if (at.x === tile.x && at.y === tile.y) return;
    }
    actor.walkTo(this.nav, tile, 'wait', [tile]);
  }

  /** Is the agent standing around waiting for a desk? */
  private isWaiting(actor: CharacterActor) {
    return actor.isVisible && !actor.isLeaving && !actor.isSeated && actor.scheduler.current.place === 'desk' && !this.assignments.has(actor.record.id);
  }

  private doorPoint() {
    const d = this.scene.door;
    return { x: d.x * TILE + TILE, y: this.scene.wallRows * TILE - 2 };
  }

  private meetingSpot(agentId: string): Spot | undefined {
    const participants = [...this.agents.values()].filter((a) => intentFor(a.status).place === 'meeting').map((a) => a.record.id);
    const index = participants.indexOf(agentId);
    const spot = this.scene.meetingSpots[index] ?? this.scene.loungeSpots[index - this.scene.meetingSpots.length];
    if (!spot) return undefined;
    return { x: spot.x * TILE + TILE / 2, y: spot.y * TILE + TILE / 2 + 4, tile: { x: spot.x, y: spot.y }, facing: spot.facing };
  }

  /** Drives each actor toward where its current intent says it should be. */
  private steer(actor: CharacterActor, intent: VisualIntent) {
    const id = actor.record.id;
    const door = this.scene.door;
    if (intent.place === 'away') {
      if (actor.isVisible && !actor.isLeaving) {
        actor.startLeaving(this.nav, door);
        this.releaseStation(id);
      }
      return;
    }
    if (!actor.isVisible && this.reseat.delete(id)) {
      if (intent.place === 'desk') {
        const station = this.assignStation(id);
        if (station) {
          actor.spawnAt(station.seat);
          actor.sit(station.seat);
          return;
        }
      } else {
        const spot = this.meetingSpot(id);
        if (spot) {
          actor.spawnAt(spot);
          actor.stand(spot);
          return;
        }
      }
    }
    if (!actor.isVisible) actor.spawnAt(this.doorPoint());
    if (actor.isLeaving) {
      actor.walkTo(this.nav, door, 'door', [door]);
    }
    if (intent.place === 'desk') {
      const station = this.assignStation(id);
      if (!station) return this.wait(actor); // office full: wait on open floor until a desk frees up
      if (actor.isSeated && actor.x === station.seat.x && actor.y === station.seat.y) return;
      if (actor.isWalking && actor.arrivedKind === 'seat') return;
      actor.walkTo(this.nav, station.ws.seat, 'seat', [station.ws.seat]);
    } else if (intent.place === 'meeting') {
      const spot = this.meetingSpot(id);
      if (!spot) return;
      if (!actor.isSeated && !actor.isWalking && actor.x === spot.x && actor.y === spot.y) return;
      if (actor.isWalking && actor.arrivedKind === 'spot') return;
      actor.walkTo(this.nav, spot.tile, 'spot', [spot.tile]);
    }
  }

  private update(dtMs: number) {
    const now = performance.now();
    // Hidden or App-Napped windows get ~1 frame/s; allow large steps so walking
    // keeps real time instead of crawling (paths are followed segment by segment).
    const dt = Math.min(dtMs, 1000);

    for (const actor of this.actors.values()) {
      const intent = actor.scheduler.tick(now);
      this.steer(actor, intent);
      if (actor.move(dt) === 'arrived') {
        const kind = actor.arrivedKind;
        if (kind === 'door') actor.hide();
        else if (kind === 'seat') {
          const station = this.stations.find((s) => s.ws.id === this.assignments.get(actor.record.id));
          if (station) actor.sit(station.seat);
        } else if (kind === 'spot') {
          const spot = this.meetingSpot(actor.record.id);
          if (spot) actor.stand(spot);
        } else if (kind === 'wait') actor.halt('down');
      }
      actor.render(now, intent, this.options.reduceMotion);
      // Characters fade back while the layout is being edited (re-seating resets alpha).
      actor.root.alpha = this.edit ? 0.35 : 1;
      actor.root.eventMode = this.edit ? 'none' : 'auto';
    }

    for (const [id, actor] of this.departing) {
      if (actor.move(dt) === 'arrived' || !actor.isVisible) {
        actor.destroy();
        this.departing.delete(id);
        continue;
      }
      actor.render(now, { place: 'away', activity: 'idle', screen: 'off' }, this.options.reduceMotion);
      actor.badge.visible = actor.bubble.visible = false;
    }

    this.updateDoorAnim(now);
    this.updatePlayer(dt);
    for (const [id, h] of this.peers) {
      this.updatePeer(id, h, dt);
      const hello = this.greetings.get(id);
      if (hello && (now > hello.until || h.actor.isVisible)) {
        this.greetings.delete(id);
        if (h.actor.isVisible) h.actor.say(hello.text, now, 4000);
      }
    }
    this.updateConfetti(dt);
    for (const [, h] of this.allHumans()) {
      h.actor.render(now, h.actor.scheduler.current, this.options.reduceMotion);
      if (!(this.doorAnim && h === this.player)) h.actor.root.alpha = this.edit ? 0.35 : 1;
      h.actor.root.eventMode = this.edit ? 'none' : 'auto';
    }
    this.emitPresence();

    this.updateStations(now);
    this.updateParticles(dt, now);
    this.updateHandoffs(now);

    if (this.followId) {
      const a = this.actors.get(this.followId) ?? this.human(this.followId)?.actor;
      if (a?.isVisible) {
        this.cx += (a.x - this.cx) * Math.min(1, dt / 180);
        this.cy += (a.y - 16 - this.cy) * Math.min(1, dt / 180);
      }
    }
    this.applyCamera();
    const toScreen = (x: number, y: number) => ({ x: this.camera.x + x * this.zoom, y: this.camera.y + y * this.zoom });
    for (const actor of this.actors.values()) {
      const agent = this.agents.get(actor.record.id);
      const slack = actor.scheduler.current.activity;
      const label = isSlacking(slack) && actor.isSeated ? this.options.slackLabels?.[slack] : this.isWaiting(actor) ? this.options.waitingLabel : undefined;
      if (agent) actor.renderBadge(label ? { ...agent.badge, status: label } : agent.badge, toScreen, this.zoom);
      if (this.edit) actor.badge.visible = actor.bubble.visible = false;
      // A crowd waiting for desks would bury the office under name tags: theirs show on hover.
      else if (this.isWaiting(actor) && !actor.selected && !actor.hovered) actor.badge.visible = false;
    }
    for (const [, h] of this.allHumans()) {
      h.actor.renderBadge(h.badge, toScreen, this.zoom);
      if (this.edit) h.actor.badge.visible = h.actor.bubble.visible = false;
    }
    this.updateCoinPops(now, toScreen);
    this.updateBanner(now);
    for (const door of this.doors) {
      const sign = this.doorSigns.get(door.id);
      if (!sign) continue;
      const p = toScreen(door.tile.x * TILE + TILE, this.scene.wallRows * TILE - 46);
      sign.root.position.set(Math.round(p.x), Math.round(p.y));
      sign.root.visible = !this.edit && this.zoom >= 2;
    }
  }

  private updateStations(now: number) {
    const frame = Math.floor(now / (1000 / SCREEN_FPS));
    const redraw = frame !== this.lastScreenFrame;
    this.lastScreenFrame = frame;
    for (const station of this.stations) {
      const occupantId = station.occupant;
      const actor = occupantId ? (this.actors.get(occupantId) ?? this.human(occupantId)?.actor) : undefined;
      const seated = !!actor?.isSeated;
      this.setStationEquipment(station, actor?.record.appearance.equipment, hashString(station.ws.id));
      const mode = seated && actor ? actor.scheduler.current.screen : 'off';
      if (redraw) {
        station.screen.clear();
        for (const rect of station.screenRects) drawScreen(station.screen, rect, mode, frame, hashString(station.ws.id));
      }
      const glowOn = seated && mode !== 'off';
      station.glow.visible = glowOn;
      if (glowOn) {
        const color = GLOW_TINT[mode] ?? this.theme.screenGlow;
        station.glow.texture = this.glowTexture(color);
        const up = station.ws.facing === 'up';
        station.glow.position.set(station.seat.x - 20, (up ? station.seat.y - 34 : station.seat.y - 30) - 12);
        const flicker = this.options.reduceMotion ? 0 : Math.sin(now / 90 + station.seat.x) * 0.04;
        station.glow.alpha = (this.theme.window.night ? 0.42 : 0.16) + flicker;
      }
    }
    for (const led of this.leds) led.g.alpha = Math.sin(now / 300 + led.phase * 3) > 0.2 ? 1 : 0.25;
  }

  private glowTexture(color: string) {
    let t = this.glowTextures.get(color);
    if (!t) {
      t = texture(drawGlow(color, 20, 14).canvas);
      this.glowTextures.set(color, t);
    }
    return t;
  }

  private updateParticles(dt: number, now: number) {
    for (const p of this.particles) {
      p.life += dt / 1000;
      if (p.kind === 'dust') {
        const x = p.x0 + ((p.life * p.vx * 6 + p.w * ((p.vy * 37) % 1)) % p.w);
        const y = p.y0 + p.h - ((p.life * -p.vy * 4) % p.h);
        p.s.position.set(Math.round(x + (y - p.y0) * 0.55), Math.round(y));
        p.s.alpha = 0.25 + 0.35 * Math.max(0, Math.sin(now / 700 + p.vx * 10));
      } else {
        const y = p.y0 + ((p.life * p.vy) % p.h);
        const x = p.x0 + ((p.vx * -37 * (1 + p.vy)) % p.w + p.w) % p.w;
        p.s.position.set(Math.round(x), Math.round(y));
      }
    }
  }

  // ───────────────────────────────── handoffs

  /**
   * Shows a real coordination step: a document flies from one character to
   * another (task handed back to the lead, subagent reporting to its parent).
   * Skipped silently when either character isn't in the office.
   */
  handoff(fromId: string, toId: string, kind: 'task' | 'report') {
    const from = this.actors.get(fromId);
    const to = this.actors.get(toId);
    if (!from?.isVisible || !to?.isVisible || fromId === toId || this.handoffs.length > 12) return;
    const sprite = new Sprite(this.docTexture(kind));
    sprite.anchor.set(0.5, 0.5);
    sprite.eventMode = 'none';
    sprite.zIndex = 100_000;
    this.entities.addChild(sprite);
    this.handoffs.push({ sprite, from: fromId, to: toId, start: performance.now() });
  }

  private coinPops: { root: Container; agentId: string; start: number }[] = [];

  /** A "+N 🪙" that floats up from an agent who just earned you coins. */
  coinPop(agentId: string, amount: number) {
    const actor = this.actors.get(agentId);
    if (!actor?.isVisible || this.coinPops.length > 20) return;
    const root = new Container();
    const text = new Text({ text: `+${amount} 🪙`, style: { fontFamily: SIGN_FONT, fontSize: 13, fontWeight: '800', fill: 0xffd166, stroke: { color: 0x2a1d0a, width: 3 } } });
    text.anchor.set(0.5, 1);
    root.addChild(text);
    root.eventMode = 'none';
    this.overlay.addChild(root);
    this.coinPops.push({ root, agentId, start: performance.now() });
  }

  private updateCoinPops(now: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    this.coinPops = this.coinPops.filter((c) => {
      const actor = this.actors.get(c.agentId);
      const age = now - c.start;
      if (!actor || age > 1600) {
        c.root.destroy({ children: true });
        return false;
      }
      const p = toScreen(actor.root.x, actor.root.y - 44);
      c.root.position.set(Math.round(p.x), Math.round(p.y - age / 25));
      c.root.alpha = age < 1100 ? 1 : 1 - (age - 1100) / 500;
      return true;
    });
  }

  /**
   * A teammate came in: confetti bursts from the door, a banner says who it is,
   * and their character says hello as soon as it appears.
   */
  welcome(peerId: string, banner: string, greeting: string) {
    if (!this.initialized || this.sceneKey === 'lobby') return;
    const now = performance.now();
    this.greetings.set(peerId, { text: greeting, until: now + 15_000 });
    this.showBanner(banner, now);
    if (this.options.reduceMotion || this.confetti.length > 200) return;
    const d = this.doorPoint();
    for (let i = 0; i < 80; i++) {
      const g = new Graphics();
      g.rect(0, 0, i % 3 ? 2 : 1, i % 4 ? 1 : 2).fill(CONFETTI[i % CONFETTI.length]!);
      g.position.set(d.x + (Math.random() - 0.5) * 24, d.y + 10);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = 70 + Math.random() * 110;
      this.fxConfetti.addChild(g);
      this.confetti.push({ g, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0 });
    }
  }

  private updateConfetti(dt: number) {
    const s = dt / 1000;
    this.confetti = this.confetti.filter((c) => {
      c.life += s;
      if (c.life > 2.4) {
        c.g.destroy();
        return false;
      }
      c.vx *= 0.985;
      // Paper flutters: gravity, but a slow terminal speed and a little sway.
      c.vy = Math.min(c.vy + 190 * s, 34);
      c.g.position.set(c.g.x + (c.vx + Math.sin(c.life * 9 + c.vx) * 12) * s, c.g.y + c.vy * s);
      c.g.alpha = c.life < 1.8 ? 1 : 1 - (c.life - 1.8) / 0.6;
      return true;
    });
  }

  private showBanner(text: string, now: number) {
    if (!this.banner) {
      const root = new Container();
      const bg = new Graphics();
      const label = new Text({ text: '', style: { fontFamily: SIGN_FONT, fontSize: 15, fontWeight: '800', fill: 0x231d2b } });
      root.addChild(bg, label);
      root.eventMode = 'none';
      this.overlay.addChild(root);
      this.banner = { root, text: label, bg, start: now };
    }
    const b = this.banner;
    b.start = now;
    b.text.text = text;
    const w = Math.ceil(b.text.width + 36);
    b.bg.clear();
    b.bg.roundRect(-w / 2, 0, w, 34, 17).fill({ color: 0xffd166 });
    b.bg.roundRect(-w / 2, 0, w, 34, 17).stroke({ color: 0x2a1d0a, alpha: 0.5, width: 2 });
    b.text.position.set(-w / 2 + 18, 7);
  }

  private updateBanner(now: number) {
    const b = this.banner;
    if (!b) return;
    const age = now - b.start;
    if (age > 4200) {
      b.root.visible = false;
      return;
    }
    b.root.visible = !this.edit;
    const enter = Math.min(1, age / 220);
    b.root.alpha = age < 3600 ? enter : 1 - (age - 3600) / 600;
    b.root.position.set(Math.round(this.app.screen.width / 2), Math.round(14 + (1 - enter) * -20));
  }

  private docTextures = new Map<string, Texture>();
  private docTexture(kind: 'task' | 'report') {
    let t = this.docTextures.get(kind);
    if (!t) {
      t = texture(drawDocument(kind).canvas);
      this.docTextures.set(kind, t);
    }
    return t;
  }

  private updateHandoffs(now: number) {
    const FLIGHT = 1300;
    this.handoffs = this.handoffs.filter((h) => {
      const from = this.actors.get(h.from);
      const to = this.actors.get(h.to);
      if (!from || !to) {
        h.sprite.destroy();
        h.done?.destroy();
        return false;
      }
      const t = Math.min(1, (now - h.start) / FLIGHT);
      if (t < 1) {
        const k = t * t * (3 - 2 * t);
        const x0 = from.x;
        const y0 = from.y - 30;
        const x1 = to.x;
        const y1 = to.y - 30;
        const arc = Math.sin(Math.PI * t) * (24 + Math.abs(x1 - x0) * 0.15);
        h.sprite.position.set(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k - arc));
        h.sprite.rotation = this.options.reduceMotion ? 0 : Math.round(Math.sin(t * Math.PI * 4) * 2) * 0.12;
        return true;
      }
      if (!h.done) {
        h.sprite.visible = false;
        h.done = new Sprite(worldTextures().icons.cheer);
        h.done.anchor.set(0.5, 1);
        h.done.eventMode = 'none';
        h.done.zIndex = 100_000;
        this.entities.addChild(h.done);
        h.doneAt = now;
      }
      const age = now - (h.doneAt ?? now);
      h.done.position.set(Math.round(to.x), Math.round(to.y - 38 - age / 60));
      h.done.alpha = Math.max(0, 1 - age / 900);
      if (age < 900) return true;
      h.sprite.destroy();
      h.done.destroy();
      return false;
    });
  }

  // ───────────────────────────────── office editing

  private registerFurniture(id: string, kind: string, x: number, y: number, sprite: Sprite) {
    this.furnitureSprites.set(id, { sprite, kind, x, y });
    sprite.on('pointerdown', (e) => {
      if (!this.edit || this.edit.view.placingKind) return;
      e.stopPropagation();
      const t = this.tileAt(e.global);
      this.edit.cb.onPick(id);
      this.dragItem = { id, kind, grabDx: t.x - x, grabDy: t.y - y, moved: false };
    });
  }

  /** Turns office editing on (with the current selection/placement) or off. */
  setEditing(view: EditView | null, cb?: EditCallbacks) {
    this.edit = view && cb ? { view, cb } : undefined;
    if (!this.edit) this.dragItem = undefined;
    this.applyEditView();
  }

  private applyEditView() {
    const editing = !!this.edit;
    this.editLayer.visible = editing;
    for (const { sprite } of this.furnitureSprites.values()) {
      // Outside the editor furniture is scenery: let clicks fall through to characters.
      sprite.eventMode = editing ? 'static' : 'none';
      sprite.cursor = editing ? 'grab' : 'default';
    }
    this.editSelection.clear();
    const selected = this.edit?.view.selectedId ? this.furnitureSprites.get(this.edit.view.selectedId) : undefined;
    if (selected) {
      const def = FURNITURE[selected.kind];
      if (def) this.editSelection.rect(selected.x * TILE, selected.y * TILE, def.fw * TILE, def.fh * TILE).stroke({ color: 0xf2b33d, width: 1, alignment: 1 });
    }
    const placing = this.edit?.view.placingKind;
    this.ghost.visible = false;
    if (placing) this.dragItem = { kind: placing, grabDx: 0, grabDy: 0, moved: false };
    else if (this.dragItem && !this.dragItem.id) this.dragItem = undefined;
  }

  private drawEditGrid() {
    const g = this.editGrid;
    g.clear();
    const { scene } = this;
    const x0 = TILE;
    const x1 = (scene.cols - 1) * TILE;
    const y0 = scene.wallRows * TILE;
    const y1 = (scene.rows - 1) * TILE;
    for (let x = x0; x <= x1; x += TILE) g.rect(x, y0, 1, y1 - y0).fill({ color: 0xffffff, alpha: 0.12 });
    for (let y = y0; y <= y1; y += TILE) g.rect(x0, y, x1 - x0, 1).fill({ color: 0xffffff, alpha: 0.12 });
    const d = scene.door;
    g.rect(d.x * TILE + 1, d.y * TILE + 1, TILE - 2, TILE - 2).stroke({ color: 0x5cc77a, width: 1, alpha: 0.8 });
    for (const s of [...scene.meetingSpots, ...scene.loungeSpots]) g.circle(s.x * TILE + 8, s.y * TILE + 8, 2).fill({ color: 0x4fb3a9, alpha: 0.7 });
    for (const w of scene.workstations) g.rect(w.seat.x * TILE + 5, w.seat.y * TILE + 5, 6, 6).fill({ color: 0xf2b33d, alpha: 0.45 });
  }

  private tileAt(global: { x: number; y: number }) {
    const local = this.camera.toLocal(global);
    return { x: Math.floor(local.x / TILE), y: Math.floor(local.y / TILE) };
  }

  private ghostTexture(kind: string) {
    let t = this.ghostTextures.get(kind);
    if (!t) {
      const canvas = kind === 'desk' ? drawDesk(this.theme).canvas : FURNITURE[kind]?.draw(this.theme, 0).canvas;
      if (!canvas) return Texture.EMPTY;
      t = texture(canvas);
      this.ghostTextures.set(kind, t);
    }
    return t;
  }

  /** Moves the drag/placement ghost to follow the pointer, tinted by validity. */
  private updateGhost(global: { x: number; y: number }) {
    const drag = this.dragItem;
    if (!this.edit || !drag) return;
    const pointer = this.tileAt(global);
    const tile = { x: pointer.x - drag.grabDx, y: pointer.y - drag.grabDy };
    if (drag.tile && drag.tile.x === tile.x && drag.tile.y === tile.y) return;
    const def = FURNITURE[drag.kind];
    if (!def) return;
    if (drag.id) {
      const origin = this.furnitureSprites.get(drag.id);
      if (origin && (origin.x !== tile.x || origin.y !== tile.y)) drag.moved = true;
    }
    drag.tile = tile;
    if (drag.id && !drag.moved) {
      this.ghost.visible = false;
      return;
    }
    if (this.ghost.texture !== this.ghostTexture(drag.kind)) this.ghost.texture = this.ghostTexture(drag.kind);
    const height = this.ghost.texture.height;
    this.ghost.position.set(tile.x * TILE + def.ox, (tile.y + def.fh) * TILE + def.bottomPad - height);
    this.ghost.tint = this.edit.cb.validate({ id: drag.id, kind: drag.kind }, tile.x, tile.y) ? 0xa8ffb8 : 0xff7a7a;
    this.ghost.visible = true;
  }

  private finishEditPointer(onStage: boolean): boolean {
    const drag = this.dragItem;
    if (!this.edit || !drag) return false;
    if (drag.id) {
      this.dragItem = undefined;
      this.ghost.visible = false;
      if (drag.moved && drag.tile) this.edit.cb.onDrop(drag.id, drag.tile.x, drag.tile.y);
      return true;
    }
    if (onStage && drag.tile) {
      this.edit.cb.onPlace(drag.kind, drag.tile.x, drag.tile.y);
      return true;
    }
    return false;
  }

  // ───────────────────────────────── camera & input

  private applyCamera() {
    const { width, height } = this.app.screen;
    const dpr = this.app.renderer.resolution;
    this.camera.scale.set(this.zoom);
    // Snap to whole device pixels so pixel art never shimmers while panning.
    this.camera.position.set(Math.round((width / 2 - this.cx * this.zoom) * dpr) / dpr, Math.round((height / 2 - this.cy * this.zoom) * dpr) / dpr);
  }

  private clampCamera() {
    if (!this.scene) return;
    const W = this.scene.cols * TILE;
    const H = this.scene.rows * TILE;
    const { width, height } = this.app.screen;
    const halfW = width / 2 / this.zoom;
    const halfH = height / 2 / this.zoom;
    this.cx = W <= halfW * 2 ? W / 2 : Math.max(halfW - CAP * 4, Math.min(W - halfW + CAP * 4, this.cx));
    this.cy = H <= halfH * 2 ? H / 2 : Math.max(halfH - CAP * 4, Math.min(H - halfH + CAP * 4, this.cy));
  }

  fitZoom() {
    const W = this.scene.cols * TILE;
    const H = this.scene.rows * TILE;
    const { width, height } = this.app.screen;
    const fit = Math.max(1, Math.floor(Math.min(width / W, height / H)));
    this.zoom = Math.max(2, Math.min(6, fit));
    this.cx = W / 2;
    this.cy = H / 2;
    this.clampCamera();
    this.emitCamera();
  }

  zoomBy(step: 1 | -1, anchor?: { x: number; y: number }) {
    const index = ZOOMS.indexOf(this.zoom);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index + step))]!;
    if (next === this.zoom) return;
    if (anchor) {
      // keep the world point under the cursor fixed
      const wx = (anchor.x - this.camera.x) / this.zoom;
      const wy = (anchor.y - this.camera.y) / this.zoom;
      this.zoom = next;
      const { width, height } = this.app.screen;
      this.cx = wx - (anchor.x - width / 2) / next;
      this.cy = wy - (anchor.y - height / 2) / next;
    } else this.zoom = next;
    this.clampCamera();
    this.emitCamera();
  }

  panBy(dx: number, dy: number) {
    this.followId = undefined;
    this.cx += dx / this.zoom;
    this.cy += dy / this.zoom;
    this.clampCamera();
    this.emitCamera();
  }

  follow(id?: string) {
    this.followId = id;
    this.emitCamera();
  }

  private emitCamera() {
    this.callbacks.onCamera({ zoom: this.zoom, following: this.followId });
  }

  private installInput(host: HTMLElement) {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;
    stage.on('pointerdown', (e) => {
      if (this.edit && this.dragItem?.id) return; // dragging furniture, not the camera
      this.drag = { x: e.global.x, y: e.global.y, cx: this.cx, cy: this.cy, moved: false };
    });
    stage.on('globalpointermove', (e) => {
      if (this.edit) this.updateGhost(e.global);
      if (this.edit && this.dragItem?.id) return;
      if (!this.drag || !(e.buttons & 1)) return;
      const dx = e.global.x - this.drag.x;
      const dy = e.global.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true;
      this.followId = undefined;
      this.cx = this.drag.cx - dx / this.zoom;
      this.cy = this.drag.cy - dy / this.zoom;
      this.clampCamera();
      host.style.cursor = 'grabbing';
    });
    const end = () => {
      if (this.drag?.moved) this.emitCamera();
      this.drag = undefined;
      host.style.cursor = '';
    };
    stage.on('pointerup', (e) => {
      const clicked = this.drag && !this.drag.moved;
      if (this.edit) {
        const handled = this.finishEditPointer(!!clicked);
        if (!handled && clicked && e.target === stage) this.edit.cb.onPick(undefined);
      } else if (clicked && e.target === stage) {
        this.callbacks.onSelect(undefined);
        this.playerClick(this.tileAt(e.global));
      }
      end();
    });
    stage.on('pointerupoutside', () => {
      if (this.edit && this.dragItem?.id) this.finishEditPointer(false);
      end();
    });
    host.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = host.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          if (Math.abs(e.deltaY) > 2) this.zoomBy(e.deltaY < 0 ? 1 : -1, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else this.panBy(e.deltaX, e.deltaY);
      },
      { passive: false },
    );
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]') || this.edit) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS[k]) {
        this.keys.add(k);
        e.preventDefault();
      } else if (k === 'e' && !e.repeat) {
        this.playerInteract();
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const onBlur = () => this.keys.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    this.removeKeyListeners = () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }

  // ───────────────────────────────── people: you and your teammates

  private human(id: string): Human | undefined {
    return id === PLAYER_ID ? this.player : this.peers.get(id);
  }

  private *allHumans(): Generator<[string, Human]> {
    if (this.player) yield [PLAYER_ID, this.player];
    yield* this.peers;
  }

  private humanActors() {
    return [...this.allHumans()].map(([, h]) => h.actor);
  }

  private makeHuman(id: string, info: HumanInfo): Human {
    const record: AgentRecord = { id, name: info.name, role: 'generalist', origin: 'external', kind: 'agent', appearance: info.appearance, createdAt: 0 };
    const actor = new CharacterActor(record, characterTextures(info.appearance), worldTextures(), IDLE_INTENT, performance.now(), () =>
      id === PLAYER_ID ? this.callbacks.onPlayerClick?.() : this.callbacks.onSelect(id),
    );
    actor.hideIcon = true;
    this.entities.addChild(actor.root);
    this.overlay.addChild(actor.badge, actor.bubble);
    return { actor, badge: info.badge, appearanceKey: JSON.stringify(info.appearance) };
  }

  private refreshHuman(h: Human, info: HumanInfo) {
    const key = JSON.stringify(info.appearance);
    if (key !== h.appearanceKey) {
      h.appearanceKey = key;
      h.actor.setTextures(characterTextures(info.appearance));
    }
    h.actor.record = { ...h.actor.record, name: info.name, appearance: info.appearance };
    h.badge = info.badge;
  }

  /** Shows (or removes, with null) your own avatar. */
  setPlayer(info: HumanInfo | null) {
    if (!this.initialized) return;
    if (!info) {
      if (this.player) {
        this.vacate(this.player, PLAYER_ID);
        this.player.actor.destroy();
        this.player = undefined;
      }
      return;
    }
    if (this.player) this.refreshHuman(this.player, info);
    else {
      this.player = this.makeHuman(PLAYER_ID, info);
      if (this.arrival) this.arriveThrough(this.player, this.arrival);
      else this.placeAtDoor(this.player);
      this.arrival = undefined;
    }
  }

  /** Teammates currently in the office, with their last reported position. */
  syncPeers(list: PeerInfo[]) {
    if (!this.initialized) return;
    const ids = new Set(list.map((p) => p.id));
    for (const [id, h] of this.peers) {
      if (ids.has(id)) continue;
      this.vacate(h, id);
      h.actor.destroy();
      this.peers.delete(id);
    }
    for (const info of list) {
      let h = this.peers.get(info.id);
      if (!h) {
        h = this.makeHuman(info.id, info);
        this.peers.set(info.id, h);
      } else this.refreshHuman(h, info);
      h.target = info.presence;
    }
  }

  /** Your avatar's current position and pose, for sending to a newly joined room. */
  presence(): Presence | undefined {
    const h = this.player;
    if (!h?.actor.isVisible) return undefined;
    const it = h.seat ? this.interactables.find((i) => i.id === h.seat) : undefined;
    // Playing at the dice table travels as the arcade pose (standing at something, facing it).
    const pose: PoseKind = it ? (it.kind === 'desk' ? 'sit' : it.kind === 'dice' ? 'arcade' : it.kind) : h.actor.isWalking ? 'walk' : 'stand';
    const p: Presence = { x: Math.round(h.actor.x * 10) / 10, y: Math.round(h.actor.y * 10) / 10, facing: h.actor.currentFacing, pose };
    if (it) p.seat = it.id;
    return p;
  }

  private emitPresence() {
    const p = this.presence();
    if (!p || !this.callbacks.onPresence) return;
    const last = this.lastPresence;
    const now = performance.now();
    if (last && last.p.pose === p.pose && last.p.seat === p.seat && last.p.facing === p.facing && last.p.x === p.x && last.p.y === p.y) return;
    const structural = !last || last.p.pose !== p.pose || last.p.seat !== p.seat;
    if (!structural && now - last.at < 100) return; // ~10 updates/s while walking
    this.lastPresence = { p, at: now };
    this.callbacks.onPresence(p);
  }

  private placeAtDoor(h: Human) {
    const door = this.doorPoint();
    // A random spot just inside the door, so people arriving together don't stack up.
    const spots = [-1, 0, 1, 2].map((dx) => ({ x: this.scene.door.x + dx, y: this.scene.door.y + 1 })).filter((t) => this.nav.isWalkable(t.x, t.y));
    const tile = spots[Math.floor(Math.random() * spots.length)] ?? { x: this.scene.door.x, y: this.scene.door.y + 1 };
    h.actor.spawnAt(door);
    h.actor.stand({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + 12, tile, facing: 'down' });
  }

  /** Is the floor free for someone's feet at (x, y)? Checks a small box around the feet. */
  private freeAt(x: number, y: number) {
    for (const [ox, oy] of [
      [-4, -2],
      [4, -2],
      [-4, 2],
      [4, 2],
    ] as const) {
      if (!this.nav.isWalkable(Math.floor((x + ox) / TILE), Math.floor((y + oy - 4) / TILE))) return false;
    }
    return true;
  }

  private occupantOf(it: Interactable) {
    if (it.kind === 'desk') return this.stations.find((s) => s.ws.id === it.workstationId)?.occupant;
    return this.seatUsers.get(it.id);
  }

  /** Puts a person on a chair, sofa place or arcade. Agents give way; other people don't. */
  private occupy(h: Human, id: string, it: Interactable): boolean {
    if (it.kind === 'desk') {
      const station = this.stations.find((s) => s.ws.id === it.workstationId);
      if (!station) return false;
      if (station.occupant && station.occupant !== id) {
        if (!this.actors.has(station.occupant)) return false;
        this.releaseStation(station.occupant); // the agent walks to another desk
      }
      station.occupant = id;
    } else {
      const user = this.seatUsers.get(it.id);
      if (user && user !== id) return false;
      this.seatUsers.set(it.id, id);
    }
    h.seat = it.id;
    const a = h.actor;
    if (it.kind === 'arcade' || it.kind === 'dice') {
      a.stand({ x: it.x, y: it.y, tile: it.approach, facing: 'up' });
      a.standAnim = 'stand_play_back';
      a.scheduler.current = IDLE_INTENT;
      if (id === PLAYER_ID) (it.kind === 'dice' ? this.callbacks.onDice : this.callbacks.onArcade)?.();
    } else {
      a.sit({ x: it.x, y: it.y, tile: it.approach, facing: it.facing === 'up' ? 'up' : 'down', z: it.z });
      a.scheduler.current = it.kind === 'desk' ? TYPING_INTENT : IDLE_INTENT;
    }
    return true;
  }

  /** Gets up from whatever the person is using and stands in front of it. */
  private vacate(h: Human, id: string) {
    if (!h.seat) return;
    const it = this.interactables.find((i) => i.id === h.seat);
    if (it?.kind === 'desk') {
      const station = this.stations.find((s) => s.ws.id === it.workstationId);
      if (station?.occupant === id) station.occupant = undefined;
    } else if (this.seatUsers.get(h.seat) === id) this.seatUsers.delete(h.seat);
    h.seat = undefined;
    h.actor.standAnim = undefined;
    h.actor.scheduler.current = IDLE_INTENT;
    if (it) h.actor.stand({ x: it.approach.x * TILE + TILE / 2, y: it.approach.y * TILE + 12, tile: it.approach, facing: 'down' });
  }

  private playerClick(tile: TilePoint) {
    const h = this.player;
    if (!h || this.edit || this.doorAnim) return;
    // A click on a door (on the wall or the floor in front of it) walks you through it.
    const door = this.doors.find((d) => tile.x >= d.tile.x && tile.x <= d.tile.x + 1 && tile.y >= 1 && tile.y <= d.tile.y);
    if (door) {
      this.vacate(h, PLAYER_ID);
      h.pending = undefined;
      const t = h.actor.tile();
      if (t.x === door.tile.x && t.y === door.tile.y) return this.callbacks.onDoor?.(door.id);
      h.pendingDoor = door.id;
      h.walkTarget = door.tile;
      h.actor.walkTo(this.nav, door.tile, 'player', [door.tile]);
      return;
    }
    const it = interactableAt(this.interactables, tile);
    if (it) return this.playerUse(it);
    if (!this.nav.isWalkable(tile.x, tile.y)) return;
    this.vacate(h, PLAYER_ID);
    h.pending = undefined;
    h.pendingDoor = undefined;
    h.walkTarget = tile;
    h.actor.walkTo(this.nav, tile, 'player', [tile]);
  }

  /** Doors in this scene (lobby doors, or an office's way out). */
  setDoors(doors: WorldDoor[]) {
    if (!this.initialized) return;
    this.doors = doors;
    for (const [id, sign] of this.doorSigns) {
      if (doors.some((d) => d.id === id && d.label)) continue;
      sign.root.destroy({ children: true });
      this.doorSigns.delete(id);
    }
    for (const d of doors) {
      if (!d.label) continue;
      let sign = this.doorSigns.get(d.id);
      if (!sign) {
        const root = new Container();
        const bg = new Graphics();
        const text = new Text({ text: '', style: { fontFamily: SIGN_FONT, fontSize: 11, fontWeight: '700', fill: 0xfdf6e3 } });
        root.addChild(bg, text);
        root.eventMode = 'none';
        this.overlay.addChild(root);
        sign = { root, bg, text, key: '' };
        this.doorSigns.set(d.id, sign);
      }
      if (sign.key !== d.label) {
        sign.key = d.label;
        sign.text.text = d.label;
        const w = Math.ceil(sign.text.width + 14);
        sign.bg.clear();
        sign.bg.roundRect(-w / 2, -20, w, 20, 5).fill({ color: 0x1b1a24, alpha: 0.88 });
        sign.bg.roundRect(-w / 2, -20, w, 20, 5).stroke({ color: 0xe0a93d, alpha: 0.6, width: 1 });
        sign.text.position.set(-w / 2 + 7, -18);
      }
    }
  }

  /** Walks the player through a door (it swings open if it's a closed one); resolves when they're gone. */
  enterDoor(id: string): Promise<void> {
    const door = this.doors.find((d) => d.id === id);
    const h = this.player;
    if (!door || !h?.actor.isVisible || this.reduceMotionNow()) return Promise.resolve();
    this.vacate(h, PLAYER_ID);
    return new Promise((done) => {
      this.doorAnim = { tile: door.tile, start: performance.now(), fromX: h.actor.x, fromY: h.actor.y, done, opens: !!door.opens };
    });
  }

  /** The next scene brings the player in through the door in front of `tile`. */
  arriveVia(tile: TilePoint) {
    this.arrival = tile;
  }

  private reduceMotionNow() {
    return this.options.reduceMotion;
  }

  private arriveThrough(h: Human, tile: TilePoint) {
    const a = h.actor;
    a.spawnAt({ x: tile.x * TILE + TILE, y: tile.y * TILE + 2 });
    a.halt('down');
    const inside = { x: tile.x, y: Math.min(tile.y + 2, this.scene.rows - 2) };
    const target = this.nav.isWalkable(inside.x, inside.y) ? inside : (this.nav.nearestWalkable(inside) ?? tile);
    h.walkTarget = target;
    h.pendingDoor = undefined;
    a.walkTo(this.nav, target, 'player', [target]);
    const now = performance.now();
    this.arrivalOpenUntil = now + 900;
    this.arrivalGraceUntil = now + 1500;
    this.doorUnder = undefined;
  }

  private updateDoorAnim(now: number) {
    const g = this.doorOpen;
    g.clear();
    const anim = this.doorAnim;
    const drawOpen = (tile: TilePoint) => {
      const wallH = this.scene.wallRows * TILE;
      const x = tile.x * TILE;
      g.rect(x, 10, 32, wallH - 10).fill(0x15131c);
      g.rect(x, wallH - 10, 32, 10).fill({ color: 0xffe2a8, alpha: 0.18 });
      g.rect(x, 10, 5, wallH - 10).fill(0x8a5a35);
    };
    if (anim) {
      const h = this.player;
      const t = Math.min(1, (now - anim.start) / 550);
      if (anim.opens) drawOpen(anim.tile);
      if (h) {
        const tx = anim.tile.x * TILE + TILE;
        const ty = anim.tile.y * TILE + 2;
        h.actor.stepTo(anim.fromX + (tx - anim.fromX) * t, anim.fromY + (ty - anim.fromY) * t, 'up');
        h.actor.root.alpha = 1 - Math.max(0, t - 0.5) * 2;
      }
      if (t >= 1) {
        this.doorAnim = undefined;
        if (h) {
          h.actor.halt('down');
          h.actor.root.alpha = 1;
        }
        anim.done();
      }
      return;
    }
    if (now < this.arrivalOpenUntil) {
      const d = this.doors.find((x) => x.opens);
      const pt = this.player?.actor.tile();
      const near = d && pt ? this.doors.filter((x) => x.opens).sort((a, b) => Math.abs(a.tile.x - pt.x) - Math.abs(b.tile.x - pt.x))[0] : undefined;
      if (near) drawOpen(near.tile);
    }
  }

  private playerUse(it: Interactable) {
    const h = this.player;
    if (!h) return;
    if (h.seat === it.id) {
      this.vacate(h, PLAYER_ID);
      return;
    }
    const occupant = this.occupantOf(it);
    if (occupant && occupant !== PLAYER_ID && !this.actors.has(occupant)) return; // a teammate is using it
    if (occupant && this.actors.has(occupant)) return; // an agent is working there
    this.vacate(h, PLAYER_ID);
    h.pending = it.id;
    const t = h.actor.tile();
    if (t.x === it.approach.x && t.y === it.approach.y) this.arrive(h);
    else h.actor.walkTo(this.nav, it.approach, 'player', [it.approach]);
  }

  /** E: use the nearest thing within reach, or get up. */
  private playerInteract() {
    const h = this.player;
    if (!h?.actor.isVisible) return;
    if (h.seat) {
      this.vacate(h, PLAYER_ID);
      return;
    }
    const t = h.actor.tile();
    const near = this.interactables
      .map((it) => ({ it, d: Math.max(Math.abs(it.approach.x - t.x), Math.abs(it.approach.y - t.y)) }))
      .filter((c) => c.d <= 1 && !this.occupantOf(c.it))
      .sort((a, b) => a.d - b.d)[0];
    if (near) this.playerUse(near.it);
  }

  private arrive(h: Human) {
    h.actor.halt();
    const id = h.pending;
    h.pending = undefined;
    const it = id ? this.interactables.find((i) => i.id === id) : undefined;
    if (it && (!this.occupantOf(it) || this.occupantOf(it) === PLAYER_ID)) this.occupy(h, PLAYER_ID, it);
  }

  private updatePlayer(dt: number) {
    const h = this.player;
    if (!h) return;
    const a = h.actor;
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const v = MOVE_KEYS[k];
      if (v) {
        dx += v[0];
        dy += v[1];
      }
    }
    if ((dx || dy) && !this.edit) {
      if (h.seat) this.vacate(h, PLAYER_ID);
      h.pending = undefined;
      const len = Math.hypot(dx, dy);
      let x = a.x;
      let y = a.y;
      // Small sub-steps so a long frame can't carry you through thin furniture.
      let remaining = (PLAYER_SPEED * dt) / 1000;
      while (remaining > 0) {
        const step = Math.min(2, remaining);
        remaining -= step;
        const nx = x + (dx / len) * step;
        const ny = y + (dy / len) * step;
        const stuck = !this.freeAt(x, y);
        if (stuck || this.freeAt(nx, y)) x = nx;
        if (stuck || this.freeAt(x, ny)) y = ny;
      }
      const facing: Facing = dx ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      a.stepTo(x, y, facing);
      this.keyMoving = true;
      h.walkTarget = undefined;
      h.pendingDoor = undefined;
      this.checkDoor(h);
      if (this.followId !== PLAYER_ID) {
        this.followId = PLAYER_ID;
        this.emitCamera();
      }
      return;
    }
    if (this.keyMoving) {
      this.keyMoving = false;
      a.halt();
    }
    if (this.doorAnim) return;
    if (a.move(dt) === 'arrived' && a.arrivedKind === 'player') {
      h.walkTarget = undefined;
      const door = h.pendingDoor;
      h.pendingDoor = undefined;
      if (door) {
        a.halt('up');
        this.doorUnder = door;
        this.callbacks.onDoor?.(door);
      } else this.arrive(h);
    }
  }

  /** Stepping onto a door tile (by keyboard) goes through it, once per visit. */
  private checkDoor(h: Human) {
    const t = h.actor.tile();
    const door = this.doors.find((d) => d.tile.x === t.x && d.tile.y === t.y);
    if (!door) {
      this.doorUnder = undefined;
      return;
    }
    if (this.doorUnder === door.id || performance.now() < this.arrivalGraceUntil || this.doorAnim) return;
    this.doorUnder = door.id;
    this.keys.clear();
    this.callbacks.onDoor?.(door.id);
  }

  private updatePeer(id: string, h: Human, dt: number) {
    const p = h.target;
    const a = h.actor;
    if (!p) {
      if (a.isVisible) {
        this.vacate(h, id);
        a.hide();
      }
      return;
    }
    const it = p.seat && p.pose !== 'walk' && p.pose !== 'stand' ? this.interactables.find((i) => i.id === p.seat) : undefined;
    if (it) {
      if (h.seat === it.id) return;
      this.vacate(h, id);
      if (!a.isVisible) a.spawnAt(it);
      if (this.occupy(h, id, it)) return;
    } else if (h.seat) this.vacate(h, id);
    if (!a.isVisible) {
      a.spawnAt(p);
      a.halt(p.facing);
    }
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 96) {
      a.stand({ x: p.x, y: p.y, tile: { x: Math.floor(p.x / TILE), y: Math.floor((p.y - 4) / TILE) }, facing: p.facing });
      return;
    }
    if (dist < 0.5) {
      if (p.pose === 'walk') a.stepTo(p.x, p.y, p.facing);
      else if (a.isWalking || a.currentFacing !== p.facing) a.halt(p.facing);
      return;
    }
    const step = Math.min(dist, (PEER_SPEED * dt) / 1000);
    const facing: Facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    a.stepTo(a.x + (dx / dist) * step, a.y + (dy / dist) * step, facing);
  }

  /** A speech bubble over an agent or person (e.g. how long they've worked, on click). */
  say(id: string, text: string) {
    const actor = this.actors.get(id) ?? this.human(id)?.actor;
    if (actor?.isVisible) actor.say(text, performance.now());
  }

  /** World → host-element coordinates of an agent's head, for DOM popovers. */
  agentScreenPosition(id: string) {
    const a = this.actors.get(id);
    if (!a?.isVisible) return null;
    return { x: this.camera.x + a.x * this.zoom, y: this.camera.y + (a.y - 36) * this.zoom };
  }

  destroy() {
    this.destroyed = true;
    this.removeKeyListeners?.();
    if (!this.initialized) return;
    for (const a of [...this.actors.values(), ...this.departing.values(), ...this.humanActors()]) a.destroy();
    this.actors.clear();
    this.departing.clear();
    this.app.destroy(true, { children: true });
  }
}

/** A teammate's anonymous agent (`peer:<member>:<n>`), as opposed to your own. */
const isPeerAgent = (id: string) => /^peer:[^:]+:\d+$/.test(id);

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function dotCanvas(color: string) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return c;
}

function rainCanvas() {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9fb4ff';
  ctx.fillRect(0, 0, 1, 4);
  return c;
}

export type { TilePoint };

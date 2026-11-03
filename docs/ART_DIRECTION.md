# Art direction — modern hi-res pixel art

## Identity

Cozy American indie sim: warm studio interiors, controlled palettes, soft pools of light, expressive small characters. Detail comes from **hue-shifted shading, selective outlines, banded lighting and environmental storytelling**, not from low resolution.

Original work only — no third-party sprites, no traced references.

## Projection & grid

- **Three-quarter top-down** (front-facing walls, top + front faces on objects; light from the upper left).
- Tile: **16 × 16 art px**. Rooms are 30 × 20 tiles (480 × 320 art px); the back wall is 4 tiles tall.
- Depth: everything in the entity layer is sorted by its floor contact y (`zIndex`). Seated characters use explicit z so desks and chair backs occlude correctly.

## Scaling & crispness

- Art is drawn at native resolution and displayed at **integer zoom 1–6×** with `nearest` sampling (`TextureSource.defaultOptions.scaleMode`).
- Pixi renders at `devicePixelRatio`; the camera position is snapped to whole **device** pixels each frame (`applyCamera`), and sprite positions are rounded to whole **art** pixels. No fractional scaling, no shimmer.
- `image-rendering: pixelated` on the canvas and on every UI portrait.

## Palette & shading

- Master palette in `game/assets/palette.ts` (skin, hair, outfit) and per-theme palettes in `game/assets/themes.ts`.
- `shade(color, amount)` applies hue shifting: shadows drift toward violet, highlights toward warm yellow.
- **Selective outline** (`PixelCanvas.outline`): every sprite gets a 1 px outline coloured as a darkened version of the adjacent pixel — consistent thickness, never pure black.
- Lighting is **banded** (`bandedRadial`): 4–5 hard alpha steps instead of smooth gradients.

## Characters

| Property | Value |
|---|---|
| Frame | 24 × 36 px, anchor at feet (12, 35) |
| Proportions | ~1 : 2.6 head-to-body, 12 px head |
| Views | front, back, side (right = mirrored left) |
| Layers | long-hair-behind → legs/shoes → torso → back arm → head/face → hair → accessory → front arm → props |
| Animations | idle, walk (4 frames), sit-front/sit-back × {idle, type, read, think, plan, debug, raise hand, cheer, slump}, stand raise/cheer/talk |

Because every layer shares the same frame and anchors, any combination of hair × top × bottom × shoes × accessory aligns on every frame. Equipment (laptop, dual monitor, debug rig…) is drawn on the desk, not on the body, and is purely visual.

## Environments

| Theme | Floor / walls | Light |
|---|---|---|
| Cozy Startup Loft | oak planks, exposed brick, steel-frame windows over a city | sun shafts with dust motes, pendant lamps |
| Silicon Valley Creative Studio | pale stone tiles, plaster + timber slats, wall whiteboard, window onto golden hills | bright, airy |
| Midnight Developer Lab | indigo carpet tiles, panelled walls with LED trim, neon `</>` sign, rainy night city | darkness lightmap with banded holes; monitor glows are additive and tinted by activity |

Monitors show live **decorative** screen states (code, docs, terminal, question, success, error) keyed only to the visual intent — never real output.

## UI typography

- UI text: system stack (`-apple-system`, `PingFang TC`, `Noto Sans TC`). Chinese is never rendered in a pixel font.
- `Pixelify Sans` (OFL, bundled via `@fontsource`) only for the English wordmark and the Latin "DEMO" watermark.
- World labels are screen-space `Text` so they stay sharp at any zoom.

## Asset pipeline & licensing

- All sprites are generated at startup by deterministic functions (`game/assets`, `game/furniture`, `game/scenes/room.ts`) and cached as textures (`engine/textures.ts`).
- To replace with hand-authored sheets: keep frame size/anchors and register textures under the same `AnimName`/furniture keys; nothing else changes.
- Fonts: Pixelify Sans (SIL OFL 1.1). No other third-party art.

## Known limitations

- Procedural art is coherent but less nuanced than hand-drawn sheets (faces have limited expression range; furniture has one rotation).
- Side-view seated poses are not used (desks face up or down only).

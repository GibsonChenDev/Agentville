# Team office ／ 團隊辦公室

A team office lets several people share one Agentville office. Everyone has their own character (walk with **W A S D** or by clicking the floor, sit at desks, on sofas and beanbags, play the arcade), and everyone sees how many agents their teammates have working. Each teammate's agents show up as anonymous characters at desks.

團隊辦公室讓多人共用同一間 Agentville 辦公室：每個人都有自己的人物（**W A S D** 或點擊地板走路，可以坐辦公桌、沙發、懶骨頭，或玩遊戲機），並能看到隊友各有幾個 agent 在工作。隊友的 agent 會以匿名角色坐在辦公桌前。

## Privacy ／ 隱私

What leaves your computer while you're in a team office, and nothing else:

| Shared | Never shared |
|---|---|
| Your nickname and character look | Prompts, assistant messages, tool calls and their inputs |
| Your character's position and pose (e.g. "sitting at desk ws-b1") | File names, project paths, repositories, branches |
| **How many** of your live agents are in the office (a number 0–32) | Session ids, agent names, statuses, errors, history |
| Office edits you save (theme and furniture layout) | Anything from the Monitor Mode receiver |

This is enforced in three places: the app only ever builds the messages in `packages/team-protocol`; the relay re-parses every frame against those shapes and drops anything else (extra fields are stripped, unknown messages rejected); and the relay stores only member names, looks, a SHA-256 hash of each member's token, and the shared layouts.

## Using it ／ 使用方式

1. One person: sidebar → **Team office / 團隊辦公室 → Create / 建立**. Enter a team name and your nickname. You get an invite code like `AGV-7K3P-Q9M2`.
2. Send the code to teammates. They choose **Join / 加入**, enter the code and a nickname — once; the app reconnects automatically on every launch.
3. The code stays the same until the creator chooses **Generate a new code** (the old code stops working; people already in stay in).
4. **Leave / 離開** removes you from the office and brings back your own local layouts. When the last member leaves, the office is deleted on the server.

Anyone in the office can switch the map or edit the furniture; changes appear for everyone and the last save wins.

Controls: `W A S D` walk · click the floor to walk there · click a chair, sofa, beanbag or arcade to use it · `E` use the nearest thing / get up · click your own character to change your look.

## Accounts, coins and the shop ／ 帳號、金幣與商店

- **Account without sign-up.** On first launch the app asks the relay for a new account and gets back a 25-character **recovery code** (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, 125 random bits). The code is the only credential: the server stores the account under a hash of it and never stores the code itself. Settings → Account shows it; typing it on another computer restores the character, coins, purchases, team offices and arcade records.
- **Coins.** Every turn a live agent finishes (Claude Code's `Stop` hook) earns 10 coins, plus 1 per tool used during that turn (bonus capped at 10). The server enforces the limits — at most one turn per 15 s on average (burst of 10) and 500 coins per day — so forged events can't farm coins. New accounts start with 200.
- **Shop.** Accessories (flower, cat ears, wizard hat, crown), outfit colours (neon, gold) and decorations (lava lamp, trophy, office cat, jukebox, aquarium). Prices live in `packages/team-protocol/src/account.ts` (`CATALOG`). Everything that was free before stays free.
- **Arcade.** Snake, Breakout, Flappy and 2048 on every arcade cabinet; best scores are saved to the account.

## Lobby ／ 大廳

Walking out of an office's door leads to the lobby hallway: one door for your office, one per team office, and "＋ New office" (create or join). Walking into a door fades to the office and you walk in through its door. The app reopens in the last office you were in.

## The relay server ／ 轉發伺服器

`server/relay` is a Cloudflare Worker with two SQLite-backed Durable Objects:

- **Room** — one per team office: members, the shared theme and layouts, and live presence over [hibernatable WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) (idle rooms cost nothing; keep-alive pings are answered without waking the room).
- **Directory** — one global instance mapping invite codes to rooms and limiting wrong-code guesses (10 per IP per 10 minutes) and new accounts (30 per IP per hour).
- **Account** — one per account: profile, coins, inventory, team-office memberships and best scores (pure rules in `packages/team-protocol/src/account.ts`, unit-tested).

Room logic lives in `src/roomCore.ts` with no Cloudflare dependencies and is unit-tested in `src/roomCore.test.ts`.

### HTTP API

| Method | Path | Body / auth | Result |
|---|---|---|---|
| GET | `/v1/health` | — | `{ ok, version }` |
| POST | `/v1/rooms` | `{ roomName, name, appearance }` | `{ roomId, memberId, token, owner: true }` |
| POST | `/v1/join` | `{ code, name, appearance }` | `{ roomId, memberId, token, owner: false }` · 404 `invalid_code` · 409 `room_full` · 429 `rate_limited` |
| POST | `/v1/rooms/:id/rotate` | `Authorization: Bearer <token>` (creator only) | `{ code }` |
| POST | `/v1/rooms/:id/leave` | `Authorization: Bearer <token>` | `{ ok: true }` |
| GET | `/v1/rooms/:id/ws` | WebSocket; first frame `{ t: "auth", token, v: 1 }` | live messages, see `packages/team-protocol` |
| POST | `/v1/accounts` | — | `{ code, account }` (new account) |
| GET | `/v1/me` | `Authorization: Bearer <recovery code>` | `{ account }` |
| POST | `/v1/me/profile` · `/earn` · `/buy` · `/rooms` · `/score` | `{ name, appearance }` · `{ turns, tools }` · `{ item }` · `{ rooms }` · `{ game, score }` | `{ account }` (earn also returns `credited`) |

Limits: 50 members per office, 64 KB per message, 30 messages/s per connection (burst 60).

### Deploy your own ／ 部署

Needs a free Cloudflare account. From the repository root:

```bash
cd server/relay
npm ci
npx wrangler login      # opens the browser once
npm run deploy          # prints https://agentville-relay.<your-subdomain>.workers.dev
```

Then either enter that address under **Server settings** when creating/joining, or set it as `DEFAULT_TEAM_SERVER` in `apps/desktop/src/team/teamStore.ts` before building the app so your team never has to type it.

Free-plan usage is far above what a small team needs: messages are only sent while someone moves (≈10/s while walking, nothing while standing still).

### Run locally ／ 本機測試

```bash
cd server/relay && npm run dev          # http://127.0.0.1:8787
node scripts/team-smoke.mjs             # two-client end-to-end check (from the repo root)
```

In the app, enter `http://127.0.0.1:8787` as the server (plain `http://` is accepted only for 127.0.0.1/localhost).

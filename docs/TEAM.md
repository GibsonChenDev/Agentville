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
- **Shop.** 15 accessories, 8 outfit colours and 21 office decorations. Prices and per-person limits live in `packages/team-protocol/src/account.ts` (`CATALOG`, `max`): looks can be owned once; decorations 1–5 copies each, enforced by the server (`limit_reached`). Each copy is one piece in an office: in your own office every copy is yours; in a team office pieces are tagged with the buyer (`item-<account id prefix>-u<n>`), so teammates' purchases don't use up yours. Everything that was free before stays free.
- **Dice table.** Every built-in office has one (more can be bought). 壓大小 (three dice, 4–10 small / 11–17 big, triples go to the house) and 擲骰子比點數 (two dice each against the dealer, ties push), both paying 1:1. The relay rolls the dice (`POST /v1/me/dice`); bets are 1, 2, 5 or 10 coins, one roll per 1.2 s, and each day's net result is capped at ±100 (`DICE` in `account.ts`), so nobody gets rich or goes broke at the table.
- **Arcade.** Snake, Breakout, Flappy and 2048 on every arcade cabinet; best scores are saved to the account and shared with the team office you're in (shown on each game card, kept while the player is offline).

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
| POST | `/v1/me/profile` · `/earn` · `/buy` · `/rooms` · `/score` · `/dice` | `{ name, appearance }` · `{ turns, tools }` · `{ item }` · `{ rooms }` · `{ game, score }` · `{ game, bet, pick? }` | `{ account }` (earn also returns `credited`, dice returns `result`) |

Limits: 50 members per office, 64 KB per message, 30 messages/s per connection (burst 60).

Ghost connections: a socket silent for 100 s (the app pings every 30 s) — e.g. a laptop that went to sleep — is closed by a sweep that runs every minute while anyone is connected, and its member is shown offline. The app reconnects when it wakes.

### Edge cases ／ 邊緣情況

| Situation | What happens | Tests |
|---|---|---|
| More agents than desks | Your own agents get desks first (a teammate's agent gives its desk up); the rest wait on their own open-floor tile near the door ("No free desk — waiting") and walk over when a desk frees up. At most 40 teammates' agents are drawn, shared round-robin between teammates. | `crowd.test.ts`, `team/edgeCases.test.ts` |
| A teammate leaves or closes the app | They go offline at once; their agents walk out of the door. A sleeping laptop is dropped by the ghost sweep. Coming back within a minute isn't welcomed again. | `relay/edgeCases.test.ts` |
| Arcade best scores | Shared with everyone in the office and late joiners; only ever go up; invalid scores are rejected. | `relay/edgeCases.test.ts` |
| Outfits and furniture | Visible to everyone; a decoration unknown to an older app is skipped instead of discarding the whole layout. | both edge-case test files |
| The app (or its receiver) restarts while an agent is working | The agent is shown as departed until its next hook, then picks up where it is. Hook numbering restarts with every receiver boot, so restored sessions forget their old numbers; an agent marked away after 5 silent minutes comes back on its next hook. A session that really ended isn't revived by a late hook. | `integration/reconnect.test.ts` |
| One person switches the map | In a team office the map is shared, so it changes for everyone (and late joiners). In your own office it affects nobody. A map unknown to an older app falls back to that person's own map. | both edge-case test files |

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

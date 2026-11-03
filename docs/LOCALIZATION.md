# Localization

Supported UI locales: **English (`en`)** and **Traditional Chinese (`zh-TW`)**. Simplified Chinese is never substituted.

## Configuration

- `apps/desktop/src/i18n/index.ts` — i18next + react-i18next, namespaces `common`, `agents`, `tasks`, `office`, `settings`, `errors`.
- Resources: `apps/desktop/src/locales/{en,zh-TW}/<namespace>.json`.
- Preference: `system` (default) | `en` | `zh-TW`, persisted in preferences and applied immediately via `applyLocale()` — no restart, no effect on running agents or the demo.
- System mapping (`resolveSystemLocale`): `zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant*` → `zh-TW`; `zh-CN`/`zh-Hans` → English (not Traditional); anything else → English.
- `<html lang>` follows the active locale so CJK typography rules apply.

## Conventions

- Domain enums (statuses, roles, event kinds, tool categories) are language-neutral; they are translated only at the presentation boundary with keys like `agents:status.waiting_for_permission`.
- Dynamic values use interpolation (`{{name}}`) and plurals (`_one` / `_other`); no string concatenation of translated fragments.
- User-authored content (agent names, prompts, paths, commands, tool output, model messages) is **never translated** and is rendered as plain text.
- Dates/times use `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` with the active locale.
- The PixiJS world receives already-localized labels through `OfficeWorld.sync()` and re-renders on `languageChanged`.
- Chinese text always uses the system CJK fonts (PingFang TC); the pixel display font is reserved for Latin wordmarks.

## Glossary

| Concept | English | 繁體中文 |
|---|---|---|
| Agent | Agent | Agent（不翻譯） |
| Subagent | Subagent | 子 Agent |
| Session | Session | 工作階段 |
| Prompt | Prompt | 提示 |
| Tool | Tool | 工具 |
| Permission / approve / deny | Permission / Approve / Deny | 權限／核准／拒絕 |
| Waiting for approval | Waiting for approval | 等待核准 |
| Managed | Managed | 受管理 |
| Monitored external | Monitored external | 外部監看 |
| Demo | Demo | 示範 |
| Workspace | Workspace | 工作區 |
| Office | Office | 辦公室 |
| Workstation | Workstation | 工作站 |
| Activity log | Activity | 活動紀錄 |
| Task | Task | 任務 |
| Customize outfit | Customize outfit | 自訂服裝 |
| Edit office | Edit office | 編輯辦公室 |
| Cancel execution | Cancel execution | 取消執行 |
| Disconnected | Disconnected | 已中斷連線 |

## Verification

- `npm run i18n:check` — key parity, non-empty values, identical interpolation variables, and a guard against common Simplified-only characters in zh-TW.
- `apps/desktop/src/i18n/i18n.test.ts` — locale resolution + parity (runs in `npm test`).
- Manual: Settings → Language toggled during an active demo; sidebar, toolbar, inspector, console, world badges and dialogs all switch without losing state.

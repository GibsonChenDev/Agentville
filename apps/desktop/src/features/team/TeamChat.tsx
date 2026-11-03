import { LIMITS, cleanChat, type ChatMessage } from '@agentville/team-protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { team } from '../../team/teamClient';
import { useTeam } from '../../team/teamStore';

const NAME_COLORS = ['text-[#7fd1ff]', 'text-[#c7a3ff]', 'text-[#ff8fb8]', 'text-[#7dff9a]', 'text-[#ffd166]', 'text-[#ff8a3d]'];
const nameColor = (id: string) => NAME_COLORS[([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0) % NAME_COLORS.length];

function when(at: number, locale: string) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(locale, today ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** The team office's group chat: a button with an unread count, opening a window with the recent conversation. */
export function TeamChat() {
  const { t, i18n } = useTranslation('team');
  const open = useTeam((s) => s.chatOpen);
  const chat = useTeam((s) => s.chat);
  const unread = useTeam((s) => s.chatUnread);
  const notice = useTeam((s) => s.chatNotice);
  const online = useTeam((s) => s.status === 'online');
  const me = useTeam((s) => s.membership?.memberId);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, chat.length]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const send = () => {
    const text = cleanChat(draft);
    if (!text) return;
    if (team.sendChat(text)) setDraft('');
  };

  if (!open) {
    return (
      <button
        onClick={() => useTeam.getState().setChatOpen(true)}
        className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-panel/95 px-3.5 py-2 text-[12.5px] font-semibold shadow-lg ring-1 ring-line-strong backdrop-blur hover:bg-panel-3"
        aria-label={unread ? t('chat.openUnread', { count: unread }) : t('chat.open')}
      >
        💬 {t('chat.title')}
        {unread > 0 && <span className="min-w-[18px] rounded-full bg-coral px-1.5 text-center text-[11px] leading-[18px] text-ink tabular-nums">{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }

  const row = (m: ChatMessage) => {
    const mine = m.from === me;
    return (
      <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div className="mb-0.5 flex items-baseline gap-1.5 text-[10.5px]">
          <span className={`font-semibold ${mine ? 'text-amber' : nameColor(m.from)}`}>{mine ? t('chat.you') : m.name}</span>
          <span className="text-faint tabular-nums">{when(m.at, i18n.language)}</span>
        </div>
        <div className={`max-w-[240px] rounded-xl px-2.5 py-1.5 text-[12.5px] leading-snug break-words whitespace-pre-wrap ${mine ? 'rounded-tr-sm bg-amber/90 text-ink' : 'rounded-tl-sm bg-panel-3 text-fg'}`}>{m.text}</div>
      </li>
    );
  };

  return (
    <section className="absolute right-3 bottom-3 flex h-[min(420px,calc(100%-80px))] w-[320px] flex-col rounded-xl bg-panel/95 shadow-2xl ring-1 ring-line-strong backdrop-blur" aria-label={t('chat.title')}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold">💬 {t('chat.title')}</span>
        <span className="truncate text-[11px] text-faint">{t('chat.kept', { count: LIMITS.chatHistory })}</span>
        <button onClick={() => useTeam.getState().setChatOpen(false)} className="ml-auto rounded px-1.5 text-[16px] leading-none text-muted hover:text-fg" aria-label={t('common:actions.close')}>
          ×
        </button>
      </header>
      <div ref={list} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {chat.length ? <ol className="space-y-2">{chat.map(row)}</ol> : <p className="mt-8 text-center text-[12px] text-faint">{t('chat.empty')}</p>}
      </div>
      {(notice || !online) && (
        <p className="px-3 pb-1 text-[11.5px] text-coral" role="status">
          {notice === 'rate_limited' ? t('chat.rateLimited') : t('chat.offline')}
        </p>
      )}
      <form
        className="flex items-center gap-1.5 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={input}
          value={draft}
          maxLength={LIMITS.chatLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter while an input method (注音, 拼音…) is still composing picks a word; it must not send.
            if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              useTeam.getState().setChatOpen(false);
            }
          }}
          placeholder={t('chat.placeholder')}
          className="min-w-0 flex-1 rounded-md bg-ink/60 px-2.5 py-1.5 text-[12.5px] ring-1 ring-line outline-none focus:ring-amber/60"
          aria-label={t('chat.placeholder')}
        />
        <button type="submit" disabled={!cleanChat(draft) || !online} className="rounded-md bg-amber px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40">
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}

import { useEffect } from 'react';
import { worldApi } from '../features/office/worldApi';
import { inMode, useApp } from '../state/store';

/** Global keyboard shortcuts; ignored while typing in form fields. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const s = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        s.toggleSettings(true, 'general');
        return;
      }
      // Dialogs (settings, the arcade, the shop…) own the keyboard while open.
      if (e.metaKey || e.ctrlKey || e.altKey || s.settingsOpen || document.querySelector('dialog[open]')) return;
      const world = worldApi.current;
      const pan = 48;
      switch (e.key) {
        case '+':
        case '=':
          world?.zoomBy(1);
          break;
        case '-':
        case '_':
          world?.zoomBy(-1);
          break;
        case 'ArrowLeft':
          world?.panBy(-pan, 0);
          break;
        case 'ArrowRight':
          world?.panBy(pan, 0);
          break;
        case 'ArrowUp':
          world?.panBy(0, -pan);
          break;
        case 'ArrowDown':
          world?.panBy(0, pan);
          break;
        case 'f':
        case 'F':
          if (s.selectedAgentId) s.follow(s.followAgentId === s.selectedAgentId ? undefined : s.selectedAgentId);
          break;
        case 'Escape':
          s.select(undefined);
          s.follow(undefined);
          break;
        case '`':
          s.toggleConsole();
          break;
        case ']': {
          const ids = Object.values(s.agents)
            .filter((a) => inMode(s.mode, a.origin) && s.runtime[a.id]?.status !== 'disconnected')
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((a) => a.id);
          if (!ids.length) break;
          const i = s.selectedAgentId ? ids.indexOf(s.selectedAgentId) : -1;
          s.select(ids[(i + 1) % ids.length]);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

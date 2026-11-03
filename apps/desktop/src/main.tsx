import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

async function bootstrap() {
  const [{ App }, { initI18n }, { useApp }] = await Promise.all([import('./app/App'), import('./i18n'), import('./state/store')]);
  initI18n(useApp.getState().prefs.locale);
  // Inside the Tauri shell the macOS traffic lights overlay the sidebar header.
  if ('__TAURI_INTERNALS__' in window && /Mac/.test(navigator.userAgent)) document.documentElement.classList.add('is-tauri');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

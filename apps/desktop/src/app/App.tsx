import { useEffect } from 'react';
import { ActivityConsole } from '../features/activity/ActivityConsole';
import { CharacterEditor } from '../features/agents/CharacterEditor';
import { Inspector } from '../features/agents/Inspector';
import { Sidebar } from '../features/agents/Sidebar';
import { OfficeView } from '../features/office/OfficeView';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { bridge } from '../integration/bridgeClient';
import { startHistory } from '../persistence/historyRecorder';
import { startAlerts } from '../features/alerts/alerts';
import { Welcome } from '../features/onboarding/Welcome';
import { GuideDialog } from '../features/guide/GuideDialog';
import { useApp } from '../state/store';
import { useShortcuts } from './useShortcuts';

export function App() {
  useShortcuts();
  useEffect(() => {
    void useApp
      .getState()
      .hydrate()
      .then(() => startHistory());
    void bridge.start();
    startAlerts();
  }, []);
  useEffect(() => {
    const id = setInterval(() => useApp.getState().sweepStale(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-full min-w-[960px] flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfficeView />
          <ActivityConsole />
        </div>
        <Inspector />
      </div>
      <SettingsDialog />
      <CharacterEditor />
      <Welcome />
      <GuideDialog />
    </div>
  );
}

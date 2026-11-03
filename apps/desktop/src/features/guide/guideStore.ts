import { create } from 'zustand';

export type GuideSection = 'start' | 'office' | 'teams' | 'help';

export const useGuide = create<{ section?: GuideSection; open: (s?: GuideSection) => void; close: () => void }>((set) => ({
  open: (section = 'start') => set({ section }),
  close: () => set({ section: undefined }),
}));

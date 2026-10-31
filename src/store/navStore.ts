import { create } from 'zustand';

export type NavView =
  | { kind: 'workspace' }
  | { kind: 'group'; groupId: string }
  | { kind: 'song'; groupId: string; songId: string };

interface NavState {
  view: NavView;
  goWorkspace: () => void;
  goGroup: (groupId: string) => void;
  goSong: (groupId: string, songId: string) => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: { kind: 'workspace' },
  goWorkspace: () => set({ view: { kind: 'workspace' } }),
  goGroup: (groupId) => set({ view: { kind: 'group', groupId } }),
  goSong: (groupId, songId) => set({ view: { kind: 'song', groupId, songId } }),
}));

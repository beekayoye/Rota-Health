import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

export interface ClinicSummary {
  id: string;
  name: string;
  timeZone: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}

export interface TeamState {
  activeTeamId: string | null;
  activeRole: 'OWNER' | 'MANAGER' | 'STAFF' | null;
  clinics: ClinicSummary[];
  pendingInviteUrl: string | null;
  pendingUrl: string | null;

  setActiveTeam: (teamId: string, role?: 'OWNER' | 'MANAGER' | 'STAFF') => void;
  setClinics: (clinics: ClinicSummary[]) => void;
  setPendingInviteUrl: (url: string | null) => void;
  setPendingUrl: (url: string | null) => void;
  clearTeam: () => void;
}

const secureStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return (await SecureStore.getItemAsync(name)) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(name, value);
    } catch {
      // Ignore write errors
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(name);
    } catch {
      // Ignore delete errors
    }
  },
};

export const useTeamStore = create<TeamState>()(
  persist(
    (set) => ({
      activeTeamId: null,
      activeRole: null,
      clinics: [],
      pendingInviteUrl: null,
      pendingUrl: null,

      setPendingUrl: (url) => set({ pendingUrl: url }),

      setActiveTeam: (teamId, role) =>
        set((state) => {
          const found = state.clinics.find((c) => c.id === teamId);
          return {
            activeTeamId: teamId,
            activeRole: role || found?.role || state.activeRole,
          };
        }),

      setClinics: (clinics) =>
        set((state) => {
          // If activeTeamId is not set or not in clinics, select first clinic
          let nextActiveId = state.activeTeamId;
          let nextRole = state.activeRole;

          if (clinics.length > 0) {
            const currentActive = clinics.find((c) => c.id === nextActiveId);
            if (!currentActive) {
              nextActiveId = clinics[0].id;
              nextRole = clinics[0].role;
            } else {
              nextRole = currentActive.role;
            }
          } else {
            nextActiveId = null;
            nextRole = null;
          }

          return {
            clinics,
            activeTeamId: nextActiveId,
            activeRole: nextRole,
          };
        }),

      setPendingInviteUrl: (url) => set({ pendingInviteUrl: url }),

      clearTeam: () =>
        set({
          activeTeamId: null,
          activeRole: null,
          clinics: [],
          pendingInviteUrl: null,
        }),
    }),
    {
      name: 'rh.active_team',
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        activeTeamId: state.activeTeamId,
        activeRole: state.activeRole,
        clinics: state.clinics,
        pendingInviteUrl: state.pendingInviteUrl,
      }),
    },
  ),
);

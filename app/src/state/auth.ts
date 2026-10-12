import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
}

export interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  setAuth: (user: UserProfile, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  clearAuth: () => void;
  setStatus: (status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated') => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  setAuth: (user, accessToken) =>
    set({
      user,
      accessToken,
      status: 'authenticated',
    }),
  setAccessToken: (accessToken) =>
    set((state) => ({
      accessToken,
      status: state.user ? 'authenticated' : state.status,
    })),
  clearAuth: () =>
    set({
      user: null,
      accessToken: null,
      status: 'unauthenticated',
    }),
  setStatus: (status) => set({ status }),
}));

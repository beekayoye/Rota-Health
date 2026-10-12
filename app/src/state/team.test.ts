import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock expo-secure-store before importing team store
vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

import { useTeamStore, ClinicSummary } from './team';

describe('useTeamStore', () => {
  beforeEach(() => {
    useTeamStore.getState().clearTeam();
  });

  it('initializes with default empty state', () => {
    const state = useTeamStore.getState();
    expect(state.activeTeamId).toBeNull();
    expect(state.activeRole).toBeNull();
    expect(state.clinics).toEqual([]);
    expect(state.pendingInviteUrl).toBeNull();
  });

  it('setClinics selects the first clinic when activeTeamId is not set', () => {
    const clinics: ClinicSummary[] = [
      { id: 'clinic-1', name: 'General Clinic', timeZone: 'Africa/Lagos', role: 'OWNER' },
      { id: 'clinic-2', name: 'Downtown Center', timeZone: 'Africa/Lagos', role: 'STAFF' },
    ];

    useTeamStore.getState().setClinics(clinics);

    const state = useTeamStore.getState();
    expect(state.clinics).toEqual(clinics);
    expect(state.activeTeamId).toBe('clinic-1');
    expect(state.activeRole).toBe('OWNER');
  });

  it('setClinics maintains activeTeamId if it still exists in the new clinics list', () => {
    const clinics: ClinicSummary[] = [
      { id: 'clinic-1', name: 'General Clinic', timeZone: 'Africa/Lagos', role: 'OWNER' },
      { id: 'clinic-2', name: 'Downtown Center', timeZone: 'Africa/Lagos', role: 'STAFF' },
    ];

    useTeamStore.getState().setClinics(clinics);
    useTeamStore.getState().setActiveTeam('clinic-2');

    expect(useTeamStore.getState().activeTeamId).toBe('clinic-2');
    expect(useTeamStore.getState().activeRole).toBe('STAFF');

    // Update clinics (e.g. name update)
    useTeamStore.getState().setClinics([
      { id: 'clinic-1', name: 'General Clinic Updated', timeZone: 'Africa/Lagos', role: 'OWNER' },
      { id: 'clinic-2', name: 'Downtown Center', timeZone: 'Africa/Lagos', role: 'STAFF' },
    ]);

    expect(useTeamStore.getState().activeTeamId).toBe('clinic-2');
    expect(useTeamStore.getState().activeRole).toBe('STAFF');
  });

  it('handles pendingInviteUrl and clearing', () => {
    useTeamStore.getState().setPendingInviteUrl('token-xyz');
    expect(useTeamStore.getState().pendingInviteUrl).toBe('token-xyz');

    useTeamStore.getState().clearTeam();
    const state = useTeamStore.getState();
    expect(state.activeTeamId).toBeNull();
    expect(state.activeRole).toBeNull();
    expect(state.clinics).toEqual([]);
    expect(state.pendingInviteUrl).toBeNull();
  });
});

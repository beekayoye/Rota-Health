import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Modal,
  Alert,
  Share,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient, API_BASE_URL } from '../src/api/client';
import { useAuthStore } from '../src/state/auth';
import { useTeamStore } from '../src/state/team';
import { colors, spacing, radii, typography } from '../src/theme/tokens';

interface MemberItem {
  id: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  joinedAt: string;
  name?: string;
  email?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

interface InviteItem {
  id: string;
  role: 'MANAGER' | 'STAFF';
  maxUses: number;
  uses: number;
  expiresAt: string;
  revokedAt: string | null;
  inviteUrl: string;
}

export default function TeamScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeRole = useTeamStore((state) => state.activeRole);
  const clinics = useTeamStore((state) => state.clinics);

  const activeClinic = clinics.find((c) => c.id === activeTeamId);
  const isOwner = activeRole === 'OWNER';
  const isManager = activeRole === 'MANAGER';
  const canManage = isOwner || isManager;

  const [roleModalMember, setRoleModalMember] = useState<MemberItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // TanStack Query for members: key starts with ["team", teamId, ...]
  const membersQuery = useQuery({
    queryKey: ['team', activeTeamId, 'members'],
    queryFn: async () => {
      if (!activeTeamId) return { members: [] };
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/members`);
      return res.data as { members: MemberItem[] };
    },
    enabled: !!activeTeamId,
  });

  // TanStack Query for invites: key starts with ["team", teamId, ...]
  const invitesQuery = useQuery({
    queryKey: ['team', activeTeamId, 'invites'],
    queryFn: async () => {
      if (!activeTeamId || !canManage) return { invites: [] };
      const res = await apiClient.get(`${API_BASE_URL}/v1/teams/${activeTeamId}/invites`);
      return res.data as { invites: InviteItem[] };
    },
    enabled: !!activeTeamId && canManage,
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiClient.delete(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/members/${userId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'members'] });
      setActionError(null);
    },
    onError: (err: unknown) => {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setActionError(err.response.data.error.message);
      } else {
        setActionError('Failed to remove member.');
      }
    },
  });

  // Change role mutation (Owner only)
  const changeRoleMutation = useMutation({
    mutationFn: async ({
      userId,
      role,
    }: {
      userId: string;
      role: 'MANAGER' | 'STAFF';
    }) => {
      await apiClient.patch(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/members/${userId}`,
        { role },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'members'] });
      setRoleModalMember(null);
      setActionError(null);
    },
    onError: (err: unknown) => {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setActionError(err.response.data.error.message);
      } else {
        setActionError('Failed to change member role.');
      }
    },
  });

  // Revoke invite mutation
  const revokeInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      await apiClient.delete(
        `${API_BASE_URL}/v1/teams/${activeTeamId}/invites/${inviteId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', activeTeamId, 'invites'] });
      setActionError(null);
    },
    onError: (err: unknown) => {
      if (axios.isAxiosError(err) && err.response?.data?.error?.message) {
        setActionError(err.response.data.error.message);
      } else {
        setActionError('Failed to revoke invite.');
      }
    },
  });

  const handleConfirmRemove = (member: MemberItem) => {
    const memberName = member.name || member.user?.name || 'this member';
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${memberName} from ${activeClinic?.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMemberMutation.mutate(member.userId),
        },
      ],
    );
  };

  const handleShareInvite = async (invite: InviteItem) => {
    try {
      await Share.share({
        title: `Join ${activeClinic?.name || 'Clinic'} on Rota Health`,
        message: `You've been invited to join ${activeClinic?.name || 'our clinic'} on Rota Health as ${invite.role}:\n${invite.inviteUrl}`,
        url: invite.inviteUrl,
      });
    } catch {
      // Ignore user cancellation
    }
  };

  const members = membersQuery.data?.members || [];
  const invites = (invitesQuery.data?.invites || []).filter(
    (inv) => !inv.revokedAt && new Date(inv.expiresAt) > new Date() && inv.uses < inv.maxUses,
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Team & Roles</Text>
            <Text style={styles.headerSubtitle}>{activeClinic?.name || 'Clinic'}</Text>
          </View>

          {canManage ? (
            <TouchableOpacity
              style={styles.inviteButton}
              onPress={() => router.push('/invite' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.inviteButtonText}>+ Invite</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {actionError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{actionError}</Text>
            <TouchableOpacity onPress={() => setActionError(null)}>
              <Text style={styles.errorBannerDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Content */}
        {membersQuery.isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading team roster...</Text>
          </View>
        ) : (
          <FlatList
            data={members}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  Members ({members.length})
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelf = item.userId === currentUserId;
              const isTargetOwner = item.role === 'OWNER';
              const isTargetManager = item.role === 'MANAGER';

              // Permissions to remove:
              // Owner can remove anyone except Owner
              // Manager can remove Staff only
              const canRemove =
                !isSelf &&
                !isTargetOwner &&
                (isOwner || (isManager && !isTargetManager));

              // Permissions to change role:
              // Only Owner can change role, and cannot change another Owner
              const canChangeRole = isOwner && !isTargetOwner && !isSelf;

              const memberName = item.name || item.user?.name || 'Staff Member';
              const memberEmail = item.email || item.user?.email || '';

              return (
                <View style={styles.memberCard}>
                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName}>{memberName}</Text>
                      {isSelf && <Text style={styles.selfTag}>(You)</Text>}
                    </View>
                    <Text style={styles.memberEmail}>{memberEmail}</Text>
                    <View style={styles.roleBadgeContainer}>
                      <View
                        style={[
                          styles.roleBadge,
                          item.role === 'OWNER' && styles.roleBadgeOwner,
                          item.role === 'MANAGER' && styles.roleBadgeManager,
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleBadgeText,
                            item.role === 'OWNER' && styles.roleBadgeTextOwner,
                            item.role === 'MANAGER' && styles.roleBadgeTextManager,
                          ]}
                        >
                          {item.role}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.memberActions}>
                    {canChangeRole && (
                      <TouchableOpacity
                        style={styles.changeRoleButton}
                        onPress={() => setRoleModalMember(item)}
                      >
                        <Text style={styles.changeRoleText}>Role</Text>
                      </TouchableOpacity>
                    )}

                    {canRemove && (
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => handleConfirmRemove(item)}
                        disabled={removeMemberMutation.isPending}
                      >
                        <Text style={styles.removeText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              canManage && invites.length > 0 ? (
                <View style={styles.invitesSection}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>
                      Active Invite Links ({invites.length})
                    </Text>
                  </View>

                  {invites.map((inv) => (
                    <View key={inv.id} style={styles.inviteCard}>
                      <View style={styles.inviteInfo}>
                        <View style={styles.inviteHeaderRow}>
                          <View style={styles.roleBadge}>
                            <Text style={styles.roleBadgeText}>{inv.role}</Text>
                          </View>
                          <Text style={styles.inviteUses}>
                            {inv.uses} of {inv.maxUses} used
                          </Text>
                        </View>
                        <Text style={styles.inviteExpiry}>
                          Expires: {new Date(inv.expiresAt).toLocaleDateString()}
                        </Text>
                      </View>

                      <View style={styles.inviteActions}>
                        <TouchableOpacity
                          style={styles.shareInviteButton}
                          onPress={() => handleShareInvite(inv)}
                        >
                          <Text style={styles.shareInviteText}>Share</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.revokeButton}
                          onPress={() => revokeInviteMutation.mutate(inv.id)}
                          disabled={revokeInviteMutation.isPending}
                        >
                          <Text style={styles.revokeText}>Revoke</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null
            }
          />
        )}

        {/* Change Role Modal */}
        <Modal
          visible={!!roleModalMember}
          transparent
          animationType="fade"
          onRequestClose={() => setRoleModalMember(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Change Member Role</Text>
              <Text style={styles.modalSubtitle}>
                Select new role for {roleModalMember?.name || roleModalMember?.user?.name || 'Member'}
              </Text>

              <TouchableOpacity
                style={[
                  styles.modalOption,
                  roleModalMember?.role === 'MANAGER' && styles.modalOptionActive,
                ]}
                onPress={() => {
                  if (roleModalMember) {
                    changeRoleMutation.mutate({
                      userId: roleModalMember.userId,
                      role: 'MANAGER',
                    });
                  }
                }}
                disabled={changeRoleMutation.isPending}
              >
                <Text style={styles.modalOptionTitle}>Manager</Text>
                <Text style={styles.modalOptionDesc}>
                  Draft and publish shift rosters, approve swap requests.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalOption,
                  roleModalMember?.role === 'STAFF' && styles.modalOptionActive,
                ]}
                onPress={() => {
                  if (roleModalMember) {
                    changeRoleMutation.mutate({
                      userId: roleModalMember.userId,
                      role: 'STAFF',
                    });
                  }
                }}
                disabled={changeRoleMutation.isPending}
              >
                <Text style={styles.modalOptionTitle}>Staff</Text>
                <Text style={styles.modalOptionDesc}>
                  View schedule offline, request shift swaps, configure quiet hours.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setRoleModalMember(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backButton: {
    paddingVertical: spacing.sm,
  },
  backButtonText: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.headlineMedium,
    fontSize: 18,
    color: colors.onSurface,
  },
  headerSubtitle: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  inviteButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  inviteButtonText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorBannerText: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.onErrorContainer,
    flex: 1,
  },
  errorBannerDismiss: {
    color: colors.onErrorContainer,
    paddingLeft: spacing.md,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  listContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  sectionHeader: {
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  sectionTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  memberName: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  selfTag: {
    ...typography.labelSmall,
    color: colors.primary,
  },
  memberEmail: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  roleBadgeContainer: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  roleBadge: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  roleBadgeOwner: {
    backgroundColor: colors.primaryContainer,
  },
  roleBadgeManager: {
    backgroundColor: colors.secondaryContainer,
  },
  roleBadgeText: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  roleBadgeTextOwner: {
    color: colors.onPrimaryContainer,
  },
  roleBadgeTextManager: {
    color: colors.onSecondaryContainer,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  changeRoleButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  changeRoleText: {
    ...typography.labelSmall,
    color: colors.onSurface,
  },
  removeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.errorContainer,
  },
  removeText: {
    ...typography.labelSmall,
    color: colors.onErrorContainer,
  },
  invitesSection: {
    marginTop: spacing.xl,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  inviteInfo: {
    flex: 1,
  },
  inviteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  inviteUses: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  inviteExpiry: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  inviteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shareInviteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  shareInviteText: {
    ...typography.labelSmall,
    color: colors.primary,
  },
  revokeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.errorContainer,
  },
  revokeText: {
    ...typography.labelSmall,
    color: colors.onErrorContainer,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xl,
  },
  modalOption: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.md,
  },
  modalOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  modalOptionTitle: {
    ...typography.titleMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  modalOptionDesc: {
    ...typography.bodyMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  modalCancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  modalCancelText: {
    ...typography.labelLarge,
    color: colors.onSurfaceVariant,
  },
});

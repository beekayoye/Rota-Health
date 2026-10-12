import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, radii, typography } from '../theme/tokens';

export type TabName = 'my-shifts' | 'calendar' | 'swaps' | 'activity' | 'home';

interface BottomNavProps {
  currentTab?: TabName;
}

export function BottomNav({ currentTab }: BottomNavProps) {
  const router = useRouter();

  const tabs: { key: TabName; label: string; icon: string; route: string }[] = [
    { key: 'my-shifts', label: 'My shifts', icon: '👤', route: '/my-shifts' },
    { key: 'calendar', label: 'Calendar', icon: '📅', route: '/calendar' },
    { key: 'swaps', label: 'Swaps', icon: '🔄', route: '/swaps' },
    { key: 'activity', label: 'Activity', icon: '📋', route: '/activity' },
    { key: 'home', label: 'More', icon: '⚙️', route: '/home' },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = currentTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabButton, isActive && styles.tabButtonActive]}
            onPress={() => {
              if (!isActive) {
                router.replace(tab.route as any);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    justifyContent: 'space-around',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  tabButtonActive: {
    backgroundColor: colors.primaryContainer,
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
    opacity: 0.7,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.onPrimaryContainer,
    fontWeight: '700',
  },
});

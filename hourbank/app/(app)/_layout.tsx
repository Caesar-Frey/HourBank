import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../src/theme/colors';
import { TAB_LABEL_STYLE } from '../../src/theme/fonts';

/**
 * Four tabs: HOME · SCHEDULE (calendar + agenda) · MONEY (in / out) · SETTINGS.
 * `profile.tsx` keeps its file name (route /profile) but is titled Settings.
 */
export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: COLORS.paper, borderTopColor: COLORS.paperEdge },
        tabBarActiveTintColor: COLORS.oxblood,
        tabBarInactiveTintColor: COLORS.inkFaint,
        tabBarLabelStyle: TAB_LABEL_STYLE,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'HOME',
          tabBarIcon: ({ color, size }) => <Feather name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'SCHEDULE',
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="money"
        options={{
          title: 'MONEY',
          tabBarIcon: ({ color, size }) => <Feather name="dollar-sign" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'SETTINGS',
          tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

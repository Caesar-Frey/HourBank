import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SessionTimerProvider } from '../../src/contexts/SessionTimerContext';
import { COLORS } from '../../src/theme/colors';

export default function AppLayout() {
  return (
    <SessionTimerProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: COLORS.paper, borderTopColor: COLORS.paperEdge },
          tabBarActiveTintColor: COLORS.oxblood,
          tabBarInactiveTintColor: COLORS.inkFaint,
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
          name="sessions"
          options={{
            title: 'SESSIONS',
            tabBarIcon: ({ color, size }) => <Feather name="clock" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'CALENDAR',
            tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'REPORTS',
            tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'PROFILE',
            tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
          }}
        />

      </Tabs>
    </SessionTimerProvider>
  );
}

import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SessionTimerProvider } from '../../src/contexts/SessionTimerContext';

export default function AppLayout() {
  return (
    <SessionTimerProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#F4EFE6', borderTopColor: '#D9CFBF' },
        tabBarActiveTintColor: '#7A2530',
        tabBarInactiveTintColor: '#8A7E72',
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

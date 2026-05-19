import '../src/global.css';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, usePathname } from 'expo-router';
import { initDb } from '../src/db/schema';
import { runMigrations, MIGRATION_002, MIGRATION_003_SESSION_TYPE, MIGRATION_004_CALENDAR_EVENTS, MIGRATION_005_LEDGER_CONSTRAINTS } from '../src/db/migrations';
import { seedCatalog } from '../src/db/catalog';
import { getActiveOrPausedSession } from '../src/db/sessions';
import { getDb } from '../src/db/client';
import {
  useFonts,
  Fraunces_300Light_Italic,
  Fraunces_400Regular,
} from '@expo-google-fonts/fraunces';
import {
  Geist_400Regular,
  Geist_500Medium,
} from '@expo-google-fonts/geist';
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from '@expo-google-fonts/geist-mono';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_300Light_Italic,
    Fraunces_400Regular,
    Geist_400Regular,
    Geist_500Medium,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  const router = useRouter();
  const pathname = usePathname();

  function checkOrphanSession(currentPath: string) {
    // Orphan session recovery — only when not already on the session screen
    if (currentPath.includes('/session')) return;

    try {
      const active = getActiveOrPausedSession();
      if (active) {
        Alert.alert(
          'Unfinished session',
          `You have an active session with ${active.student_full_name}. Continue?`,
          [
            {
              text: 'Discard',
              style: 'destructive',
              onPress: () => {
                try {
                  const db = getDb();
                  db.runSync(
                    `UPDATE sessions SET status = 'cancelled' WHERE id = ?`,
                    [active.id]
                  );
                } catch (e) {
                  console.error('orphan discard error', e);
                }
              },
            },
            {
              text: 'Continue',
              onPress: () => {
                router.push(
                  `/student/${active.student_id}/session?sessionId=${active.id}`
                );
              },
            },
          ]
        );
      }
    } catch (e) {
      console.error('orphan session check error', e);
    }
  }

  useEffect(() => {
    try {
      initDb();
      runMigrations([MIGRATION_002, MIGRATION_003_SESSION_TYPE, MIGRATION_004_CALENDAR_EVENTS, MIGRATION_005_LEDGER_CONSTRAINTS]);
      seedCatalog();

      // Check for orphan session on launch
      checkOrphanSession(pathname);
    } catch (e) {
      console.error('DB init failed', e);
      // Surface to user if needed — for now log is sufficient for MVP
    }
  }, []);

  // Separate effect so AppState listener always has the current pathname
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkOrphanSession(pathname);
      }
    });
    return () => sub.remove();
  }, [pathname]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="student" options={{ headerShown: false }} />
        <Stack.Screen name="calendar-event" options={{ headerShown: false }} />
        <Stack.Screen name="transaction" options={{ headerShown: false }} />
        <Stack.Screen name="lesson" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}

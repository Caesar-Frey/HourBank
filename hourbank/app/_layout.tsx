import '../src/global.css';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { initDb } from '../src/db/schema';
import { getActiveSession } from '../src/db/sessions';
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

  useEffect(() => {
    initDb();

    // Orphan session recovery — only when not already on the session screen
    if (pathname.includes('/session')) return;

    try {
      const active = getActiveSession();
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
  }, []);

  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

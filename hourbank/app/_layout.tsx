import '../src/global.css';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { initDb } from '../src/db/schema';
import { getActiveSession, autoVerifySweep } from '../src/db/sessions';
import { getDb } from '../src/db/client';
import { VERIFICATION_WINDOW_HOURS } from '../src/config';
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

function runAutoVerify() {
  try {
    const count = autoVerifySweep(VERIFICATION_WINDOW_HOURS);
    if (count > 0) console.log(`[AutoVerify] Verified ${count} session(s)`);
  } catch (e) {
    console.error('[AutoVerify] error', e);
  }
}

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

  function checkOrphanSession() {
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
  }

  useEffect(() => {
    initDb();

    // Run auto-verify on launch
    runAutoVerify();

    // Check for orphan session on launch
    checkOrphanSession();

    // AppState listener: run auto-verify when app returns to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runAutoVerify();
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

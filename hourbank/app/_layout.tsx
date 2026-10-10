import '../src/global.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, usePathname } from 'expo-router';
import { SessionTimerProvider, useSessionTimer } from '../src/contexts/SessionTimerContext';
import {
  lessonDraftStore,
  orphanPromptCopy,
  shouldPromptOrphan,
  InFlightSession,
  OrphanTrigger,
} from '../src/contexts/SessionTimerContext.helpers';
import { ToastProvider, useToast } from '../src/components/Toast';
import { initDb } from '../src/db/schema';
import { runMigrations, ALL_MIGRATIONS } from '../src/db/migrations';
import { seedCatalog } from '../src/db/catalog';
import { discardSession, getActiveOrPausedSession } from '../src/db/sessions';
import { COLORS } from '../src/theme/colors';
import { F, MIN_TOUCH } from '../src/theme/fonts';
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

type DbState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function initialiseDatabase(): DbState {
  try {
    initDb();
    runMigrations(ALL_MIGRATIONS);
    seedCatalog();
    return { status: 'ready' };
  } catch (e) {
    console.error('DB init failed', e);
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export default function RootLayout() {
  // Font failure falls back to system fonts rather than a blank screen.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_300Light_Italic,
    Fraunces_400Regular,
    Geist_400Regular,
    Geist_500Medium,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  const [db, setDb] = useState<DbState>({ status: 'loading' });
  const retryDb = useCallback(() => {
    setDb({ status: 'loading' });
    // Let the loading frame paint before the (synchronous) migration run.
    setTimeout(() => setDb(initialiseDatabase()), 0);
  }, []);

  useEffect(() => {
    setDb(initialiseDatabase());
  }, []);

  useEffect(() => {
    if (fontError) console.error('Font loading failed — using system fonts', fontError);
  }, [fontError]);

  const fontsSettled = fontsLoaded || !!fontError;
  if (!fontsSettled) return null;

  return (
    <SafeAreaProvider>
      <ToastProvider>
        {db.status === 'ready' ? (
          <SessionTimerProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="student" options={{ headerShown: false }} />
              <Stack.Screen name="calendar-event" options={{ headerShown: false }} />
              <Stack.Screen name="claim" options={{ headerShown: false }} />
              <Stack.Screen name="start-lesson" options={{ headerShown: false }} />
              <Stack.Screen name="transaction/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="lesson/[sessionId]" options={{ headerShown: false }} />
            </Stack>
            <OrphanRecovery />
          </SessionTimerProvider>
        ) : db.status === 'error' ? (
          <DbErrorScreen message={db.message} onRetry={retryDb} />
        ) : (
          <View style={{ flex: 1, backgroundColor: COLORS.paper }} />
        )}
      </ToastProvider>
    </SafeAreaProvider>
  );
}

// ─── DB init failure ─────────────────────────────────────────────────────────

function DbErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, letterSpacing: 1.5, marginBottom: 8 }}>
          STARTUP PROBLEM
        </Text>
        <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink }}>Couldn't open</Text>
        <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, marginBottom: 16 }}>
          your records.
        </Text>
        <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.inkSoft, lineHeight: 22, marginBottom: 16 }}>
          HourBank couldn't prepare its database, so nothing has been changed. Try again — if it keeps failing, restart
          the app.
        </Text>
        <Text
          selectable
          style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginBottom: 28 }}
          numberOfLines={4}
        >
          {message}
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          activeOpacity={0.85}
          accessibilityRole="button"
          style={{
            backgroundColor: COLORS.oxblood,
            borderRadius: 16,
            minHeight: MIN_TOUCH + 8,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>Try again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Orphan lesson recovery ──────────────────────────────────────────────────

/**
 * Asks "continue or discard?" about an in-flight lesson on cold start, or on
 * foreground when the timer context lost track of it. Silent on the live
 * lesson routes themselves.
 */
function OrphanRecovery() {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useSessionTimer();
  const toast = useToast();

  const promptOpen = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  // Read in the AppState listener BEFORE the provider re-syncs from the DB.
  const statusRef = useRef(timer.status);
  statusRef.current = timer.status;
  const timerRef = useRef(timer);
  timerRef.current = timer;

  const showPrompt = useCallback(
    (s: InFlightSession) => {
      promptOpen.current = true;
      const copy = orphanPromptCopy(s);
      const close = () => {
        promptOpen.current = false;
      };

      const confirmDiscard = () => {
        Alert.alert(
          'Discard this lesson?',
          `The lesson with ${s.student_full_name} won't be saved and no hours will be deducted. This can't be undone.`,
          [
            { text: 'Keep lesson', style: 'cancel', onPress: () => showPrompt(s) },
            {
              text: 'Discard lesson',
              style: 'destructive',
              onPress: () => {
                close();
                try {
                  discardSession(s.id);
                  lessonDraftStore.clear(s.id);
                  timerRef.current.endTimer();
                  toast.show({ kind: 'info', message: 'Lesson discarded — no hours deducted' });
                } catch (e) {
                  console.error('orphan discard error', e);
                  toast.show({ kind: 'error', message: "Couldn't discard the lesson. Try again from Home." });
                }
              },
            },
          ],
          { cancelable: false },
        );
      };

      Alert.alert(
        copy.title,
        copy.message,
        [
          { text: 'Discard…', style: 'destructive', onPress: confirmDiscard },
          {
            text: 'Continue',
            onPress: () => {
              close();
              timerRef.current.resumeFromDb(s.id, s.student_id);
              router.push(`/student/${s.student_id}/session?sessionId=${s.id}`);
            },
          },
        ],
        { cancelable: false },
      );
    },
    [router, toast],
  );

  const check = useCallback(
    (trigger: OrphanTrigger) => {
      let s: InFlightSession | null = null;
      try {
        s = getActiveOrPausedSession();
      } catch (e) {
        console.error('orphan session check error', e);
        return;
      }
      const ok = shouldPromptOrphan({
        trigger,
        pathname: pathRef.current,
        timerStatus: statusRef.current,
        dbSession: s,
        promptOpen: promptOpen.current,
      });
      if (ok && s) showPrompt(s);
    },
    [showPrompt],
  );

  // Cold start (this component mounts once the DB is ready).
  useEffect(() => {
    check('cold_start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Foreground: only when the timer context is idle but the DB has a lesson.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check('foreground');
    });
    return () => sub.remove();
  }, [check]);

  return null;
}

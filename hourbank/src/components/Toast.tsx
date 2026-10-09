/**
 * Toast — transient, non-blocking feedback ("Lesson saved", "Undo").
 *
 *   const toast = useToast();
 *   toast.show({ kind: 'success', message: 'Top-up added' });
 *   toast.show({ kind: 'info', message: 'Lesson cancelled', actionLabel: 'Undo', onAction: undo });
 *
 * One toast at a time; a new show() replaces the current one. Sits above the
 * tab bar / home indicator and above the keyboard when it is open.
 * Haptics: light impact on success, error notification on error.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../theme/colors';
import { F, MIN_TOUCH } from '../theme/fonts';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastOptions {
  kind: ToastKind;
  message: string;
  /** Optional inline action, e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay. Default 3500ms, or 6000ms when an action is present. */
  durationMs?: number;
}

export interface ToastApi {
  show: (opts: ToastOptions) => void;
  hide: () => void;
}

/** Height reserved for the bottom tab bar (content area, excl. safe inset). */
const DEFAULT_BOTTOM_OFFSET = 64;

/** Badge fill behind the paper-coloured icon. */
const ACCENT: Record<ToastKind, string> = {
  success: COLORS.moss,
  error: COLORS.crimson,
  info: COLORS.inkSoft,
};

const ICON: Record<ToastKind, React.ComponentProps<typeof Feather>['name']> = {
  success: 'check',
  error: 'alert-triangle',
  info: 'info',
};

const NOOP_API: ToastApi = { show: () => {}, hide: () => {} };

const ToastContext = createContext<ToastApi | null>(null);

function fireHaptic(kind: ToastKind): void {
  try {
    if (kind === 'success') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else if (kind === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  } catch {
    // Haptics unavailable (web / test env) — feedback is visual only.
  }
}

interface ActiveToast extends ToastOptions {
  id: number;
}

interface ToastProviderProps {
  children: React.ReactNode;
  /** Extra space above the bottom safe-area inset (default 64 = tab bar). */
  bottomOffset?: number;
}

export function ToastProvider({ children, bottomOffset = DEFAULT_BOTTOM_OFFSET }: ToastProviderProps) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [anim, clearTimer]);

  const show = useCallback(
    (opts: ToastOptions) => {
      clearTimer();
      seq.current += 1;
      const next: ActiveToast = { ...opts, id: seq.current };
      setToast(next);
      fireHaptic(opts.kind);
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(opts.message);
      }
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      const duration = opts.durationMs ?? (opts.actionLabel ? 6000 : 3500);
      timer.current = setTimeout(hide, duration);
    },
    [anim, clearTimer, hide],
  );

  // Keep the toast above the keyboard.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, e => setKeyboardHeight(e.endCoordinates.height));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const api = useMemo<ToastApi>(() => ({ show, hide }), [show, hide]);

  const bottom = keyboardHeight > 0 ? keyboardHeight + 12 : insets.bottom + bottomOffset;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  function handleAction() {
    const cb = toast?.onAction;
    hide();
    cb?.();
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center', paddingHorizontal: 16 }}
        >
          <Animated.View
            key={toast.id}
            testID="toast"
            accessibilityRole="alert"
            accessibilityLiveRegion={toast.kind === 'error' ? 'assertive' : 'polite'}
            style={{
              opacity: anim,
              transform: [{ translateY }],
              width: '100%',
              maxWidth: 480,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: COLORS.ink,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: COLORS.paper12,
              paddingLeft: 14,
              paddingRight: toast.actionLabel ? 4 : 14,
              minHeight: 52,
              shadowColor: COLORS.ink,
              shadowOpacity: 0.18,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: ACCENT[toast.kind],
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Feather name={ICON[toast.kind]} size={14} color={COLORS.paper} />
            </View>
            <Text
              style={{ flex: 1, fontFamily: F.sans, fontSize: 14, lineHeight: 19, color: COLORS.paper, paddingVertical: 14 }}
            >
              {toast.message}
            </Text>
            {toast.actionLabel ? (
              <TouchableOpacity
                onPress={handleAction}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={toast.actionLabel}
                style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text
                  style={{
                    fontFamily: F.sansMed,
                    fontSize: 14,
                    color: COLORS.paper,
                    textDecorationLine: 'underline',
                  }}
                >
                  {toast.actionLabel}
                </Text>
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

/**
 * Access the toast API. Outside a ToastProvider (e.g. isolated screen tests)
 * returns a no-op API so screens never crash for lack of a host.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_API;
}

/**
 * FormScreen — keyboard-aware screen scaffold for forms.
 *
 *   <FormScreen
 *     header={<ScreenHeader backLabel="BACK" onBack={router.back} />}
 *     footer={<PrimaryButton … />}          // optional sticky CTA, rides above keyboard
 *   >
 *     …inputs…
 *   </FormScreen>
 *
 * Why not adjustResize: with Android edge-to-edge (app.json edgeToEdgeEnabled)
 * the window is no longer resized for the IME, so we pad for the keyboard
 * ourselves via KeyboardAvoidingView(behavior="padding") on both platforms,
 * and scroll the focused input into view once the keyboard has opened.
 *
 * The KeyboardAvoidingView is the outermost view (frame y = 0) so no
 * keyboardVerticalOffset bookkeeping is needed. Safe-area insets are applied
 * inside it. Render this as the screen root — not inside another SafeAreaView.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleProp,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';

/** Gap kept between the focused input's bottom edge and the keyboard / footer. */
const FOCUS_MARGIN = 24;

export interface FormScreenProps {
  children: React.ReactNode;
  /** Rendered above the scroll area (e.g. ScreenHeader). */
  header?: React.ReactNode;
  /** Sticky bottom bar (e.g. Save button). Sits above the keyboard when open. */
  footer?: React.ReactNode;
  /** Which safe-area edges to pad. Default: top + bottom. */
  edges?: ('top' | 'bottom')[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Dark variant (Live Session screen palette). */
  dark?: boolean;
  /** Access the underlying ScrollView (e.g. to scroll to an error). */
  scrollRef?: React.RefObject<ScrollView | null>;
  testID?: string;
}

/** Tracks the on-screen keyboard (height 0 when hidden). */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: KeyboardEvent) => setHeight(e.endCoordinates.height));
    const h = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  return height;
}

export function FormScreen({
  children,
  header,
  footer,
  edges = ['top', 'bottom'],
  contentContainerStyle,
  dark = false,
  scrollRef,
  testID,
}: FormScreenProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const ownScrollRef = useRef<ScrollView | null>(null);
  const scrollY = useRef(0);
  const footerHeight = useRef(0);

  const setScrollRef = useCallback(
    (node: ScrollView | null) => {
      ownScrollRef.current = node;
      if (scrollRef) (scrollRef as React.MutableRefObject<ScrollView | null>).current = node;
    },
    [scrollRef],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Scroll the focused input above the keyboard (+ footer) once it has opened.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
      const keyboardTop = e.endCoordinates.screenY;
      // Wait one frame so KeyboardAvoidingView padding has been laid out.
      requestAnimationFrame(() => {
        const input = TextInput.State.currentlyFocusedInput?.();
        const scroll = ownScrollRef.current;
        if (!input || !scroll || typeof input.measureInWindow !== 'function') return;
        input.measureInWindow((_x, y, _w, h) => {
          const visibleBottom = keyboardTop - footerHeight.current - FOCUS_MARGIN;
          const overflow = y + h - visibleBottom;
          if (overflow > 0) {
            scroll.scrollTo({ y: scrollY.current + overflow, animated: true });
          }
        });
      });
    });
    return () => sub.remove();
  }, []);

  const keyboardOpen = keyboardHeight > 0;
  const padTop = edges.includes('top') ? insets.top : 0;
  // When the keyboard is open it covers the home indicator, so drop that inset.
  const padBottom = edges.includes('bottom') && !keyboardOpen ? insets.bottom : 0;
  const bg = dark ? COLORS.sessionBg : COLORS.paper;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: bg }}
      testID={testID}
    >
      <View style={{ flex: 1, paddingTop: padTop, paddingBottom: footer ? 0 : padBottom }}>
        {header}
        <ScrollView
          ref={setScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 }, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={onScroll}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            onLayout={e => {
              footerHeight.current = e.nativeEvent.layout.height;
            }}
            style={{
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: 12 + padBottom,
              backgroundColor: bg,
              borderTopWidth: 1,
              borderTopColor: dark ? COLORS.paper12 : COLORS.paperEdge,
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

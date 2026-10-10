/**
 * Unsaved-changes guard for form screens: header back, Android hardware back,
 * swipe-back and programmatic back/replace all fire `beforeRemove`; while the
 * form is dirty we stop it and ask before discarding.
 *
 * Call `allowLeave()` right before navigating away after a successful save.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';

export function useUnsavedChangesGuard(
  dirty: boolean,
  copy: { title?: string; message: string; keepLabel?: string },
): { allowLeave: () => void } {
  const navigation = useNavigation();
  const leavingRef = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const copyRef = useRef(copy);
  copyRef.current = copy;

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      if (leavingRef.current || !dirtyRef.current) return;
      e.preventDefault();
      const c = copyRef.current;
      Alert.alert(c.title ?? 'Discard changes?', c.message, [
        { text: c.keepLabel ?? 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation]);

  const allowLeave = useCallback(() => {
    leavingRef.current = true;
  }, []);

  return { allowLeave };
}

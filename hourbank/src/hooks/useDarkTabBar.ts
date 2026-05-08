import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../theme/colors';

const PAPER_12 = 'rgba(244,239,230,0.12)';
const PAPER_40 = 'rgba(244,239,230,0.4)';

export function useDarkTabBar() {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({
        tabBarStyle: { backgroundColor: COLORS.sessionBg, borderTopColor: PAPER_12 },
        tabBarActiveTintColor: COLORS.paper,
        tabBarInactiveTintColor: PAPER_40,
      });
      return () => {
        parent?.setOptions({
          tabBarStyle: { backgroundColor: COLORS.paper, borderTopColor: COLORS.paperEdge },
          tabBarActiveTintColor: COLORS.oxblood,
          tabBarInactiveTintColor: COLORS.inkFaint,
        });
      };
    }, [navigation])
  );
}

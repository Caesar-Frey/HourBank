import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../theme/colors';


export function useDarkTabBar() {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({
        tabBarStyle: { backgroundColor: COLORS.sessionBg, borderTopColor: COLORS.paper12 },
        tabBarActiveTintColor: COLORS.paper,
        tabBarInactiveTintColor: COLORS.paper40,
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

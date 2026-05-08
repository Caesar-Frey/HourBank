import React, { useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { F } from '../theme/fonts';

export interface ActionSheetItem {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

export interface ActionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  items: ActionSheetItem[];
  theme?: 'paper' | 'dark';
}

export function ActionSheet({ visible, onDismiss, items, theme = 'paper' }: ActionSheetProps) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const sheetWidth = Math.min(280, screenWidth * 0.75);

  const translateX = useRef(new Animated.Value(sheetWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Track whether the modal should remain mounted (we need it for exit animation)
  const [modalVisible, setModalVisible] = React.useState(visible);

  // Derive theme colours
  const sheetBg = theme === 'dark' ? COLORS.sessionBg : COLORS.paper;
  const textColor = theme === 'dark' ? COLORS.paper : COLORS.ink;
  const dividerColor = theme === 'dark' ? 'rgba(244,239,230,0.12)' : COLORS.paperEdge;

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          tension: 300,
          friction: 30,
          useNativeDriver: true,
        }),
        Animated.spring(backdropOpacity, {
          toValue: 0.5,
          tension: 300,
          friction: 30,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: sheetWidth,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setModalVisible(false);
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android back button
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);

  const allItems: ActionSheetItem[] = [
    ...items,
    { label: 'Cancel', onPress: onDismiss },
  ];

  const handleItemPress = useCallback((item: ActionSheetItem) => {
    item.onPress();
  }, []);

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Backdrop */}
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onDismiss}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'black',
            opacity: backdropOpacity,
          }}
        />
      </Pressable>

      {/* Sheet */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: sheetWidth,
          backgroundColor: sheetBg,
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 48,
          transform: [{ translateX }],
        }}
      >
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;
          const itemTextColor = item.destructive ? COLORS.crimson : textColor;

          return (
            <TouchableOpacity
              key={item.label}
              activeOpacity={0.7}
              onPress={() => handleItemPress(item)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingVertical: 16,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: dividerColor,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sansMed,
                  fontSize: 15,
                  color: itemTextColor,
                  textAlign: 'right',
                }}
              >
                {item.label}
              </Text>
              {item.icon && (
                <View style={{ marginLeft: 8 }}>
                  <Feather
                    name={item.icon as React.ComponentProps<typeof Feather>['name']}
                    size={16}
                    color={itemTextColor}
                  />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

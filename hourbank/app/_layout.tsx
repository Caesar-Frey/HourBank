import '../src/global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { initDb } from '../src/db/schema';
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

  useEffect(() => {
    initDb();
  }, []);

  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

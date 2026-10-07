import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  useFonts,
} from "@expo-google-fonts/geist";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { loadPrefs } from "@/lib/prefs";
// Registers the background location task at startup (TaskManager needs it at module scope).
import "@/location/task";
import { useColors } from "@/ui/theme";

void SplashScreen.preventAutoHideAsync();

function Navigator(): ReactNode {
  const { status } = useAuth();
  const colors = useColors();
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });
  // Appearance and "seen onboarding" are read before the first frame: no flash of the wrong
  // theme or of the onboarding screen.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    void loadPrefs().finally(() => setPrefsLoaded(true));
  }, []);
  const ready = fontsLoaded && prefsLoaded && status !== "loading";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}
      />
    </>
  );
}

export default function RootLayout(): ReactNode {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Navigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

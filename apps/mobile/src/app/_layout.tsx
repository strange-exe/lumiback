// One weight per import path, so only the three font files used end up in the update.
import { InstrumentSans_400Regular } from "@expo-google-fonts/instrument-sans/400Regular";
import { InstrumentSans_500Medium } from "@expo-google-fonts/instrument-sans/500Medium";
import { InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans/600SemiBold";
import { useFonts } from "expo-font";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { loadPrefs } from "@/lib/prefs";
// Registers the background location task at startup (TaskManager needs it at module scope).
import "@/location/task";
import { OfflineStart } from "@/screens/offline-start";
import { useColors } from "@/ui/theme";
import { UpdatePrompt } from "@/updates/UpdatePrompt";

void SplashScreen.preventAutoHideAsync();

function Navigator(): ReactNode {
  const { status } = useAuth();
  const pathname = usePathname();
  const colors = useColors();
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
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
  if (status === "offline") {
    return (
      <>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <OfflineStart />
      </>
    );
  }
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
        {/* The gate scanner rises over whichever tab it was opened from. */}
        <Stack.Screen
          name="scan"
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
            contentStyle: { backgroundColor: colors.hero },
          }}
        />
      </Stack>
      {/* Not over sign-in or the gate scanner: the student is mid-task there. */}
      <UpdatePrompt signedIn={status === "signedIn"} pathname={pathname} />
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

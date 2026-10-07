import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { findJoinCode } from "@/lib/join-code";
import { formatTime } from "@/lib/time";
import type { Redeemed, Watching } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, Heading, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

export default function Follow(): ReactNode {
  const c = useColors();
  const load = useCallback(() => api<Watching[]>("/sessions/watching"), []);
  const { data: watching, error, loading, refreshing, reload } = useData(load);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView
        contentContainerStyle={{ padding: space(5), gap: space(6) }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={c.pine}
          />
        }
      >
        <Heading
          eyebrow="Follow"
          title="Someone heading back?"
          lede="Enter the code they sent you. You'll see their location once they approve you."
        />
        <Join />
        <View style={{ gap: space(3) }}>
          <T tone="label">Sharing with you</T>
          {loading ? null : watching && watching.length > 0 ? (
            watching.map((w) => <SharerRow key={w.id} share={w} />)
          ) : (
            <T tone="muted">Nobody right now. Live shares appear here while they last.</T>
          )}
          <FormError message={error} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Join(): ReactNode {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const code = findJoinCode(text);
    if (!code) return setError("That doesn't look like a join code. It has 10 letters and digits.");
    setBusy(true);
    setError(null);
    try {
      const joined = await api<Redeemed>("/codes/redeem", { method: "POST", body: { code } });
      haptic.success();
      setText("");
      router.push({ pathname: "/watch/[id]", params: { id: joined.session_id } });
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Field
        label="Join code"
        value={text}
        onChangeText={setText}
        placeholder="7K3MP-QR2XD"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        hint="Paste the whole message if you like; we'll find the code."
        style={{ letterSpacing: 2 }}
      />
      <FormError message={error} />
      <Button label="Join" busy={busy} busyLabel="Joining…" onPress={() => void submit()} />
    </Card>
  );
}

function SharerRow({ share }: { share: Watching }): ReactNode {
  const c = useColors();
  const initial = share.sharer.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        router.push({ pathname: "/watch/[id]", params: { id: share.id } });
      }}
      accessibilityRole="button"
      accessibilityLabel={`${share.sharer.name}, sharing until ${formatTime(share.ends_at)}. Open map.`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        padding: space(4),
        borderRadius: radius.sheet,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surface,
        transform: pressed ? [{ scale: 0.98 }] : [],
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: c.pineSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T tone="heading" style={{ color: c.pine }}>
          {initial}
        </T>
      </View>
      <View style={{ flex: 1 }}>
        <T tone="label">{share.sharer.name}</T>
        <T tone="small">Live until {formatTime(share.ends_at)}</T>
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.stone} />
    </Pressable>
  );
}

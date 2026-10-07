import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, View } from "react-native";

import { api, ApiError } from "@/lib/api";
import { findJoinCode } from "@/lib/join-code";
import { formatTime } from "@/lib/time";
import type { Redeemed, Watching } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import { Button, Card, Field, FormError, Screen, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

/** The Follow half of the Live tab: join with a code, and the shares you can see. */
export function FollowPanel({ header }: { header: ReactNode }): ReactNode {
  const c = useColors();
  const load = useCallback(() => api<Watching[]>("/sessions/watching"), []);
  const { data: watching, error, loading, refreshing, reload } = useData(load);

  return (
    <Screen
      edges={["top"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          tintColor={c.accent}
        />
      }
    >
      {header}
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          Someone heading back?
        </T>
        <T tone="muted">
          Enter the code they sent you. You&apos;ll see their location once they approve you.
        </T>
      </View>
      <Join />
      <View style={{ gap: space(3) }}>
        <T tone="label">Sharing with you</T>
        {loading ? null : watching && watching.length > 0 ? (
          watching.map((w) => <SharerRow key={w.id} share={w} />)
        ) : (
          <View style={{ alignItems: "center", gap: space(2), paddingVertical: space(4) }}>
            <Illustration name="pin" size={140} />
            <T tone="muted" style={{ textAlign: "center", maxWidth: 280 }}>
              Nobody is sharing with you right now. Live shares appear here while they last.
            </T>
          </View>
        )}
        <FormError message={error} />
      </View>
    </Screen>
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
      router.push({ pathname: "/live/[id]", params: { id: joined.session_id } });
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
        router.push({ pathname: "/live/[id]", params: { id: share.id } });
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
          backgroundColor: c.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T tone="heading" style={{ color: c.accent }}>
          {initial}
        </T>
      </View>
      <View style={{ flex: 1 }}>
        <T tone="label">{share.sharer.name}</T>
        <T tone="small">Live until {formatTime(share.ends_at)}</T>
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.muted} />
    </Pressable>
  );
}

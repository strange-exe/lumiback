import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  clockParts,
  expectedReturn,
  formatDay,
  formatMinutes,
  formatTime,
  progress,
} from "@/lib/time";
import type { Outing } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { useNow } from "@/lib/use-now";
import { allowNotifications, syncReturnReminders } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Button, Card, Chips, Clock, Field, FormError, Heading, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

type Choice = "60" | "120" | "180";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "60", label: "1 h" },
  { value: "120", label: "2 h" },
  { value: "180", label: "3 h" },
];

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

export default function Today(): ReactNode {
  const c = useColors();
  const { user } = useAuth();
  const load = useCallback(async () => {
    const current = await api<Outing | null>("/outings/current");
    // Every load (focus, refresh, after an action) re-aligns the reminders, even for an
    // outing changed on the web or one that just ended.
    void syncReturnReminders(current?.expected_return_at ?? null);
    return current;
  }, []);
  const { data: outing, error, loading, refreshing, reload } = useData(load);
  const first = user?.name.split(" ")[0] ?? "";

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
        {loading ? (
          <Skeleton />
        ) : outing ? (
          <Out outing={outing} onChange={reload} />
        ) : (
          <CheckOut first={first} onDone={reload} />
        )}
        <FormError message={error} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Skeleton(): ReactNode {
  const c = useColors();
  const bar = (width: `${number}%`, height: number) => (
    <View style={{ width, height, borderRadius: radius.control, backgroundColor: c.line }} />
  );
  return (
    <View accessibilityLabel="Loading" style={{ gap: space(4) }}>
      {bar("30%", 14)}
      {bar("70%", 36)}
      {bar("100%", 260)}
    </View>
  );
}

function CheckOut({ first, onDone }: { first: string; onDone: () => Promise<void> }): ReactNode {
  const c = useColors();
  const now = useNow(30_000); // keeps "back by" honest if the screen stays open
  const [choice, setChoice] = useState<Choice>("120");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = expectedReturn(choice, new Date(now));

  const submit = async (): Promise<void> => {
    const at = expectedReturn(choice); // recomputed at the tap, not at the last render
    if (!at) return;
    setBusy(true);
    setError(null);
    try {
      await api("/outings", {
        method: "POST",
        body: { destination: destination.trim() || null, expected_return_at: at.toISOString() },
      });
      haptic.success();
      setDestination("");
      await allowNotifications().catch(() => false); // for the return reminders
      await onDone();
    } catch (e) {
      haptic.warning();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const parts = back ? clockParts(back) : null;

  return (
    <>
      <Heading
        eyebrow={formatDay(new Date(now))}
        title={first ? `Hi ${first}. Heading out?` : "Heading out?"}
        lede="Log it in a tap. Mark your return when you're back."
      />
      <Card style={{ gap: space(5) }}>
        <Chips
          label="Back in about"
          options={CHOICES}
          value={choice}
          onChange={(v) => {
            haptic.tap();
            setChoice(v);
          }}
        />
        {parts ? (
          <View style={{ gap: space(1) }}>
            <T tone="small">You&apos;ll be back by</T>
            <Clock time={parts.time} period={parts.period} color={c.pine} />
          </View>
        ) : null}
        <Field
          label="Where to? (optional)"
          value={destination}
          onChangeText={setDestination}
          placeholder="Rajpur Road"
          maxLength={100}
          returnKeyType="done"
        />
        <FormError message={error} />
        <Button
          label="Check out"
          busy={busy}
          busyLabel="Checking out…"
          onPress={() => void submit()}
        />
      </Card>
    </>
  );
}

function Out({ outing, onChange }: { outing: Outing; onChange: () => Promise<void> }): ReactNode {
  const c = useColors();
  const now = useNow(15_000);
  const [busy, setBusy] = useState<"return" | 30 | 60 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dueMs = new Date(outing.expected_return_at).getTime();
  // Derived from the clock, so the screen turns overdue on time without a refetch.
  const overdue = outing.status === "overdue" || now > dueMs;
  const minutesLeft = Math.round((dueMs - now) / 60_000);
  const done = progress(outing.left_at, outing.expected_return_at, new Date(now));
  const tint = overdue ? c.ember : c.pine;
  const back = clockParts(outing.expected_return_at);

  const act = async (kind: "return" | 30 | 60, call: () => Promise<unknown>): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await call();
      haptic.success();
      await onChange();
    } catch (e) {
      haptic.warning();
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const extend = (minutes: 30 | 60) =>
    act(minutes, () => {
      // Extend from whichever is later: the current plan or now (an overdue plan is in the past).
      const base = Math.max(Date.now(), dueMs);
      return api("/outings/current", {
        method: "PATCH",
        body: { expected_return_at: new Date(base + minutes * 60_000).toISOString() },
      });
    });

  return (
    <>
      <Heading
        eyebrow={overdue ? "Overdue" : "You're out"}
        tone={overdue ? "ember" : "sage"}
        title={outing.destination ?? "Out and about"}
        lede={`Left at ${formatTime(outing.left_at)}.`}
      />
      <Card
        style={{
          gap: space(5),
          borderColor: overdue ? c.ember : c.line,
          backgroundColor: overdue ? c.emberSoft : c.surface,
        }}
      >
        <View style={{ gap: space(1) }}>
          <T tone="small">Back by</T>
          <Clock time={back.time} period={back.period} color={tint} />
          <T tone="label" style={{ color: tint }}>
            {overdue
              ? `${formatMinutes(Math.max(1, -minutesLeft))} late`
              : `${formatMinutes(Math.max(0, minutesLeft))} left`}
          </T>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Time used of your planned outing"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
          style={{ height: 10, borderRadius: 5, backgroundColor: c.line, overflow: "hidden" }}
        >
          <View
            style={{
              width: `${Math.round(done * 100)}%`,
              height: "100%",
              borderRadius: 5,
              backgroundColor: overdue ? c.ember : c.lantern,
            }}
          />
        </View>
        <Button
          label="I'm back"
          busy={busy === "return"}
          busyLabel="Marking…"
          onPress={() =>
            void act("return", () => api("/outings/current/return", { method: "POST" }))
          }
        />
      </Card>

      <View style={{ gap: space(2) }}>
        <T tone="label">Running late? Add time</T>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          {([30, 60] as const).map((m) => (
            <Button
              key={m}
              label={`+${formatMinutes(m)}`}
              variant="secondary"
              busy={busy === m}
              busyLabel="Adding…"
              style={{ flex: 1 }}
              onPress={() => void extend(m)}
            />
          ))}
        </View>
      </View>

      <Pressable
        onPress={() => {
          haptic.tap();
          router.navigate("/share");
        }}
        accessibilityRole="button"
        accessibilityLabel="Share your live location"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space(3),
          padding: space(4),
          borderRadius: radius.sheet,
          backgroundColor: c.pineSoft,
          transform: pressed ? [{ scale: 0.98 }] : [],
        })}
      >
        <Ionicons name="navigate-circle" size={28} color={c.pine} />
        <View style={{ flex: 1 }}>
          <T tone="label" style={{ color: c.pine }}>
            Share your live location
          </T>
          <T tone="small">Let a friend follow your way back.</T>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.pine} />
      </Pressable>

      <FormError message={error} />
    </>
  );
}

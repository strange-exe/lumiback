import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { expectedReturn, formatMinutes, formatTime, progress } from "@/lib/time";
import type { Outing } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Button, Card, Chips, Field, FormError, T } from "@/ui/kit";
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
  const load = useCallback(() => api<Outing | null>("/outings/current"), []);
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
      {bar("60%", 36)}
      {bar("90%", 20)}
      {bar("100%", 160)}
    </View>
  );
}

function CheckOut({ first, onDone }: { first: string; onDone: () => Promise<void> }): ReactNode {
  const [choice, setChoice] = useState<Choice>("120");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = expectedReturn(choice);

  const submit = async (): Promise<void> => {
    if (!back) return;
    setBusy(true);
    setError(null);
    try {
      await api("/outings", {
        method: "POST",
        body: { destination: destination.trim() || null, expected_return_at: back.toISOString() },
      });
      setDestination("");
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          {first ? `Hi ${first}.` : "Hi."}
          {"\n"}Heading out?
        </T>
        <T tone="muted">Log it in a tap. Mark your return when you&apos;re back.</T>
      </View>
      <Card>
        <Chips label="Back in about" options={CHOICES} value={choice} onChange={setChoice} />
        {back ? <T tone="small">Back by {formatTime(back)}</T> : null}
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
  const [busy, setBusy] = useState<"return" | "extend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overdue = outing.status === "overdue";
  const done = progress(outing.left_at, outing.expected_return_at);

  const act = async (kind: "return" | "extend", call: () => Promise<unknown>): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await call();
      await onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const extend = (minutes: number) =>
    act("extend", () => {
      // Extend from whichever is later: the current plan or now (an overdue plan is in the past).
      const base = Math.max(Date.now(), new Date(outing.expected_return_at).getTime());
      return api("/outings/current", {
        method: "PATCH",
        body: { expected_return_at: new Date(base + minutes * 60_000).toISOString() },
      });
    });

  return (
    <>
      <View style={{ gap: space(2) }}>
        <T tone="label" style={{ color: overdue ? c.ember : c.sage }}>
          {overdue ? `Overdue by ${formatMinutes(outing.late_minutes)}` : "You're out"}
        </T>
        <T tone="title" accessibilityRole="header">
          {outing.destination ?? "Out and about"}
        </T>
      </View>
      <Card style={overdue ? { borderColor: c.ember } : undefined}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <T tone="small">Left</T>
            <T tone="heading">{formatTime(outing.left_at)}</T>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <T tone="small">Back by</T>
            <T tone="heading" style={overdue ? { color: c.ember } : undefined}>
              {formatTime(outing.expected_return_at)}
            </T>
          </View>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
          style={{ height: 8, borderRadius: 4, backgroundColor: c.line, overflow: "hidden" }}
        >
          <View
            style={{
              width: `${Math.round(done * 100)}%`,
              height: "100%",
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
          {[30, 60].map((m) => (
            <Button
              key={m}
              label={`+${formatMinutes(m)}`}
              variant="secondary"
              busy={busy === "extend"}
              style={{ flex: 1 }}
              onPress={() => void extend(m)}
            />
          ))}
        </View>
      </View>
      <FormError message={error} />
    </>
  );
}

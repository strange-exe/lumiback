import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, Text, View } from "react-native";

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
import type { Outing, OutingSummary } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { useNow } from "@/lib/use-now";
import { allowNotifications, syncReturnReminders } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import { Button, Chips, Clock, Field, FormError, Press, Screen, StatusChip, T } from "@/ui/kit";
import { FadeIn } from "@/ui/motion";
import { Sheet } from "@/ui/sheet";
import { fonts, radius, space, type, useColors } from "@/ui/theme";

type Choice = "60" | "120" | "180";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "60", label: "1 h" },
  { value: "120", label: "2 h" },
  { value: "180", label: "3 h" },
];

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

interface TodayData {
  outing: Outing | null;
  summary: OutingSummary | null;
}

export default function Today(): ReactNode {
  const c = useColors();
  const { user } = useAuth();
  const load = useCallback(async (): Promise<TodayData> => {
    const [outing, summary] = await Promise.all([
      api<Outing | null>("/outings/current"),
      api<OutingSummary>("/outings/summary").catch(() => null), // nice to have, never blocking
    ]);
    // Every load (focus, refresh, after an action) re-aligns the reminders, even for an
    // outing changed on the web or one that just ended.
    void syncReturnReminders(outing?.expected_return_at ?? null);
    return { outing, summary };
  }, []);
  const { data, error, loading, refreshing, reload } = useData(load);
  const first = user?.name.split(" ")[0] ?? "";
  const initials = (user?.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <Screen
      edges={["top"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          tintColor={c.pine}
        />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
        <View style={{ flex: 1, gap: space(1) }}>
          <Text style={[type.eyebrow, { color: c.pine }]}>{formatDay(new Date())}</Text>
          <T tone="title" accessibilityRole="header">
            {first ? `Hi, ${first}` : "Hi"}
          </T>
        </View>
        <Press
          onPress={() => router.navigate("/profile")}
          accessibilityLabel="Profile"
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: c.pineSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: c.pine }}>
            {initials || "?"}
          </Text>
        </Press>
      </View>

      {loading ? (
        <HeroSkeleton />
      ) : data?.outing ? (
        <Out outing={data.outing} onChange={reload} />
      ) : (
        <AtHostel onDone={reload} />
      )}
      <FormError message={error} />

      <View style={{ gap: space(3) }}>
        <T tone="label" style={{ color: c.stone }}>
          Quick actions
        </T>
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <QuickAction
            icon="navigate"
            title="Share live location"
            detail="Let a friend follow your way back"
            onPress={() => router.navigate("/share")}
          />
          <QuickAction
            icon="people"
            title="Follow someone"
            detail="Enter a code a friend sent you"
            onPress={() => router.navigate("/follow")}
          />
        </View>
      </View>

      {data?.summary && data.summary.total > 0 ? <Stats summary={data.summary} /> : null}
    </Screen>
  );
}

function HeroSkeleton(): ReactNode {
  const c = useColors();
  return (
    <View
      accessibilityLabel="Loading"
      style={{ height: 300, borderRadius: radius.sheet + 4, backgroundColor: c.line, opacity: 0.6 }}
    />
  );
}

/** The pine card: the screen's one focal surface, with its one 3D object. */
function Hero({ children, art }: { children: ReactNode; art: "gate" | "lantern-lit" }): ReactNode {
  const c = useColors();
  return (
    <FadeIn
      style={{
        backgroundColor: c.hero,
        borderRadius: radius.sheet + 4,
        borderCurve: "continuous",
        padding: space(6),
        gap: space(5),
        overflow: "hidden",
        boxShadow: c.shadow,
      }}
    >
      <View
        style={{ position: "absolute", right: -18, top: -10, opacity: 0.98 }}
        importantForAccessibility="no-hide-descendants"
      >
        <Illustration name={art} size={150} variant="light" />
      </View>
      {children}
    </FadeIn>
  );
}

function AtHostel({ onDone }: { onDone: () => Promise<void> }): ReactNode {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Hero art="gate">
        <View style={{ gap: space(2), paddingRight: space(28) }}>
          <Text style={[type.eyebrow, { color: c.heroMuted }]}>On campus</Text>
          <Text style={[type.title, { color: c.onHero }]} accessibilityRole="header">
            Heading out?
          </Text>
          <Text style={[type.body, { color: c.heroMuted }]}>
            Log your trip so you&apos;re covered. We&apos;ll remind you before you&apos;re due back.
          </Text>
        </View>
        <Button
          label="Log a trip"
          variant="onHero"
          icon={<Ionicons name="exit-outline" size={20} color={c.hero} />}
          onPress={() => {
            haptic.tap();
            setOpen(true);
          }}
        />
      </Hero>
      <LogTripSheet open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}

function LogTripSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const now = useNow(30_000); // keeps "back by" honest if the sheet stays open
  const [choice, setChoice] = useState<Choice>("120");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = expectedReturn(choice, new Date(now));
  const parts = back ? clockParts(back) : null;

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
      onClose();
      await allowNotifications().catch(() => false); // for the return reminders
      await onDone();
    } catch (e) {
      haptic.warning();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Log a trip">
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
          <T tone="caption">You&apos;ll be back by</T>
          <Clock time={parts.time} period={parts.period} color={c.pine} size={48} />
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
    </Sheet>
  );
}

function Out({ outing, onChange }: { outing: Outing; onChange: () => Promise<void> }): ReactNode {
  const c = useColors();
  const now = useNow(15_000);
  const [busy, setBusy] = useState<"return" | 30 | 60 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dueMs = new Date(outing.expected_return_at).getTime();
  // Derived from the clock, so the card turns overdue on time without a refetch.
  const overdue = outing.status === "overdue" || now > dueMs;
  const minutesLeft = Math.round((dueMs - now) / 60_000);
  const done = progress(outing.left_at, outing.expected_return_at, new Date(now));
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
    <Hero art="lantern-lit">
      <View style={{ gap: space(2), paddingRight: space(28) }}>
        {overdue ? (
          <StatusChip label="Overdue" tone="ember" />
        ) : (
          <Text style={[type.eyebrow, { color: c.heroMuted }]}>You&apos;re out</Text>
        )}
        <Text
          style={[type.title, { color: c.onHero }]}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {outing.destination ?? "Out and about"}
        </Text>
        <Text style={[type.caption, { color: c.heroMuted }]}>
          Left at {formatTime(outing.left_at)}
        </Text>
      </View>

      <View style={{ gap: space(1) }}>
        <Text style={[type.caption, { color: c.heroMuted }]}>Back by</Text>
        <Clock time={back.time} period={back.period} color={c.onHero} />
        <Text style={[type.label, { color: overdue ? "#f7b9a7" : c.lantern }]}>
          {overdue
            ? `${formatMinutes(Math.max(1, -minutesLeft))} late`
            : `${formatMinutes(Math.max(0, minutesLeft))} left`}
        </Text>
      </View>

      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Time used of your planned outing"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
        style={{ height: 8, borderRadius: 4, backgroundColor: c.heroLine, overflow: "hidden" }}
      >
        <View
          style={{
            width: `${Math.round(done * 100)}%`,
            height: "100%",
            borderRadius: 4,
            backgroundColor: overdue ? "#f08a6e" : c.lantern,
          }}
        />
      </View>

      <Button
        label="I'm back"
        variant="onHero"
        busy={busy === "return"}
        busyLabel="Marking…"
        icon={<Ionicons name="home" size={18} color={c.hero} />}
        onPress={() => void act("return", () => api("/outings/current/return", { method: "POST" }))}
      />
      <View style={{ flexDirection: "row", gap: space(2) }}>
        {([30, 60] as const).map((m) => (
          <View key={m} style={{ flex: 1 }}>
            <Button
              label={`+${formatMinutes(m)}`}
              variant="onHeroOutline"
              busy={busy === m}
              busyLabel="Adding…"
              accessibilityLabel={`Add ${formatMinutes(m)}`}
              style={{ minHeight: 44 }}
              onPress={() => void extend(m)}
            />
          </View>
        ))}
      </View>
      {error ? (
        <Text style={[type.label, { color: "#f7b9a7" }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Hero>
  );
}

function QuickAction({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: "navigate" | "people";
  title: string;
  detail: string;
  onPress: () => void;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Press
        onPress={() => {
          haptic.tap();
          onPress();
        }}
        accessibilityLabel={title}
        style={{
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          padding: space(4),
          gap: space(3),
          minHeight: 132,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: c.pineSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={20} color={c.pine} />
        </View>
        <View style={{ gap: 2 }}>
          <T tone="label" style={{ fontSize: 15 }}>
            {title}
          </T>
          <T tone="caption">{detail}</T>
        </View>
      </Press>
    </View>
  );
}

function Stats({ summary }: { summary: OutingSummary }): ReactNode {
  const c = useColors();
  const onTime = summary.on_time_rate == null ? "–" : `${Math.round(summary.on_time_rate * 100)}%`;
  return (
    <Press
      onPress={() => router.navigate("/history")}
      accessibilityLabel={`${summary.total} outings, ${onTime} back on time. Open history.`}
      style={{
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderRadius: radius.sheet,
        borderCurve: "continuous",
        padding: space(5),
        flexDirection: "row",
        alignItems: "center",
        gap: space(4),
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T tone="caption">Back on time</T>
        <T tone="title" style={{ color: c.sage, fontVariant: ["tabular-nums"] }}>
          {onTime}
        </T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T tone="caption">Outings</T>
        <T tone="title" style={{ fontVariant: ["tabular-nums"] }}>
          {summary.total}
        </T>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.stone} />
    </Press>
  );
}

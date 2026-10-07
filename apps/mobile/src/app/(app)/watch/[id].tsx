import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ago } from "@/lib/ago";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/time";
import type { LiveLocation, Watching } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { haptic } from "@/ui/haptics";
import { Button, Card, Heading, T } from "@/ui/kit";
import { LiveMap } from "@/ui/LiveMap";
import { space, useColors } from "@/ui/theme";

const POLL_MS = 5_000;
const WAITING = "Waiting for the sharer to approve you"; // backend AWAITING_APPROVAL detail

type View_ =
  | { kind: "loading" }
  | { kind: "pending" }
  | { kind: "live"; share: Watching; location: LiveLocation | null }
  | { kind: "ended"; reason: string }
  | { kind: "offline"; previous: View_ };

export default function Watch(): ReactNode {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const now = useNow();
  const [view, setView] = useState<View_>({ kind: "loading" });
  const share = useRef<Watching | null>(null);
  const wasPending = useRef(false);

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      share.current ??= await api<Watching>(`/sessions/${id}`);
      const { location } = await api<{ location: LiveLocation | null }>(`/sessions/${id}/location`);
      if (wasPending.current) haptic.success(); // just approved
      wasPending.current = false;
      setView({ kind: "live", share: share.current, location });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.detail === WAITING) {
        wasPending.current = true;
        setView({ kind: "pending" });
        return true;
      }
      if (e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 409)) {
        setView({
          kind: "ended",
          reason: e.status === 403 ? e.detail : "This live share has ended.",
        });
        return false; // nothing more to fetch
      }
      setView((prev) => ({
        kind: "offline",
        previous: prev.kind === "offline" ? prev.previous : prev,
      }));
      return true;
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async (): Promise<void> => {
        const more = await poll();
        if (more && !stopped) timer = setTimeout(() => void tick(), POLL_MS);
      };
      void tick();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }, [poll]),
  );

  const shown = view.kind === "offline" ? view.previous : view;
  const name = shown.kind === "live" ? shown.share.sharer.name : "Live location";
  const first = name.split(" ")[0] ?? name;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={{ padding: space(5), gap: space(5) }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center", gap: space(1), minHeight: 44 }}
        >
          <Ionicons name="chevron-back" size={20} color={c.pine} />
          <T tone="label" style={{ color: c.pine }}>
            Follow
          </T>
        </Pressable>

        {shown.kind === "loading" ? (
          <T tone="muted">Opening…</T>
        ) : shown.kind === "pending" ? (
          <>
            <Heading
              eyebrow="Requested"
              title="Waiting for approval"
              lede="They'll get a request on their phone. This page updates by itself once they say yes."
            />
            <LiveMap point={null} label="Map, waiting for approval" height={220} />
          </>
        ) : shown.kind === "ended" ? (
          <>
            <Heading
              eyebrow="Ended"
              tone="stone"
              title="Not sharing any more"
              lede={shown.reason}
            />
            <Button label="Back to Follow" variant="secondary" onPress={() => router.back()} />
          </>
        ) : shown.kind === "live" ? (
          <Live first={first} share={shown.share} location={shown.location} now={now} />
        ) : null}

        {view.kind === "offline" ? (
          <T tone="small" style={{ color: c.ember }}>
            Can&apos;t reach Lumiback. Showing the last known position; retrying…
          </T>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Live({
  first,
  share,
  location,
  now,
}: {
  first: string;
  share: Watching;
  location: LiveLocation | null;
  now: number;
}): ReactNode {
  const c = useColors();
  const updated = location ? ago(new Date(location.recorded_at).getTime(), now) : null;
  const stale = !location || location.stale;

  return (
    <>
      <Heading
        eyebrow={stale ? "Paused" : "Live"}
        tone={stale ? "stone" : "sage"}
        title={`${first}'s way back`}
        lede={`Sharing until ${formatTime(share.ends_at)}.`}
      />
      <LiveMap
        point={location}
        paused={stale}
        height={340}
        label={
          location
            ? `${first}'s location, updated ${updated}, accurate to about ${Math.round(location.accuracy_m)} metres`
            : `Map, waiting for ${first}'s first location`
        }
      />
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <T tone="small">Last update</T>
            <T tone="heading">{updated ?? "Not yet"}</T>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <T tone="small">Accuracy</T>
            <T tone="heading">{location ? `±${Math.round(location.accuracy_m)} m` : "–"}</T>
          </View>
        </View>
        {stale ? (
          <T tone="small" style={{ color: c.stone }}>
            {location
              ? `${first}'s phone hasn't sent a new position for a while. It may be in a pocket with no signal.`
              : `Waiting for ${first}'s phone to send the first position.`}
          </T>
        ) : null}
      </Card>
    </>
  );
}

import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ago } from "@/lib/ago";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/time";
import type { Watching } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { mockState, type Positions } from "@/location/mock";
import { haptic } from "@/ui/haptics";
import { Button, Card, Heading, T } from "@/ui/kit";
import { LiveMap } from "@/ui/LiveMap";
import { MockNotice } from "@/ui/MockNotice";
import { layout, space, useColors, useDockClearance } from "@/ui/theme";

const POLL_MS = 5_000;
const WAITING = "Waiting for the sharer to approve you"; // backend AWAITING_APPROVAL detail

type View_ =
  | { kind: "loading" }
  | { kind: "pending" }
  | { kind: "live"; share: Watching; positions: Positions }
  | { kind: "ended"; reason: string }
  | { kind: "offline"; previous: View_ };

export default function Watch(): ReactNode {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const now = useNow();
  const clearance = useDockClearance(); // the dock floats over this pushed screen too
  const [view, setView] = useState<View_>({ kind: "loading" });
  const share = useRef<Watching | null>(null);
  const wasPending = useRef(false);

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      if (!share.current) {
        const described = await api<Partial<Watching>>(`/sessions/${id}`);
        if (!described.sharer) {
          // Our own share (e.g. a link to it): the owner's view has no `sharer`. Show it where
          // owners manage it instead of a follower's page.
          router.replace("/live");
          return false;
        }
        share.current = described as Watching;
      }
      const positions = await api<Positions>(`/sessions/${id}/location`);
      if (wasPending.current) haptic.success(); // just approved
      wasPending.current = false;
      setView({ kind: "live", share: share.current, positions });
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
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: c.page }}>
      <Stack.Screen
        options={{ title: shown.kind === "live" ? `Following ${first}` : "Live location" }}
      />
      <ScrollView
        contentContainerStyle={{ padding: layout.gutter, paddingBottom: clearance, gap: space(5) }}
      >
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
              tone="muted"
              title="Not sharing any more"
              lede={shown.reason}
            />
            <Button
              label="Back to Follow someone"
              variant="secondary"
              // Always land on Live's Follow view: back to it when it's below in the stack,
              // otherwise (opened from a link or notification) this screen is replaced by it.
              onPress={() => router.dismissTo({ pathname: "/live", params: { view: "follow" } })}
            />
          </>
        ) : shown.kind === "live" ? (
          <Live first={first} share={shown.share} positions={shown.positions} now={now} />
        ) : null}

        {view.kind === "offline" ? (
          <T tone="small" style={{ color: c.danger }}>
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
  positions,
  now,
}: {
  first: string;
  share: Watching;
  positions: Positions;
  now: number;
}): ReactNode {
  const c = useColors();
  const { location } = positions;
  const mock = mockState(positions);
  const fake = mock.kind === "now" ? mock.fake : null;
  const updated = location ? ago(new Date(location.recorded_at).getTime(), now) : null;
  const stale = !location || location.stale;

  return (
    <>
      <Heading
        eyebrow={fake ? "Location faked" : stale ? "Paused" : "Live"}
        tone={fake ? "danger" : stale ? "muted" : "good"}
        title={`${first}'s way back`}
        lede={`Sharing until ${formatTime(share.ends_at)}.`}
      />
      <LiveMap
        point={location}
        fake={fake}
        paused={stale || fake !== null}
        height={340}
        label={[
          location
            ? `${first}'s last real location, updated ${updated}, accurate to about ${Math.round(location.accuracy_m)} metres`
            : `Map, no real location from ${first} yet`,
          fake ? "A faked location is shown in red" : null,
        ]
          .filter(Boolean)
          .join(". ")}
      />
      <MockNotice state={mock} first={first} now={now} />
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <T tone="small">{fake ? "Last real update" : "Last update"}</T>
            <T tone="heading">{updated ?? "Not yet"}</T>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <T tone="small">Accuracy</T>
            <T tone="heading">{location ? `±${Math.round(location.accuracy_m)} m` : "–"}</T>
          </View>
        </View>
        {stale && !fake ? (
          <T tone="small" style={{ color: c.muted }}>
            {location
              ? `${first}'s phone hasn't sent a new position for a while. It may be in a pocket with no signal.`
              : `Waiting for ${first}'s phone to send the first position.`}
          </T>
        ) : null}
      </Card>
    </>
  );
}

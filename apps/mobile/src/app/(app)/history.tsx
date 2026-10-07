import { useCallback, useState, type ReactNode } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { formatDay, formatMinutes, formatTime } from "@/lib/time";
import type { Outing, OutingPage, OutingSummary } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Button, FormError, Heading, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

interface FirstPage {
  summary: OutingSummary;
  page: OutingPage;
}

export default function History(): ReactNode {
  const c = useColors();
  const load = useCallback(async (): Promise<FirstPage> => {
    const [summary, page] = await Promise.all([
      api<OutingSummary>("/outings/summary"),
      api<OutingPage>("/outings?limit=20"),
    ]);
    return { summary, page };
  }, []);
  const { data, error, loading, refreshing, reload } = useData(load);

  // Older pages are appended locally; a refresh (or coming back to the tab) starts over.
  const [older, setOlder] = useState<{
    items: Outing[];
    next: string | null;
    from: FirstPage;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = older && older.from === data ? older : null;
  const items = [...(data?.page.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (data?.page.next_before ?? null);

  const loadMore = async (): Promise<void> => {
    if (!next || !data) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await api<OutingPage>(`/outings?limit=20&before=${encodeURIComponent(next)}`);
      setOlder({
        items: [...(extra?.items ?? []), ...page.items],
        next: page.next_before,
        from: data,
      });
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setMoreBusy(false);
    }
  };

  const summary = data?.summary;
  const onTime =
    summary?.on_time_rate == null ? "None yet" : `${Math.round(summary.on_time_rate * 100)}%`;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: space(5), gap: space(1), flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={c.pine}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.line }} />}
        ListHeaderComponent={
          <View style={{ gap: space(6), paddingBottom: space(4) }}>
            <Heading eyebrow="History" title="Your outings" />
            {summary && summary.total > 0 ? (
              <View style={{ flexDirection: "row" }}>
                {[
                  { label: "Outings", value: String(summary.total) },
                  { label: "Back on time", value: onTime },
                  { label: "Late returns", value: String(summary.returned_late) },
                ].map((stat, i) => (
                  <View
                    key={stat.label}
                    accessible
                    accessibilityLabel={`${stat.label}: ${stat.value}`}
                    style={{
                      flex: 1,
                      paddingLeft: i === 0 ? 0 : space(3),
                      borderLeftWidth: i === 0 ? 0 : 1,
                      borderLeftColor: c.line,
                    }}
                  >
                    <T tone="title" style={{ fontVariant: ["tabular-nums"] }}>
                      {stat.value}
                    </T>
                    <T tone="small">{stat.label}</T>
                  </View>
                ))}
              </View>
            ) : null}
            <FormError message={error} />
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={{ alignItems: "center", gap: space(2), paddingTop: space(10) }}>
              <T tone="heading">No outings yet</T>
              <T tone="muted" style={{ textAlign: "center" }}>
                Your trips appear here once you check out from Today.
              </T>
            </View>
          )
        }
        renderItem={({ item }) => <Row outing={item} />}
        ListFooterComponent={
          next ? (
            <View style={{ paddingTop: space(4), gap: space(2) }}>
              <FormError message={moreError} />
              <Button
                label="Older outings"
                variant="quiet"
                busy={moreBusy}
                busyLabel="Loading…"
                onPress={() => void loadMore()}
              />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function Row({ outing }: { outing: Outing }): ReactNode {
  const c = useColors();
  const late = outing.late_minutes > 0;
  const status =
    outing.status === "returned"
      ? late
        ? `Back ${formatMinutes(outing.late_minutes)} late`
        : "Back on time"
      : outing.status === "overdue"
        ? "Overdue"
        : "Out now";
  const tone =
    outing.status === "overdue" || late ? c.ember : outing.status === "out" ? c.pine : c.sage;

  return (
    <View style={{ paddingVertical: space(4), gap: space(1) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
        <T tone="label" style={{ flexShrink: 1 }}>
          {outing.destination ?? "Outing"}
        </T>
        <T tone="small">{formatDay(outing.left_at)}</T>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
        <T tone="small">
          {formatTime(outing.left_at)}
          {outing.returned_at ? ` – ${formatTime(outing.returned_at)}` : ""}
          {outing.duration_minutes != null ? ` · ${formatMinutes(outing.duration_minutes)}` : ""}
        </T>
        <T tone="small" style={{ color: tone, fontWeight: "700" }}>
          {status}
        </T>
      </View>
    </View>
  );
}

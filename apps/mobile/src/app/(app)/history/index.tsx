import { useCallback, useMemo, useState, type ReactNode } from "react";
import { RefreshControl, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { formatDay, formatMinutes, formatTime } from "@/lib/time";
import type { Outing, OutingPage, OutingSummary } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Illustration } from "@/ui/illustration";
import { Button, FormError, Heading, StatusChip, T } from "@/ui/kit";
import { layout, radius, space, useColors } from "@/ui/theme";

interface FirstPage {
  summary: OutingSummary;
  page: OutingPage;
}

/** Groups outings under "Tue, 7 Oct" headings, newest first (the API already sorts them). */
function byDay(items: Outing[]): { title: string; data: Outing[] }[] {
  const groups: { title: string; data: Outing[] }[] = [];
  for (const o of items) {
    const title = formatDay(o.left_at);
    const last = groups.at(-1);
    if (last?.title === title) last.data.push(o);
    else groups.push({ title, data: [o] });
  }
  return groups;
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
  const next = extra ? extra.next : (data?.page.next_before ?? null);
  const sections = useMemo(
    () => byDay([...(data?.page.items ?? []), ...(extra?.items ?? [])]),
    [data, extra],
  );

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
  const onTime = summary?.on_time_rate == null ? "–" : `${Math.round(summary.on_time_rate * 100)}%`;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <SectionList
        sections={sections}
        keyExtractor={(o) => o.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          padding: layout.gutter,
          paddingBottom: layout.dockClearance,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={c.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space(5), paddingBottom: space(2) }}>
            <Heading eyebrow="History" title="Your outings" />
            {summary && summary.total > 0 ? (
              <View style={{ flexDirection: "row", gap: space(3) }}>
                {[
                  { label: "Outings", value: String(summary.total), tone: c.ink },
                  { label: "On time", value: onTime, tone: c.good },
                  { label: "Late", value: String(summary.returned_late), tone: c.danger },
                ].map((stat) => (
                  <View
                    key={stat.label}
                    accessible
                    accessibilityLabel={`${stat.label}: ${stat.value}`}
                    style={{
                      flex: 1,
                      backgroundColor: c.surface,
                      borderWidth: 1,
                      borderColor: c.line,
                      borderRadius: radius.sheet,
                      borderCurve: "continuous",
                      padding: space(4),
                      gap: space(1),
                    }}
                  >
                    <T tone="title" style={{ color: stat.tone, fontVariant: ["tabular-nums"] }}>
                      {stat.value}
                    </T>
                    <T tone="caption">{stat.label}</T>
                  </View>
                ))}
              </View>
            ) : null}
            <FormError message={error} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <T tone="label" style={{ color: c.muted, paddingTop: space(5), paddingBottom: space(2) }}>
            {section.title}
          </T>
        )}
        renderItem={({ item, index, section }) => (
          <Row outing={item} first={index === 0} last={index === section.data.length - 1} />
        )}
        ListEmptyComponent={
          loading ? null : (
            <View style={{ alignItems: "center", gap: space(3), paddingTop: space(6) }}>
              <Illustration name="lantern-unlit" size={180} />
              <T tone="headline">No outings yet</T>
              <T tone="muted" style={{ textAlign: "center", maxWidth: 280 }}>
                Your trips appear here once you check out from Today.
              </T>
            </View>
          )
        }
        ListFooterComponent={
          next ? (
            <View style={{ paddingTop: space(5), gap: space(2) }}>
              <FormError message={moreError} />
              <Button
                label="Show older outings"
                variant="secondary"
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

function Row({
  outing,
  first,
  last,
}: {
  outing: Outing;
  first: boolean;
  last: boolean;
}): ReactNode {
  const c = useColors();
  const late = outing.late_minutes > 0;
  const chip =
    outing.status === "overdue"
      ? { label: "Overdue", tone: "danger" as const }
      : outing.status === "out"
        ? { label: "Out now", tone: "accent" as const }
        : late
          ? { label: `${formatMinutes(outing.late_minutes)} late`, tone: "danger" as const }
          : { label: "On time", tone: "good" as const };

  return (
    <View
      accessible
      accessibilityLabel={`${outing.destination ?? "Outing"}, left ${formatTime(outing.left_at)}${
        outing.returned_at ? `, back ${formatTime(outing.returned_at)}` : ""
      }, ${chip.label}`}
      style={{
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderTopLeftRadius: first ? radius.sheet : 0,
        borderTopRightRadius: first ? radius.sheet : 0,
        borderBottomLeftRadius: last ? radius.sheet : 0,
        borderBottomRightRadius: last ? radius.sheet : 0,
        paddingHorizontal: space(4),
        paddingVertical: space(4),
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
      }}
    >
      <View style={{ flex: 1, gap: space(1) }}>
        <T tone="label" numberOfLines={1} style={{ fontSize: 16, lineHeight: 22 }}>
          {outing.destination ?? "Outing"}
        </T>
        <T tone="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {formatTime(outing.left_at)}
          {outing.returned_at ? ` – ${formatTime(outing.returned_at)}` : ""}
          {outing.duration_minutes != null ? `  ·  ${formatMinutes(outing.duration_minutes)}` : ""}
        </T>
      </View>
      <StatusChip label={chip.label} tone={chip.tone} />
    </View>
  );
}

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { RefreshControl, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { canAsk } from "@/lib/corrections";
import { student } from "@/lib/student-api";
import { formatDay } from "@/lib/time";
import type { Outing, OutingPage, OutingSummary } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { useNow } from "@/lib/use-now";
import { CorrectionSheet } from "@/screens/correction-sheet";
import { DotBackground } from "@/ui/backdrop";
import { Illustration } from "@/ui/illustration";
import { Button, FormError, Heading, LoadFailed, T } from "@/ui/kit";
import { OutingRow } from "@/ui/OutingRow";
import { layout, space, useColors, useDockClearance } from "@/ui/theme";

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
  const clearance = useDockClearance();
  const load = useCallback(async (): Promise<FirstPage> => {
    const [summary, page] = await Promise.all([
      api<OutingSummary>("/outings/summary"),
      api<OutingPage>("/outings?limit=20"),
    ]);
    return { summary, page };
  }, []);
  const { data, error, loading, refreshing, reload } = useData(load);
  // The trip whose "Something wrong?" form is open.
  const [fixing, setFixing] = useState<Outing | null>(null);
  const now = useNow(60_000);

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
  const onTime =
    summary?.on_time_rate == null ? null : `${Math.round(summary.on_time_rate * 100)}%`;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <DotBackground />
      <SectionList
        sections={sections}
        keyExtractor={(o) => o.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          padding: layout.gutter,
          paddingBottom: clearance,
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
            {/* The totals as one line (a departures board has no stat tiles). */}
            {summary && summary.total > 0 ? (
              <T tone="muted" style={{ fontVariant: ["tabular-nums"], marginTop: -space(3) }}>
                {summary.total} {summary.total === 1 ? "outing" : "outings"},{" "}
                <T tone="muted" style={{ color: summary.returned_late > 0 ? c.danger : c.muted }}>
                  {summary.returned_late} late
                </T>
                {onTime ? `, ${onTime} back on time` : ""}
              </T>
            ) : null}
            {data ? <FormError message={error} /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <T tone="label" style={{ color: c.muted, paddingTop: space(5), paddingBottom: space(2) }}>
            {section.title}
          </T>
        )}
        renderItem={({ item, index, section }) => (
          <OutingRow
            outing={item}
            first={index === 0}
            last={index === section.data.length - 1}
            onFix={canAsk(item, now) ? () => setFixing(item) : undefined}
          />
        )}
        ListEmptyComponent={
          loading ? null : !data ? (
            // A failed first load is not "no outings": say so and offer a retry.
            <LoadFailed
              title="Couldn't load your outings"
              message={error}
              after="Your trips appear here once it loads."
              busy={refreshing}
              onRetry={reload}
            />
          ) : (
            <View style={{ alignItems: "center", gap: space(3), paddingTop: space(6) }}>
              <Illustration name="lantern-unlit" size={180} />
              <T tone="headline">No outings yet</T>
              <T tone="muted" style={{ textAlign: "center", maxWidth: 280 }}>
                Your trips appear here once you tap out at the gate or log a trip from Today.
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
      {fixing ? (
        <CorrectionSheet
          key={fixing.id}
          target={fixing}
          side="student"
          onClose={() => setFixing(null)}
          submit={async (body) => {
            await student.askCorrection(fixing.id, body);
          }}
          onDone={() => {
            setFixing(null);
            void reload();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

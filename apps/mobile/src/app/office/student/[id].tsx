import { useLocalSearchParams } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { isUuid } from "@/lib/follow";
import { SCAN_RESULT_LABEL, scanDistance } from "@/lib/office";
import { office } from "@/lib/office-api";
import { correctionLines, RECORD_TABS, REQUEST_STATUS, type RecordTab } from "@/lib/record";
import { formatDay, formatMinutes, formatTime } from "@/lib/time";
import type { OfficeRequest, OfficeScan, RecordOuting } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Contact } from "@/screens/office/Contact";
import { LateNote } from "@/screens/office/LateNote";
import {
  Button,
  FormError,
  Heading,
  LoadFailed,
  Screen,
  Section,
  Segmented,
  StatusChip,
  T,
} from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

const STATUS = {
  in: { label: "In the hostel", tone: "muted" },
  out: { label: "Out now", tone: "accent" },
  overdue: { label: "Out and late", tone: "danger" },
} as const;

const when = (iso: string): string => `${formatDay(iso)}, ${formatTime(iso)}`;

/** One student's history for the hostel office: who they are, then their outings (with each
 * one's corrections and late follow-up), requests and gate scans, newest first. Read only. A
 * warden sees their own hostels' students only (the API answers 404 for anyone else). */
export default function StudentHistory(): ReactNode {
  const { id: raw = "" } = useLocalSearchParams<{ id: string }>();
  const id = isUuid(raw) ? raw.toLowerCase() : null;
  const c = useColors();
  const [tab, setTab] = useState<RecordTab>("outings");
  const top = useData(
    useCallback(async () => {
      if (!id) throw new ApiError(404, "No such student");
      return office.studentRecord(id);
    }, [id]),
  );

  if (!top.data) {
    return (
      <Screen edges={["bottom"]}>
        {top.loading ? (
          <T tone="muted">Loading…</T>
        ) : (
          <LoadFailed
            title="Couldn't open this history"
            message={top.error}
            after="A student's history shows here when they live in a hostel you look after."
            busy={top.refreshing}
            onRetry={top.reload}
          />
        )}
      </Screen>
    );
  }

  const { student } = top.data;
  const status = STATUS[student.status];
  const counts = [
    { label: "Outings", value: top.data.outings },
    { label: "Late", value: top.data.late },
    { label: "Open follow-ups", value: top.data.open_escalations },
    { label: "Requests", value: top.data.requests },
  ];
  return (
    <Screen
      edges={["bottom"]}
      refreshControl={
        <RefreshControl
          refreshing={top.refreshing}
          onRefresh={() => void top.reload()}
          colors={[c.accent]}
          tintColor={c.accent}
        />
      }
    >
      <Heading
        title={student.name}
        lede={[student.roll_no, student.hostel ?? "No hostel chosen", student.email]
          .filter(Boolean)
          .join(" · ")}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <StatusChip label={status.label} tone={status.tone} />
        {student.account === "off" ? <StatusChip label="Account turned off" tone="danger" /> : null}
      </View>
      <View style={{ gap: space(3) }}>
        <Contact label="Phone" phone={student.phone} />
        <Contact
          label={`Emergency contact${
            student.emergency_relation ? ` (${student.emergency_relation})` : ""
          }`}
          name={student.emergency_name}
          phone={student.emergency_phone}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: radius.card,
          borderCurve: "continuous",
        }}
      >
        {counts.map((n) => (
          <View
            key={n.label}
            accessible
            accessibilityLabel={`${n.label}: ${n.value}`}
            style={{ width: "50%", padding: space(3), gap: 2 }}
          >
            <T style={{ fontFamily: fonts.semibold, fontSize: 22, fontVariant: ["tabular-nums"] }}>
              {String(n.value)}
            </T>
            <T tone="caption">{n.label}</T>
          </View>
        ))}
      </View>
      <Segmented
        label="History"
        options={RECORD_TABS.map((t) => ({ value: t.value, label: t.label }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "outings" ? (
        <HistoryList<RecordOuting, string>
          key={`outings-${id}`}
          noun="outings"
          empty="No outings in your hostels yet."
          load={(before) => office.recordOutings(id ?? "", before)}
          render={(o) => <OutingCard key={o.id} outing={o} />}
        />
      ) : tab === "requests" ? (
        <HistoryList<OfficeRequest, string>
          key={`requests-${id}`}
          noun="requests"
          empty="No outing requests."
          load={(before) => office.recordRequests(id ?? "", before)}
          render={(r) => <RequestRow key={r.id} request={r} />}
        />
      ) : (
        <HistoryList<OfficeScan, number>
          key={`scans-${id}`}
          noun="scans"
          empty="No gate scans."
          load={(before) => office.recordScans(id ?? "", before)}
          render={(s) => <ScanRow key={s.id} scan={s} />}
        />
      )}
    </Screen>
  );
}

/** A list that loads its newest page, then appends older pages on request. */
function HistoryList<Item, Cursor>({
  noun,
  empty,
  load,
  render,
}: {
  noun: string;
  empty: string;
  load: (before: Cursor | null) => Promise<{ items: Item[]; next_before: Cursor | null }>;
  render: (item: Item) => ReactNode;
}): ReactNode {
  // `load` is rebuilt each render; the list is keyed by tab and student, so the first one serves.
  const [loader] = useState(() => load);
  const first = useData(useCallback(() => loader(null), [loader]));
  const data = first.data;
  // Older pages are appended here; a refresh starts over from the newest.
  const [older, setOlder] = useState<{
    items: Item[];
    next: Cursor | null;
    from: typeof data;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = older && older.from === data ? older : null;
  const next = extra ? extra.next : (data?.next_before ?? null);
  const items = [...(data?.items ?? []), ...(extra?.items ?? [])];

  const loadMore = async (): Promise<void> => {
    if (next === null || !data) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await loader(next);
      setOlder({
        items: [...(extra?.items ?? []), ...page.items],
        next: page.next_before,
        from: data,
      });
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.detail : `Couldn't load older ${noun}. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return first.loading ? (
      <T tone="muted">Loading…</T>
    ) : (
      <LoadFailed
        title={`Couldn't load the ${noun}`}
        message={first.error}
        after="Pull down or try again."
        busy={first.refreshing}
        onRetry={first.reload}
      />
    );
  }
  return (
    <View style={{ gap: space(3) }}>
      {items.length === 0 ? (
        <T tone="muted" style={{ textAlign: "center", paddingVertical: space(6) }}>
          {empty}
        </T>
      ) : (
        <Section>{items.map(render)}</Section>
      )}
      <FormError message={moreError} />
      {next !== null ? (
        <Button
          label={`Show older ${noun}`}
          variant="secondary"
          busy={busy}
          busyLabel="Loading…"
          onPress={() => void loadMore()}
        />
      ) : null}
    </View>
  );
}

function OutingCard({ outing: o }: { outing: RecordOuting }): ReactNode {
  const backLate = o.status === "returned" && o.late_minutes > 0;
  return (
    <View accessible style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={2}>
          {o.destination ? `To ${o.destination}` : "Outing"}
        </T>
        {o.status === "overdue" ? (
          <StatusChip label={`${formatMinutes(o.late_minutes)} late`} tone="danger" />
        ) : o.status === "out" ? (
          <StatusChip label="Out" tone="accent" />
        ) : backLate ? (
          <StatusChip label={`Back ${formatMinutes(o.late_minutes)} late`} tone="danger" />
        ) : (
          <StatusChip label="Back" tone="muted" />
        )}
      </View>
      {o.purpose || o.hostel ? (
        <T tone="caption">{[o.hostel, o.purpose].filter(Boolean).join(" · ")}</T>
      ) : null}
      <T tone="caption">
        {[
          `Left ${when(o.left_at)}${o.out_via === "gate" && o.out_gate ? ` at ${o.out_gate}` : o.out_via === "self" ? " (self-reported)" : ""}`,
          `due ${formatTime(o.expected_return_at)}`,
          o.returned_at ? `back ${when(o.returned_at)}` : "not back yet",
        ].join(" · ")}
      </T>
      <LateNote outing={o} />
      {o.escalation ? (
        <T tone="caption">
          {o.escalation.resolved_at
            ? `Late follow-up handled ${when(o.escalation.resolved_at)}${
                o.escalation.resolved_by ? ` by ${o.escalation.resolved_by}` : ""
              }${o.escalation.note ? `: ${o.escalation.note}` : ""}`
            : `Late follow-up open since ${when(o.escalation.created_at)}`}
        </T>
      ) : null}
      {o.corrections.map((c) => {
        const line = correctionLines(c);
        return (
          <View key={c.id} style={{ gap: 2 }}>
            <T tone="body">{line.title}</T>
            <T tone="caption">{line.detail}</T>
          </View>
        );
      })}
    </View>
  );
}

function RequestRow({ request: r }: { request: OfficeRequest }): ReactNode {
  const status = REQUEST_STATUS[r.status];
  return (
    <View accessible style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1, fontFamily: fonts.semibold }}>
          {r.day ? formatDay(`${r.day}T12:00:00+05:30`) : when(r.created_at)}
        </T>
        <StatusChip label={`${status.label}${r.used ? ", used" : ""}`} tone={status.tone} />
      </View>
      <T tone="body">{r.purpose}</T>
      <T tone="caption">
        {`Asked ${when(r.created_at)}${
          r.decided_by
            ? ` · ${r.status === "approved" ? "approved" : "declined"} by ${r.decided_by}`
            : ""
        }${r.note ? `: ${r.note}` : ""}`}
      </T>
    </View>
  );
}

function ScanRow({ scan }: { scan: OfficeScan }): ReactNode {
  const distance = scanDistance(scan);
  return (
    <View accessible style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1 }} numberOfLines={1}>
          {[scan.direction === "out" ? "Tapping out" : "Tapping in", scan.gate]
            .filter(Boolean)
            .join(", ")}
        </T>
        <T tone="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {when(scan.scanned_at)}
        </T>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <StatusChip
          label={SCAN_RESULT_LABEL[scan.result] ?? "Refused"}
          tone={scan.result === "accepted" ? "good" : "danger"}
        />
        {distance ? <T tone="caption">{distance}</T> : null}
      </View>
    </View>
  );
}

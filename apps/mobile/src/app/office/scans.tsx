import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { SCAN_RESULT_LABEL, scanDistance } from "@/lib/office";
import { office } from "@/lib/office-api";
import { known, loadOfficeFilters, rememberOfficeFilter } from "@/lib/office-filters";
import { formatDay, formatTime } from "@/lib/time";
import type { OfficeScan, OfficeScanPage, ScanResult } from "@/lib/types";
import { useData } from "@/lib/use-data";
import {
  Button,
  Chips,
  FormError,
  Heading,
  LoadFailed,
  Screen,
  Section,
  StatusChip,
  T,
} from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

type ResultFilter = ScanResult | "any";

// Short words so the chips fit three to a row on a phone; the rows use the full wording.
const RESULT_CHIPS: { value: ResultFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "accepted", label: "Accepted" },
  { value: "bad_code", label: "Bad code" },
  { value: "gate_off", label: "Gate off" },
  { value: "too_far", label: "Too far" },
  { value: "weak_gps", label: "Weak GPS" },
  { value: "mock_gps", label: "Mock GPS" },
];

/** Every gate scan, including refused ones, newest first; filter by gate and result. A warden
 * sees their hostels' students only (the API decides). */
export default function Scans(): ReactNode {
  const c = useColors();
  const [gateId, setGateId] = useState("all");
  const [result, setResult] = useState<ResultFilter>("any");

  const gates = useData(useCallback(() => office.gates(), []));
  // The page keeps the filter it was loaded with, so "older" asks for the same filter even
  // while a newly picked one is still loading.
  const load = useCallback(async () => {
    const filter = {
      gateId: gateId === "all" ? null : gateId,
      result: result === "any" ? null : result,
    };
    return { filter, page: await office.scans(filter) };
  }, [gateId, result]);
  const { data: loaded, error, loading, refreshing, reload, refetch } = useData(load);
  const data = loaded?.page;
  // A new filter: load it now (focus already loaded the first one).
  useEffect(() => {
    void refetch();
  }, [gateId, result, refetch]);

  // The last gate and result, once the gates are known (a gate no longer listed is "All").
  // A choice made before the stored one is read wins.
  const chosen = useRef(false);
  useEffect(() => {
    const list = gates.data;
    if (!list || chosen.current) return;
    let live = true;
    void loadOfficeFilters().then((saved) => {
      if (!live || chosen.current) return;
      chosen.current = true;
      setGateId(
        known(
          saved.scans.gate,
          list.map((g) => g.id),
        ),
      );
      setResult(saved.scans.result);
    });
    return () => {
      live = false;
    };
  }, [gates.data]);
  const pickGate = (value: string): void => {
    chosen.current = true;
    setGateId(value);
    void rememberOfficeFilter("scans", { gate: value, result });
  };
  const pickResult = (value: ResultFilter): void => {
    chosen.current = true;
    setResult(value);
    void rememberOfficeFilter("scans", { gate: gateId, result: value });
  };

  // Older pages are appended here; a refresh or a new filter starts over from the newest.
  const [older, setOlder] = useState<{
    items: OfficeScan[];
    next: number | null;
    from: OfficeScanPage;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = older && older.from === data ? older : null;
  const next = extra ? extra.next : (data?.next_before ?? null);
  const items = [...(data?.items ?? []), ...(extra?.items ?? [])];

  const loadMore = async (): Promise<void> => {
    if (next === null || !data) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      if (!loaded) return;
      const page = await office.scans({ ...loaded.filter, before: next });
      setOlder({
        items: [...(extra?.items ?? []), ...page.items],
        next: page.next_before,
        from: data,
      });
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.detail : "Couldn't load older scans. Try again.");
    } finally {
      setMoreBusy(false);
    }
  };

  const filtered = gateId !== "all" || result !== "any";
  const gateChoices = [
    { value: "all", label: "All gates" },
    ...(gates.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <Screen
      edges={["bottom"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          colors={[c.accent]}
          tintColor={c.accent}
        />
      }
    >
      <Heading
        title="Gate scans"
        lede="Every scan, including refused ones. We keep the distance from the gate, never a student's location."
      />
      {gateChoices.length > 2 ? (
        <Chips label="Gate" options={gateChoices} value={gateId} onChange={pickGate} />
      ) : null}
      <Chips label="Result" options={RESULT_CHIPS} value={result} onChange={pickResult} />

      {!data && loading ? (
        <T tone="muted">Loading…</T>
      ) : !data ? (
        <LoadFailed
          title="Couldn't load the scans"
          message={error}
          after="The scan log shows here once Lumiback can be reached."
          busy={refreshing}
          onRetry={reload}
        />
      ) : (
        <>
          <FormError message={error} />
          {items.length === 0 ? (
            <T tone="muted" style={{ textAlign: "center", paddingVertical: space(8) }}>
              {filtered
                ? "No scans match these filters."
                : "No scans yet. They appear here as students tap out and in at a gate."}
            </T>
          ) : (
            <Section>
              {items.map((scan) => (
                <ScanRow key={scan.id} scan={scan} />
              ))}
            </Section>
          )}
          {next !== null ? (
            <View style={{ gap: space(2) }}>
              <FormError message={moreError} />
              <Button
                label="Show older scans"
                variant="secondary"
                busy={moreBusy}
                busyLabel="Loading…"
                onPress={() => void loadMore()}
              />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function ScanRow({ scan }: { scan: OfficeScan }): ReactNode {
  const c = useColors();
  const accepted = scan.result === "accepted";
  const distance = scanDistance(scan);
  const where = [
    scan.direction === "out" ? "Tapping out" : "Tapping in",
    scan.gate,
    scan.roll_no,
  ].filter(Boolean);
  return (
    <View
      accessible
      style={{ paddingHorizontal: space(4), paddingVertical: space(3), gap: space(1.5) }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space(3) }}>
        <T
          tone="body"
          numberOfLines={1}
          style={{ flex: 1, fontFamily: fonts.medium, color: c.ink }}
        >
          {scan.name}
        </T>
        <T tone="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {`${formatDay(scan.scanned_at)}, ${formatTime(scan.scanned_at)}`}
        </T>
      </View>
      <T tone="caption" numberOfLines={1}>
        {where.join(", ")}
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <StatusChip label={SCAN_RESULT_LABEL[scan.result]} tone={accepted ? "good" : "danger"} />
        {distance ? <T tone="caption">{distance}</T> : null}
      </View>
    </View>
  );
}

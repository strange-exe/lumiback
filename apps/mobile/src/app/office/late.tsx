import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { everyHostel } from "@/lib/office";
import { office } from "@/lib/office-api";
import { lateTodayRow } from "@/lib/record";
import { formatTime } from "@/lib/time";
import type { OfficeOuting } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { viaLabel } from "@/lib/words";
import { CorrectionSheet } from "@/screens/correction-sheet";
import { LateNote } from "@/screens/office/LateNote";
import { FormError, Heading, Press, Screen, Section, StatusChip, T } from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

const POLL_MS = 30_000;

/**
 * Late today, as on the website's register: everyone who came back after their return time
 * today, or is still out past it, most late first. A moved due time (running late) shows the
 * time it replaced and the reason. Each row can record the return or correct it.
 */
export default function LateToday(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const load = useCallback(() => office.lateToday(), []);
  const { data, error, loading, refreshing, reload, refetch } = useData(load);
  const [fixing, setFixing] = useState<OfficeOuting | null>(null);

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refetch(), POLL_MS);
      return () => clearInterval(timer);
    }, [refetch]),
  );

  const all = everyHostel(user?.role);
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
        title="Late today"
        lede={`Everyone who came back after their return time today, or is still out past it. Most late first. ${all ? "Every hostel's students." : "Your hostels' students only."}`}
      />
      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : data ? (
        <>
          <FormError message={error} />
          {data.length === 0 ? (
            <T tone="muted" style={{ textAlign: "center", paddingVertical: space(8) }}>
              {all ? "Nobody has been late today." : "Nobody in your hostels has been late today."}
            </T>
          ) : (
            <Section>
              {data.map((o) => (
                <LateRow key={o.id} outing={o} onFix={() => setFixing(o)} />
              ))}
            </Section>
          )}
        </>
      ) : null}
      {fixing ? (
        <CorrectionSheet
          key={fixing.id}
          target={fixing}
          side="office"
          onClose={() => setFixing(null)}
          submit={async (body) => {
            await office.correct(fixing.id, body);
          }}
          onDone={() => {
            setFixing(null);
            void refetch();
          }}
        />
      ) : null}
    </Screen>
  );
}

function LateRow({ outing: o, onFix }: { outing: OfficeOuting; onFix: () => void }): ReactNode {
  const c = useColors();
  const row = lateTodayRow(o, formatTime);
  const via = o.returned_at ? viaLabel({ out_via: o.out_via, in_via: o.in_via ?? null }) : null;
  return (
    <View style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
          {o.name}
        </T>
        <StatusChip label={row.chip} tone={row.back ? "accent" : "danger"} />
      </View>
      <T tone="caption" numberOfLines={1}>
        {[o.roll_no, o.hostel].filter(Boolean).join(" · ") || o.email || ""}
      </T>
      <T tone="caption">{via ? `${row.detail}, ${via.label}` : row.detail}</T>
      <LateNote outing={o} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space(5) }}>
        <Press
          onPress={onFix}
          accessibilityLabel={row.back ? `Correct ${o.name}'s outing` : `Record ${o.name}'s return`}
          style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
        >
          <T tone="label" style={{ color: c.accentText }}>
            {row.back ? "Correct" : "Record return"}
          </T>
        </Press>
        {o.student_id ? (
          <Press
            onPress={() =>
              router.push({
                pathname: "/office/student/[id]",
                params: { id: o.student_id ?? "" },
              })
            }
            accessibilityLabel={`${o.name}'s history`}
            style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
          >
            <T tone="label" style={{ color: c.accentText }}>
              History
            </T>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

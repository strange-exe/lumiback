import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { office } from "@/lib/office-api";
import type { Escalation, OfficeOuting, OfficeRequest } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { EscalationCard } from "@/screens/office/EscalationCard";
import { OutList } from "@/screens/office/OutList";
import { RequestCard } from "@/screens/office/RequestCard";
import { Heading, Screen, Segmented, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

type SectionName = "requests" | "escalations" | "out";
const SECTIONS: { value: SectionName; label: string }[] = [
  { value: "requests", label: "Requests" },
  { value: "escalations", label: "Escalations" },
  { value: "out", label: "Who's out" },
];
const POLL_MS = 30_000;

type Loaded =
  | { section: "requests"; items: OfficeRequest[] }
  | { section: "escalations"; items: Escalation[] }
  | { section: "out"; items: OfficeOuting[] };

function sectionOf(value: unknown): SectionName {
  return SECTIONS.some((s) => s.value === value) ? (value as SectionName) : "requests";
}

async function load(section: SectionName): Promise<Loaded> {
  switch (section) {
    case "requests":
      return { section, items: await office.requests() };
    case "escalations":
      return { section, items: await office.escalations() };
    case "out":
      return { section, items: await office.outings() };
  }
}

/** One screen, three sections; the section is in the URL so a notification can open it. */
export default function OfficeScreen(): ReactNode {
  const params = useLocalSearchParams<{ section: string }>();
  const section = sectionOf(params.section);
  const { user } = useAuth();
  const c = useColors();
  const loader = useCallback(() => load(section), [section]);
  const { data, error, loading, refreshing, reload, refetch } = useData(loader);

  // A new section: load it now (focus already loaded the first one).
  useEffect(() => {
    void refetch();
  }, [section, refetch]);

  // Keep it current while it's on screen, like the website's register.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refetch(), POLL_MS);
      return () => clearInterval(timer);
    }, [refetch]),
  );

  const scope =
    user?.role === "warden" ? "Your hostels' students only." : "Every hostel's students.";
  const current = data?.section === section ? data : undefined;

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
      <Segmented
        label="Hostel office"
        value={section}
        onChange={(next) => router.setParams({ section: next })}
        options={SECTIONS}
      />
      {section === "requests" ? (
        <Heading
          title="Outing requests"
          lede={`Today's forms. Once approved, the student can tap out once, for up to the day's limit. ${scope}`}
        />
      ) : section === "escalations" ? (
        <Heading
          title="Escalations"
          tone="danger"
          lede={`Late students who didn't answer the "are you OK?" alert within 10 minutes. Call them, their emergency contact or their warden. ${scope}`}
        />
      ) : (
        <Heading title="Who's out" lede={`Late first. ${scope}`} />
      )}

      {error && !current ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !current ? (
        <T tone="muted">Loading…</T>
      ) : current?.section === "requests" ? (
        current.items.length === 0 ? (
          <Empty text="No outing requests today." />
        ) : (
          <View style={{ gap: space(4) }}>
            {current.items.map((r) => (
              <RequestCard key={r.id} request={r} onDecided={() => void refetch()} />
            ))}
          </View>
        )
      ) : current?.section === "escalations" ? (
        current.items.length === 0 ? (
          <Empty text="Nothing to follow up. Late students who don't answer appear here." />
        ) : (
          <View style={{ gap: space(4) }}>
            {current.items.map((e) => (
              <EscalationCard key={e.id} escalation={e} onResolved={() => void refetch()} />
            ))}
          </View>
        )
      ) : current?.section === "out" ? (
        <OutList outings={current.items} />
      ) : null}
    </Screen>
  );
}

function Empty({ text }: { text: string }): ReactNode {
  return (
    <T tone="muted" style={{ textAlign: "center", paddingVertical: space(8) }}>
      {text}
    </T>
  );
}

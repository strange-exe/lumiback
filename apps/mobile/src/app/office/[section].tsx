import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { everyHostel, searchAfterTyping } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { Escalation, HelpRequest, OfficeOuting, OfficeRequest } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { BackList } from "@/screens/office/BackList";
import { EscalationCard } from "@/screens/office/EscalationCard";
import { HelpList } from "@/screens/office/HelpList";
import { OutList } from "@/screens/office/OutList";
import { RequestCard } from "@/screens/office/RequestCard";
import { Field, Heading, Screen, Segmented, T } from "@/ui/kit";
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
  | {
      section: "escalations";
      items: Escalation[];
      /** Students who pressed Help; null when that list failed (said so, never "nobody"). */
      help: HelpRequest[] | null;
      helpError: string | null;
    }
  | { section: "out"; items: OfficeOuting[]; back: OfficeOuting[] };

function sectionOf(value: unknown): SectionName {
  return SECTIONS.some((s) => s.value === value) ? (value as SectionName) : "requests";
}

/** `search`: Who's out only, a student's name or roll number (the API keeps it to the office's
 * own hostels). */
async function load(section: SectionName, search: string): Promise<Loaded> {
  switch (section) {
    case "requests":
      return { section, items: await office.requests() };
    case "escalations": {
      const [items, help] = await Promise.all([
        office.escalations(),
        office.help("open").then(
          (list) => ({ list, error: null }),
          (e: unknown) => ({
            list: null,
            error: e instanceof ApiError ? e.detail : "Something went wrong.",
          }),
        ),
      ]);
      return { section, items, help: help.list, helpError: help.error };
    }
    case "out": {
      const [items, back] = await Promise.all([
        office.outings(search || null),
        office.backToday(search || null),
      ]);
      return { section, items, back };
    }
  }
}

/** One screen, three sections; the section is in the URL so a notification can open it. */
export default function OfficeScreen(): ReactNode {
  const params = useLocalSearchParams<{ section: string }>();
  const section = sectionOf(params.section);
  const { user } = useAuth();
  const c = useColors();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const loader = useCallback(() => load(section, search), [section, search]);
  const { data, error, loading, refreshing, reload, refetch } = useData(loader);

  // A new section or search: load it now (focus already loaded the first one).
  useEffect(() => {
    void refetch();
  }, [section, search, refetch]);

  // Keep it current while it's on screen, like the website's register.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refetch(), POLL_MS);
      return () => clearInterval(timer);
    }, [refetch]),
  );

  const scope = everyHostel(user?.role)
    ? "Every hostel's students."
    : "Your hostels' students only.";
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
          lede={`Students who pressed Help, then late students who didn't answer the "are you OK?" alert within 10 minutes, or answered but still aren't back an hour later. Call them, their emergency contact or their warden. ${scope}`}
        />
      ) : (
        <>
          <Heading title="Who's out" lede={`Late first. ${scope}`} />
          <Field
            label="Search"
            placeholder="Student name or roll number"
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSearch((applied) => searchAfterTyping(text, applied));
            }}
            // The API refuses searches under 2 letters; don't show one as applied when it isn't.
            onSubmitEditing={() => setSearch(query.trim().length >= 2 ? query.trim() : "")}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            hint="Press search on the keyboard. At least 2 letters."
          />
        </>
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
        <View style={{ gap: space(8) }}>
          <HelpList
            items={current.help}
            error={current.helpError}
            onChanged={() => void refetch()}
          />
          <View style={{ gap: space(3) }}>
            <T tone="headline" accessibilityRole="header">
              Late students
            </T>
            {current.items.length === 0 ? (
              <Empty text="Nothing to follow up. Late students who don't answer appear here." />
            ) : (
              <View style={{ gap: space(4) }}>
                {current.items.map((e) => (
                  <EscalationCard key={e.id} escalation={e} onChanged={() => void refetch()} />
                ))}
              </View>
            )}
          </View>
        </View>
      ) : current?.section === "out" ? (
        <View style={{ gap: space(8) }}>
          <OutList outings={current.items} onChanged={() => void refetch()} />
          <BackList outings={current.back} onChanged={() => void refetch()} />
        </View>
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

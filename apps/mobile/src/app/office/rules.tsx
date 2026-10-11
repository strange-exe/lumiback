import { useCallback, type ReactNode } from "react";
import { Linking, RefreshControl, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { canEditRules, DAY_LABEL, dayLine } from "@/lib/office";
import { office } from "@/lib/office-api";
import { formatDate } from "@/lib/time";
import { useData } from "@/lib/use-data";
import { Heading, Row, Screen, Section, StatusChip, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

/** The outing rules each hostel follows, and the holidays. Read here; edited on the website. */
export default function Rules(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const editor = canEditRules(user?.role);
  const load = useCallback(async () => {
    const year = new Date().getFullYear();
    const [sets, holidays] = await Promise.all([office.ruleSets(), office.holidays(year)]);
    // Today on the campus clock (IST, UTC+5:30), as the API's YYYY-MM-DD dates are.
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    return { sets, holidays: holidays.filter((h) => h.day >= today) };
  }, []);
  const { data, error, loading, refreshing, reload } = useData(load);

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
        title="Rules"
        lede={
          editor
            ? "When students may go out, when they must be back, and which days need approval. Change them on the website, where the full form fits."
            : "When your hostel's students may go out, when they must be back, and which days need approval. Only an admin or a head warden can change them."
        }
      />
      {editor ? (
        <T
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${WEB_URL}/admin/rules`).catch(() => undefined)}
          style={{ color: c.accent }}
        >
          Edit rules on the website
        </T>
      ) : null}
      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : (
        <>
          {(data?.sets ?? []).map((set) => (
            <Section
              key={set.id}
              title={set.name}
              footer={
                set.hostels.length > 0
                  ? `Followed by ${set.hostels.join(", ")}.`
                  : "No hostel follows these rules yet."
              }
            >
              {set.is_default ? (
                <View style={{ padding: space(4) }}>
                  <StatusChip label="Default for students without a hostel" tone="accent" />
                </View>
              ) : null}
              {set.days.map((d) => (
                <Row key={d.day_type} title={DAY_LABEL[d.day_type]} detail={dayLine(d)} />
              ))}
            </Section>
          ))}
          <Section
            title="Holidays"
            footer="On these dates the holiday rules apply, whatever day they fall on."
          >
            {(data?.holidays ?? []).length === 0 ? (
              <Row title="No upcoming holidays this year" />
            ) : (
              (data?.holidays ?? []).map((h) => (
                <Row key={h.day} title={h.name} detail={formatDate(`${h.day}T12:00:00+05:30`)} />
              ))
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

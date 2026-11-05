import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { campusToday, canEditRules, DAY_LABEL, dayLine, parseHolidayDate } from "@/lib/office";
import { office } from "@/lib/office-api";
import { formatDate } from "@/lib/time";
import type { Holiday } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import {
  Button,
  Card,
  Field,
  FormError,
  Heading,
  LoadFailed,
  Row,
  Screen,
  Section,
  StatusChip,
  T,
} from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

function holidayDate(day: string): string {
  return formatDate(`${day}T12:00:00+05:30`);
}

/** The outing rules each hostel follows, and the holidays. Rules are read here and edited on
 * the website; admins and head wardens can add and remove holidays here too. */
export default function Rules(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const editor = canEditRules(user?.role);
  const load = useCallback(async () => {
    const year = Number(campusToday().slice(0, 4));
    // This year's and next year's, so a date added for January shows in December.
    const [sets, thisYear, nextYear] = await Promise.all([
      office.ruleSets(),
      office.holidays(year),
      office.holidays(year + 1),
    ]);
    const today = campusToday();
    return { sets, holidays: [...thisYear, ...nextYear].filter((h) => h.day >= today) };
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
            ? "When students may go out, when they must be back, and which days need approval. Change the hours on the website, where the full form fits; add and remove holidays here."
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
      {!data && loading ? (
        <T tone="muted">Loading…</T>
      ) : !data ? (
        <LoadFailed
          title="Couldn't load the rules"
          message={error}
          after="The outing hours and holidays show here once Lumiback can be reached."
          busy={refreshing}
          onRetry={reload}
        />
      ) : (
        <>
          <FormError message={error} />
          {data.sets.map((set) => (
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
          <Holidays holidays={data.holidays} editor={editor} onChanged={reload} />
        </>
      )}
    </Screen>
  );
}

function Holidays({
  holidays,
  editor,
  onChanged,
}: {
  holidays: Holiday[];
  editor: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (h: Holiday): Promise<void> => {
    setRemoving(h.day);
    setError(null);
    try {
      await office.removeHoliday(h.day);
      haptic.success();
      await onChanged();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : `Couldn't remove ${h.name}. Try again.`);
    } finally {
      setRemoving(null);
    }
  };

  const confirmRemove = (h: Holiday): void =>
    Alert.alert(
      `Remove ${h.name}?`,
      `${holidayDate(h.day)} goes back to its usual rules for every hostel.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove(h) },
      ],
    );

  return (
    <>
      <Section
        title="Holidays"
        footer="On these dates the holiday rules apply, whatever day they fall on."
      >
        {holidays.length === 0 ? (
          <Row title="No upcoming holidays" />
        ) : (
          holidays.map((h) => (
            <Row
              key={h.day}
              title={h.name}
              detail={holidayDate(h.day)}
              trailing={
                editor ? (
                  <Pressable
                    onPress={() => confirmRemove(h)}
                    disabled={removing !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${h.name}`}
                    accessibilityState={{ disabled: removing !== null, busy: removing === h.day }}
                    hitSlop={4}
                    android_ripple={{ color: c.line, borderless: true }}
                    style={{
                      width: 44,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: removing === h.day ? 0.4 : 1,
                    }}
                  >
                    <Ionicons name="trash-outline" size={20} color={c.danger} />
                  </Pressable>
                ) : undefined
              }
            />
          ))
        )}
      </Section>
      <FormError message={error} />
      {editor ? <AddHoliday onAdded={onChanged} /> : null}
    </>
  );
}

/** Admins and head wardens: a date and a name; adding a date that's already a holiday renames it. */
function AddHoliday({ onAdded }: { onAdded: () => Promise<void> }): ReactNode {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    setNotice(null);
    const parsed = parseHolidayDate(date, campusToday());
    if ("error" in parsed) return setError(parsed.error);
    const holidayName = name.trim();
    if (!holidayName) return setError("Name the holiday, for example Diwali.");
    setBusy(true);
    setError(null);
    try {
      await office.setHoliday({ day: parsed.day, name: holidayName });
      haptic.success();
      setDate("");
      setName("");
      setNotice(`Added ${holidayName} on ${holidayDate(parsed.day)}.`);
      await onAdded();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't add the holiday. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <T tone="headline">Add a holiday</T>
        <T tone="caption">The holiday rules apply that day in every hostel.</T>
      </View>
      <Field
        label="Date"
        placeholder="25/12/2026"
        hint="Day/month/year"
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Field label="Name" placeholder="Diwali" value={name} onChangeText={setName} maxLength={60} />
      <FormError message={error} />
      {notice ? (
        <T tone="muted" accessibilityRole="alert">
          {notice}
        </T>
      ) : null}
      <Button label="Add holiday" busy={busy} busyLabel="Adding…" onPress={() => void add()} />
    </Card>
  );
}

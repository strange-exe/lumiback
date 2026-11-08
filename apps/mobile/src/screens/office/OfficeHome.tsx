import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";

import { canEditRules, everyHostel, isAdmin } from "@/lib/office";
import type { OfficeOverview, Role } from "@/lib/types";
import { FormError, LoadFailed, Row, Section, StatusChip, T } from "@/ui/kit";
import { LedBoard, LedFigure } from "@/ui/led";
import { space, useColors } from "@/ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** What the office does, in two groups: today's work, then the hostels and their setup.
 * Shown as a staff member's Today. Counts come only from a loaded overview: offline or on a
 * server error it says so, never "0 escalations". */
export function OfficeHome({
  role,
  overview: data,
  error,
  loading,
  refreshing,
  onRetry,
  onSendNotice,
}: {
  role: Role | undefined;
  overview: OfficeOverview | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  onRetry: () => Promise<void>;
  /** Opens "Send a notice" (the sheet lives with the screen, which makes the API call). */
  onSendNotice: () => void;
}): ReactNode {
  const c = useColors();
  const all = everyHostel(role);
  const rulesEditor = canEditRules(role);

  const icon = (name: IconName, tone: string = c.accentText): ReactNode => (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.accentSoft,
      }}
    >
      <Ionicons name={name} size={20} color={tone} />
    </View>
  );
  const chevron = <Ionicons name="chevron-forward" size={18} color={c.muted} />;
  const count = (n: number, tone: "danger" | "accent"): ReactNode =>
    n > 0 ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <StatusChip label={String(n)} tone={tone} />
        {chevron}
      </View>
    ) : (
      chevron
    );
  const open = (section: "requests" | "escalations" | "out"): void =>
    router.push({ pathname: "/office/[section]", params: { section } });

  let today: ReactNode;
  if (data) {
    const help = data.open_help ?? 0;
    const escalations = data.open_escalations;
    const requests = data.pending_requests;
    const corrections = data.corrections;
    const late = data.overdue;
    const out = data.out_now + late;
    today = (
      <>
        {/* The office's headline numbers on the LED board; the rows below say the same. */}
        <LedBoard
          glow
          label="Out now"
          reading={{
            text: String(out),
            state: "out",
            unit: "out",
            label: `${out} ${out === 1 ? "student" : "students"} out`,
          }}
        >
          <LedFigure
            size={40}
            reading={{
              text: String(late),
              state: late > 0 ? "late" : "in",
              unit: "late",
              label: `${late} late`,
            }}
          />
        </LedBoard>
        <Section title="Today">
          {/* Only while someone is waiting: Help goes first, above the late students. */}
          {help > 0 ? (
            <Row
              leading={icon("hand-left-outline", c.danger)}
              title="Asked for help"
              detail={`${help} ${help === 1 ? "student pressed" : "students pressed"} Help`}
              trailing={count(help, "danger")}
              onPress={() => open("escalations")}
            />
          ) : null}
          <Row
            leading={icon("alert-circle-outline", escalations > 0 ? c.danger : c.accentText)}
            title="Escalations"
            detail={
              escalations > 0
                ? `${escalations} late ${escalations === 1 ? "student needs" : "students need"} follow-up`
                : "Late students who don't answer or aren't back"
            }
            trailing={count(escalations, "danger")}
            onPress={() => open("escalations")}
          />
          <Row
            leading={icon("document-text-outline")}
            title="Outing requests"
            detail={requests > 0 ? `${requests} waiting for you` : "Today's forms"}
            trailing={count(requests, "accent")}
            onPress={() => open("requests")}
          />
          <Row
            leading={icon("create-outline")}
            title="Corrections"
            detail={
              corrections > 0
                ? `${corrections} to look at`
                : "Students' asks and return times to fix"
            }
            trailing={count(corrections, "accent")}
            onPress={() => router.push("/office/corrections")}
          />
          <Row
            leading={icon("walk-outline")}
            title="Who's out"
            detail={`${data.out_now + late} out${late > 0 ? `, ${late} late` : ""}`}
            trailing={chevron}
            onPress={() => open("out")}
          />
          <Row
            leading={icon("moon-outline")}
            title="Late today"
            detail="Back late, or still out past their time"
            trailing={chevron}
            onPress={() => router.push("/office/late")}
          />
          <Row
            leading={icon("megaphone-outline")}
            title="Send a notice"
            detail="To students out now, or ask them back"
            trailing={chevron}
            onPress={onSendNotice}
          />
        </Section>
        {/* A refresh failed: these are the last counts that loaded. */}
        <FormError message={error} />
      </>
    );
  } else if (loading) {
    today = <T tone="muted">Loading today&apos;s counts…</T>;
  } else {
    today = (
      <LoadFailed
        title="Couldn't load the office"
        message={error}
        after="Escalations, requests and who's out show here once Lumiback can be reached."
        busy={refreshing}
        onRetry={onRetry}
      />
    );
  }

  return (
    <>
      {today}
      <Section title={all ? "Hostels and setup" : "Your hostels"}>
        <Row
          leading={icon("people-outline")}
          title="Students"
          detail={
            isAdmin(role)
              ? "By hostel; change roles"
              : all
                ? "Every hostel's students and contacts"
                : "Your hostels' students and contacts"
          }
          trailing={chevron}
          onPress={() => router.push("/office/students")}
        />
        <Row
          leading={icon("call-outline")}
          title={all ? "Hostel contacts" : "Warden contact"}
          detail="The name and number students see while out"
          trailing={chevron}
          onPress={() => router.push("/office/hostel")}
        />
        <Row
          leading={icon("scan-outline")}
          title="Gate scans"
          detail="Every scan, including refused ones"
          trailing={chevron}
          onPress={() => router.push("/office/scans")}
        />
        <Row
          leading={icon("time-outline")}
          title="Rules"
          detail={
            rulesEditor
              ? "Outing hours, and add or remove holidays"
              : "Your hostel's outing hours and holidays (view only)"
          }
          trailing={chevron}
          onPress={() => router.push("/office/rules")}
        />
        <Row
          leading={icon("qr-code-outline")}
          title="Gates"
          detail={
            isAdmin(role) ? "Add gates and kiosk links" : "Which gates take scans (view only)"
          }
          trailing={chevron}
          onPress={() => router.push("/office/gates")}
        />
      </Section>
    </>
  );
}

/** One line on what this person's office covers. */
export function officeScope(role: Role | undefined): string {
  if (isAdmin(role)) return "Every hostel's students, and the campus setup.";
  if (role === "head_warden") {
    return "Every hostel's students, and the outing rules. Gates and roles are set by an admin.";
  }
  return "For your hostels' students only. Rules and gates are set by an admin.";
}

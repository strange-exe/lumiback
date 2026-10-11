import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";

import { canEditRules, everyHostel } from "@/lib/office";
import type { OfficeOverview, Role } from "@/lib/types";
import { Row, Section, StatusChip } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** What the office does, in two groups: today's work, then the hostels and their setup.
 * Shown as a staff member's Today, and as the office's own first screen. */
export function OfficeHome({
  role,
  overview: data,
}: {
  role: Role | undefined;
  overview: OfficeOverview | undefined;
}): ReactNode {
  const c = useColors();
  const all = everyHostel(role);
  const rulesEditor = canEditRules(role);
  const escalations = data?.open_escalations ?? 0;
  const requests = data?.pending_requests ?? 0;
  const late = data?.overdue ?? 0;

  const icon = (name: IconName, tone: string = c.accent): ReactNode => (
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

  return (
    <>
      <Section title="Today">
        <Row
          leading={icon("alert-circle-outline", escalations > 0 ? c.danger : c.accent)}
          title="Escalations"
          detail={
            escalations > 0
              ? `${escalations} late ${escalations === 1 ? "student isn't" : "students aren't"} answering`
              : "Late students who don't answer"
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
          leading={icon("walk-outline")}
          title="Who's out"
          detail={
            data ? `${data.out_now + late} out${late > 0 ? `, ${late} late` : ""}` : undefined
          }
          trailing={chevron}
          onPress={() => open("out")}
        />
      </Section>
      <Section title={all ? "Hostels and setup" : "Your hostels"}>
        <Row
          leading={icon("people-outline")}
          title="Students"
          detail={
            role === "admin"
              ? "By hostel; change roles"
              : all
                ? "Every hostel's students and contacts"
                : "Your hostels' students and contacts"
          }
          trailing={chevron}
          onPress={() => router.push("/office/students")}
        />
        <Row
          leading={icon("time-outline")}
          title="Rules"
          detail={
            rulesEditor ? "Outing hours and holidays" : "Your hostel's outing hours (view only)"
          }
          trailing={chevron}
          onPress={() => router.push("/office/rules")}
        />
        <Row
          leading={icon("qr-code-outline")}
          title="Gates"
          detail={
            role === "admin" ? "Add gates and kiosk links" : "Which gates take scans (view only)"
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
  if (role === "admin") return "Every hostel's students, and the campus setup.";
  if (role === "head_warden") {
    return "Every hostel's students, and the outing rules. Gates and roles are set by an admin.";
  }
  return "For your hostels' students only. Rules and gates are set by an admin.";
}

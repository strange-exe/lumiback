import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, type ComponentProps, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { office } from "@/lib/office-api";
import { useData } from "@/lib/use-data";
import { Heading, Row, Screen, Section, StatusChip } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Everything the hostel office does, in two groups: today's work, then the hostels' setup. */
export default function OfficeHub(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const warden = user?.role === "warden";
  const load = useCallback(() => office.overview(), []);
  const { data, refreshing, reload } = useData(load);
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
  const open = (pathname: "/office/[section]", section: string): void =>
    router.push({ pathname, params: { section } });

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
        title="Hostel office"
        lede={
          warden
            ? "For your hostels' students only. Rules and gates are set by an admin."
            : "Every hostel's students, and the campus setup."
        }
      />
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
          onPress={() => open("/office/[section]", "escalations")}
        />
        <Row
          leading={icon("document-text-outline")}
          title="Outing requests"
          detail={requests > 0 ? `${requests} waiting for you` : "Today's forms"}
          trailing={count(requests, "accent")}
          onPress={() => open("/office/[section]", "requests")}
        />
        <Row
          leading={icon("walk-outline")}
          title="Who's out"
          detail={
            data ? `${data.out_now + late} out${late > 0 ? `, ${late} late` : ""}` : undefined
          }
          trailing={chevron}
          onPress={() => open("/office/[section]", "out")}
        />
      </Section>
      <Section title={warden ? "Your hostels" : "Hostels and setup"}>
        <Row
          leading={icon("people-outline")}
          title="Students"
          detail={warden ? "Your hostels' students and contacts" : "By hostel; change roles"}
          trailing={chevron}
          onPress={() => router.push("/office/students")}
        />
        <Row
          leading={icon("time-outline")}
          title="Rules"
          detail={warden ? "Your hostel's outing hours (view only)" : "Outing hours and holidays"}
          trailing={chevron}
          onPress={() => router.push("/office/rules")}
        />
        <Row
          leading={icon("qr-code-outline")}
          title="Gates"
          detail={warden ? "Which gates take scans (view only)" : "Add gates and kiosk links"}
          trailing={chevron}
          onPress={() => router.push("/office/gates")}
        />
      </Section>
    </Screen>
  );
}

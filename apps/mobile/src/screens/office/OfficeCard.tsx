import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, type ReactNode } from "react";
import { View } from "react-native";

import { office } from "@/lib/office-api";
import { officeStart } from "@/lib/office";
import { useData } from "@/lib/use-data";
import { Press, T } from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

/** For wardens and admins, on Today: what needs the hostel office now, one tap from it. */
export function OfficeCard({ warden }: { warden: boolean }): ReactNode {
  const c = useColors();
  const load = useCallback(() => office.overview(), []);
  const { data } = useData(load);
  const escalations = data?.open_escalations ?? 0;
  const requests = data?.pending_requests ?? 0;
  const late = data?.overdue ?? 0;
  const urgent = escalations > 0;

  const facts = data
    ? [
        escalations > 0
          ? `${escalations} late ${escalations === 1 ? "student isn't" : "students aren't"} answering`
          : null,
        requests > 0 ? `${requests} ${requests === 1 ? "request" : "requests"} to decide` : null,
        `${data.out_now + late} out${late > 0 ? `, ${late} late` : ""}`,
      ].filter((f): f is string => f !== null)
    : ["Requests, escalations and who's out"];

  return (
    <Press
      onPress={() =>
        router.push({
          pathname: "/office/[section]",
          params: { section: data ? officeStart(data) : "requests" },
        })
      }
      accessibilityLabel={`Hostel office. ${facts.join(". ")}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        padding: space(4),
        borderRadius: radius.sheet,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: urgent ? c.danger : c.line,
        backgroundColor: urgent ? c.dangerSoft : c.surface,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: urgent ? c.danger : c.accentSoft,
        }}
      >
        <Ionicons
          name={urgent ? "alert" : "shield-checkmark"}
          size={22}
          color={urgent ? c.surface : c.accent}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: fonts.semibold }}>
          {warden ? "Hostel office · your hostels" : "Hostel office"}
        </T>
        {facts.map((fact, i) => (
          <T
            key={fact}
            tone="caption"
            style={i === 0 && urgent ? { color: c.danger, fontFamily: fonts.semibold } : undefined}
          >
            {fact}
          </T>
        ))}
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.muted} />
    </Press>
  );
}

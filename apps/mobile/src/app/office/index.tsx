import { useCallback, type ReactNode } from "react";
import { RefreshControl } from "react-native";

import { useAuth } from "@/lib/auth";
import { office } from "@/lib/office-api";
import { useData } from "@/lib/use-data";
import { OfficeHome, officeScope } from "@/screens/office/OfficeHome";
import { Heading, Screen } from "@/ui/kit";
import { useColors } from "@/ui/theme";

/** The office's first screen (from Profile, or a link); staff also get it as Today. */
export default function OfficeHub(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const load = useCallback(() => office.overview(), []);
  const { data, refreshing, reload } = useData(load);
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
      <Heading title="Hostel office" lede={officeScope(user?.role)} />
      <OfficeHome role={user?.role} overview={data} />
    </Screen>
  );
}

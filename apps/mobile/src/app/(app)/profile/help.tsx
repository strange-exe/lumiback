import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Updates from "expo-updates";
import { useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";

import { SUPPORT_EMAIL } from "@/lib/config";
import { supportMailto } from "@/lib/support";
import { CURRENT } from "@/updates/changelog";
import { Row, Screen, Section, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

const FAQ: { q: string; a: string }[] = [
  {
    q: "When can I go out?",
    a: "Weekday and Saturday evenings need no form. On days that need approval (currently Sundays and holidays), ask the hostel office from the Today tab on the day, then tap out once it's approved. You get one approved outing a day. Some hostels also need no form in the evening on those days. The Today tab always shows your hostel's times.",
  },
  {
    q: "What happens if I'm late?",
    a: "You get a reminder before you're due. Return times can't be extended. At 30 minutes late the app asks if you're OK; answer \"On my way\" or \"I'm safe\". With no answer 10 minutes later, the hostel office is told and may call you or your emergency contact.",
  },
  {
    q: "Who can see my location?",
    a: "Only people you approve while you're sharing. You see everyone who can view you on the Live tab, and you can remove anyone at any time. If you're over 40 minutes late, don't answer, and are sharing right then, the hostel office also sees your last position, and that look shows in your viewer list.",
  },
  {
    q: "Does Lumiback track me in the background?",
    a: "Only while you are sharing, and Android shows a notification the whole time. When sharing ends, location stops. The app never asks for background location access.",
  },
  {
    q: "Why did my share end by itself?",
    a: "Shares end when their time runs out, or if your phone stops sending its location for 15 minutes (for example with no signal or a flat battery).",
  },
  {
    q: "Someone sent me a code. What do I do?",
    a: "Open Live, choose Follow someone and enter the code, or paste the whole message. You'll see their location once they approve you.",
  },
  {
    q: "How long is my data kept?",
    a: "Gate scans, outing requests, records of who viewed your share, and records of how late follow-ups were handled are deleted after your hostel's retention period (180 days by default). Your outings and your share list stay until you delete your account. The privacy notice on Profile has the details.",
  },
  {
    q: "How do I delete my data?",
    a: "Profile, then Delete account. Your outings, shares and contacts are removed permanently, and anyone watching you loses access straight away.",
  },
];

/** Opens the mail app; without one (openURL rejects), offers the address to copy instead. */
async function emailSupport(): Promise<void> {
  try {
    await Linking.openURL(
      supportMailto({
        version: CURRENT.version,
        runtimeVersion: Updates.runtimeVersion,
        updateId: Updates.updateId,
      }),
    );
  } catch {
    Alert.alert("No email app found", `Write to ${SUPPORT_EMAIL}.`, [
      { text: "Close", style: "cancel" },
      {
        text: "Copy address",
        onPress: () => void Clipboard.setStringAsync(SUPPORT_EMAIL).catch(() => undefined),
      },
    ]);
  }
}

export default function Help(): ReactNode {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Screen edges={["bottom"]}>
      <Section>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <Pressable
              key={item.q}
              onPress={() => setOpen(expanded ? null : i)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              android_ripple={{ color: c.line }}
              style={{ paddingHorizontal: space(4), paddingVertical: space(4), gap: space(2) }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
                <T tone="label" style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
                  {item.q}
                </T>
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={c.muted}
                />
              </View>
              {expanded ? <T tone="muted">{item.a}</T> : null}
            </Pressable>
          );
        })}
      </Section>

      <Section
        title="Still stuck?"
        footer="If it's urgent, for example you're out and running late, call your hostel office or warden directly."
      >
        <Row
          leading={<Ionicons name="mail-outline" size={20} color={c.accent} />}
          title="Email Lumiback support"
          detail={SUPPORT_EMAIL}
          trailing={<Ionicons name="open-outline" size={18} color={c.muted} />}
          onPress={() => void emailSupport()}
          accessibilityLabel={`Email Lumiback support at ${SUPPORT_EMAIL}`}
        />
      </Section>
    </Screen>
  );
}

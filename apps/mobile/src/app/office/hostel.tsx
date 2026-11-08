import { useCallback, useState, type ReactNode } from "react";
import { AccessibilityInfo, RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CONTACT_NOTE, contactBody, contactForm, contactSaved } from "@/lib/hostel-contact";
import { everyHostel } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { OfficeHostel } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, Heading, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

/**
 * The warden contact for the hostels this person looks after (every hostel for head wardens
 * and admins), as on the website's My hostel page. The number is shown to students while out,
 * on escalations, and in the Help email to the emergency contact.
 */
export default function HostelContacts(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const load = useCallback(() => office.hostels(), []);
  const { data, error, loading, refreshing, reload } = useData(load);
  const all = everyHostel(user?.role);
  const title = all ? "Hostel contacts" : data?.length === 1 ? "My hostel" : "My hostels";

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
      <Heading title={title} lede={CONTACT_NOTE} />
      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : data ? (
        data.length === 0 ? (
          <T tone="muted" style={{ textAlign: "center", paddingVertical: space(8) }}>
            No hostels are assigned to you yet. Ask an admin to add you as a hostel&apos;s warden.
          </T>
        ) : (
          <View style={{ gap: space(4) }}>
            {data.map((h) => (
              <ContactCard key={h.id} hostel={h} />
            ))}
          </View>
        )
      ) : null}
    </Screen>
  );
}

function ContactCard({ hostel: first }: { hostel: OfficeHostel }): ReactNode {
  const c = useColors();
  const [hostel, setHostel] = useState(first);
  const [form, setForm] = useState(() => contactForm(first));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (): Promise<void> => {
    const checked = contactBody(form);
    if ("error" in checked) {
      setError(checked.error);
      setSaved(false);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const now = contactSaved(await office.saveHostelContact(hostel.id, checked.body), hostel.id);
      if (now) {
        setHostel(now);
        setForm(contactForm(now)); // the phone as stored, e.g. +91 added
      }
      haptic.success();
      setSaved(true);
      AccessibilityInfo.announceForAccessibility(`${hostel.name}: saved.`);
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (patch: Partial<typeof form>): void => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  return (
    <Card flat>
      <View style={{ gap: space(1) }}>
        <T tone="headline" accessibilityRole="header">
          {hostel.name}
        </T>
        <T tone="caption">
          {`${hostel.students} ${hostel.students === 1 ? "student" : "students"}, follows ${hostel.rule_set}`}
        </T>
      </View>
      <Field
        label="Warden"
        value={form.name}
        onChangeText={(name) => edit({ name })}
        maxLength={80}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
      />
      <Field
        label="Warden's phone"
        value={form.phone}
        onChangeText={(phone) => edit({ phone })}
        maxLength={24}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="98765 43210"
        returnKeyType="done"
      />
      <FormError message={error} />
      <Button label="Save contact" busy={busy} busyLabel="Saving…" onPress={() => void save()} />
      {saved ? (
        <T tone="label" style={{ color: c.good }}>
          Saved.
        </T>
      ) : null}
    </Card>
  );
}

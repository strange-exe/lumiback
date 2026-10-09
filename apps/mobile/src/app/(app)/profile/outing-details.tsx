import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState, type ReactNode } from "react";
import { View } from "react-native";

import { api, ApiError } from "@/lib/api";
import type { HostelChoice, Profile } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import { Button, Field, FormError, Notice, Press, Row, Screen, Section, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { radius, space, useColors } from "@/ui/theme";

/**
 * What the outing rules need from a student: their hostel (which decides the rules) and contacts
 * for when they're late and don't answer (also prefilled on weekend outing forms).
 */
export default function OutingDetails(): ReactNode {
  const c = useColors();
  const load = useCallback(
    async () =>
      Promise.all([api<Profile>("/profile"), api<HostelChoice[]>("/hostels")]).then(
        ([profile, hostels]) => ({ profile, hostels }),
      ),
    [],
  );
  const { data, error, reload } = useData(load);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hostelError, setHostelError] = useState<string | null>(null);

  const pickHostel = async (id: string): Promise<void> => {
    setPicking(false);
    setSaving(true);
    setHostelError(null);
    try {
      await api("/profile", { method: "PATCH", body: { hostel_id: id } });
      haptic.success();
      await reload();
    } catch (e) {
      haptic.warning();
      setHostelError(e instanceof ApiError ? e.detail : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const hostels = data?.hostels ?? [];
  const chosen = hostels.find((h) => h.id === data?.profile.hostel_id) ?? null;
  // Grouped by the rules they follow: "Boys' hostels", "Girls' hostels".
  const groups = [...new Set(hostels.map((h) => h.rule_set))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, hostels: hostels.filter((h) => h.rule_set === name) }));

  return (
    <Screen edges={["bottom"]}>
      <FormError message={error} />
      <View style={{ gap: space(1.5) }}>
        <T tone="label">Your hostel</T>
        <Press
          onPress={() => {
            haptic.tap();
            setPicking(true);
          }}
          disabled={!data || hostels.length === 0}
          accessibilityLabel={`Your hostel: ${chosen ? chosen.name : "not chosen"}. Opens the list of hostels.`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space(3),
            minHeight: 52,
            paddingHorizontal: space(4),
            borderRadius: radius.control,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.raised,
          }}
        >
          <View style={{ flex: 1, gap: 2, paddingVertical: space(2) }}>
            <T style={{ color: chosen ? c.ink : c.muted }}>
              {saving
                ? "Saving…"
                : chosen
                  ? chosen.name
                  : hostels.length === 0
                    ? "No hostels yet"
                    : "Choose your hostel"}
            </T>
            {chosen ? <T tone="caption">{chosen.rule_set}</T> : null}
          </View>
          <Ionicons name="chevron-down" size={20} color={c.muted} />
        </Press>
      </View>
      <FormError message={hostelError} />
      <T tone="caption">
        {hostels.length === 0
          ? "The hostel office adds hostels. Check back later."
          : "Your hostel decides your outing hours and how long weekend outings can be."}
      </T>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Choose your hostel">
        {groups.map((g) => (
          <Section key={g.name} title={g.name}>
            {g.hostels.map((h) => (
              <Row
                key={h.id}
                title={h.name}
                trailing={
                  chosen?.id === h.id ? (
                    <Ionicons name="checkmark-circle" size={22} color={c.accent} />
                  ) : null
                }
                onPress={() => void pickHostel(h.id)}
              />
            ))}
          </Section>
        ))}
      </Sheet>
      {/* Mounted once the profile has loaded, so the fields start with what's saved. */}
      {data ? <ContactsForm initial={data.profile} onSaved={reload} /> : null}
    </Screen>
  );
}

function ContactsForm({
  initial,
  onSaved,
}: {
  initial: Profile;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [name, setName] = useState(initial.emergency_name ?? "");
  const [relation, setRelation] = useState(initial.emergency_relation ?? "");
  const [emergency, setEmergency] = useState(initial.emergency_phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/profile", {
        method: "PATCH",
        body: {
          contacts: {
            phone,
            emergency_name: name.trim(),
            emergency_relation: relation.trim(),
            emergency_phone: emergency,
          },
        },
      });
      haptic.success();
      setSaved(true);
      await onSaved();
    } catch (e) {
      haptic.warning();
      setError(
        e instanceof ApiError && e.status === 422
          ? "Check the details: a 10-digit mobile, or add the country code (+)."
          : e instanceof ApiError
            ? e.detail
            : "Couldn't save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space(4) }}>
      <T tone="label">Contacts</T>
      <T tone="muted">
        If you&apos;re late and don&apos;t answer the app, the hostel office may call you or your
        emergency contact. They&apos;re also filled in on weekend outing forms.
      </T>
      <Field
        label="Your phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="98765 43210"
        maxLength={24}
      />
      <Field label="Emergency contact's name" value={name} onChangeText={setName} maxLength={80} />
      <Field
        label="Relation"
        value={relation}
        onChangeText={setRelation}
        placeholder="Mother"
        maxLength={40}
      />
      <Field
        label="Their phone number"
        value={emergency}
        onChangeText={setEmergency}
        keyboardType="phone-pad"
        maxLength={24}
      />
      <FormError message={error} />
      {saved ? <Notice>Saved.</Notice> : null}
      <Button label="Save contacts" busy={busy} busyLabel="Saving…" onPress={() => void save()} />
    </View>
  );
}

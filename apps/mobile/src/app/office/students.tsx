import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { office } from "@/lib/office-api";
import type { OfficeHostel, OfficeStudent, Role } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Contact } from "@/screens/office/Contact";
import { haptic } from "@/ui/haptics";
import { Button, Chips, Field, FormError, Heading, Screen, StatusChip, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { fonts, radius, space, useColors } from "@/ui/theme";

const STATUS = {
  in: { label: "In", tone: "muted" },
  out: { label: "Out", tone: "accent" },
  overdue: { label: "Late", tone: "danger" },
} as const;

/** A hostel's students with their contacts (wardens: their hostels only). Admins change roles. */
export default function Students(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const admin = user?.role === "admin";
  const [hostelId, setHostelId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [roleFor, setRoleFor] = useState<OfficeStudent | null>(null);

  const hostels = useData(useCallback(() => office.hostels(), []));
  const load = useCallback(
    () => office.students({ hostelId: hostelId === "all" ? null : hostelId, q: search }),
    [hostelId, search],
  );
  const { data, error, loading, refreshing, reload, refetch } = useData(load);
  useEffect(() => {
    void refetch();
  }, [hostelId, search, refetch]);

  const choices = [
    ...(admin || (hostels.data?.length ?? 0) > 1 ? [{ value: "all", label: "All" }] : []),
    ...(hostels.data ?? []).map((h) => ({ value: h.id, label: h.name })),
  ];

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
        title="Students"
        lede={
          admin
            ? "Students by hostel, with their contacts. Search finds staff too, to change a role."
            : "Your hostels' students, with the contacts they gave."
        }
      />
      {choices.length > 1 ? (
        <Chips label="Hostel" options={choices} value={hostelId} onChange={setHostelId} />
      ) : null}
      <Field
        label="Search"
        placeholder="Name, email or roll number"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => setSearch(query)}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        hint="Press search on the keyboard. At least 2 letters."
      />
      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : data && data.length === 0 ? (
        <T tone="muted" style={{ textAlign: "center", paddingVertical: space(8) }}>
          {search ? `Nobody matches "${search}".` : "No students have chosen this hostel yet."}
        </T>
      ) : (
        <View
          style={{
            backgroundColor: c.surface,
            borderRadius: radius.sheet,
            borderWidth: 1,
            borderColor: c.line,
            overflow: "hidden",
          }}
        >
          {(data ?? []).map((s, i) => (
            <StudentRow
              key={s.id}
              student={s}
              first={i === 0}
              onChangeRole={admin ? () => setRoleFor(s) : undefined}
            />
          ))}
        </View>
      )}
      {admin && roleFor ? (
        <RoleSheet
          person={roleFor}
          hostels={hostels.data ?? []}
          isMe={roleFor.id === user?.id}
          onClose={() => setRoleFor(null)}
          onSaved={() => {
            setRoleFor(null);
            void refetch();
          }}
        />
      ) : null}
    </Screen>
  );
}

function StudentRow({
  student: s,
  first,
  onChangeRole,
}: {
  student: OfficeStudent;
  first: boolean;
  onChangeRole?: () => void;
}): ReactNode {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const status = STATUS[s.status];
  return (
    <View style={first ? undefined : { borderTopWidth: 1, borderTopColor: c.line }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${s.name}, ${
          s.role === "student" ? status.label : s.role === "admin" ? "Admin" : "Warden"
        }. ${open ? "Hide" : "Show"} contacts`}
        android_ripple={{ color: c.line }}
        style={{ padding: space(4), gap: space(1) }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <T style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
            {s.name}
          </T>
          {s.role !== "student" ? (
            <StatusChip label={s.role === "admin" ? "Admin" : "Warden"} tone="accent" />
          ) : (
            <StatusChip label={status.label} tone={status.tone} />
          )}
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.muted} />
        </View>
        <T tone="caption" numberOfLines={1}>
          {[s.roll_no, s.hostel, s.email].filter(Boolean).join(" · ")}
        </T>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: space(4), paddingBottom: space(4), gap: space(3) }}>
          <Contact label="Phone" phone={s.phone} />
          <Contact
            label={`Emergency contact${s.emergency_relation ? ` (${s.emergency_relation})` : ""}`}
            name={s.emergency_name}
            phone={s.emergency_phone}
          />
          {onChangeRole ? (
            <Button label="Change role" variant="secondary" onPress={onChangeRole} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "warden", label: "Warden" },
  { value: "admin", label: "Admin" },
];

/** Admins only: student, warden (of some hostels) or admin, confirmed in words first. */
function RoleSheet({
  person,
  hostels,
  isMe,
  onClose,
  onSaved,
}: {
  person: OfficeStudent;
  hostels: OfficeHostel[];
  isMe: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const c = useColors();
  const [role, setRole] = useState<Role>(person.role);
  // A student usually becomes the warden of their own hostel: start with it ticked.
  const [chosen, setChosen] = useState<string[]>(person.hostel_id ? [person.hostel_id] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = hostels.filter((h) => chosen.includes(h.id)).map((h) => h.name);
  const question =
    role === "admin"
      ? `Make ${person.name} an admin? They'll see every hostel and can change gates, rules, people and settings.`
      : role === "warden"
        ? `Make ${person.name} the warden of ${names.join(", ")}? They'll decide requests and handle escalations for those hostels' students only.`
        : isMe
          ? "Remove your own access to the hostel office? You'll need an admin to give it back."
          : `Make ${person.name} a student? They lose access to the hostel office.`;

  const save = async (): Promise<void> => {
    if (role === "warden" && chosen.length === 0) {
      setError("Choose at least one hostel for a warden.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await office.setRole(person.id, role, chosen);
      haptic.success();
      onSaved();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`Role for ${person.name}`}>
      <View style={{ gap: space(4) }}>
        <Chips label="Role" options={ROLES} value={role} onChange={setRole} />
        {role === "warden" ? (
          <View style={{ gap: space(2) }}>
            <T tone="label">Warden of</T>
            {hostels.map((h) => {
              const on = chosen.includes(h.id);
              return (
                <Pressable
                  key={h.id}
                  onPress={() =>
                    setChosen((now) => (on ? now.filter((x) => x !== h.id) : [...now, h.id]))
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={h.name}
                  style={{
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space(3),
                    paddingHorizontal: space(3),
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: on ? c.accent : c.line,
                    backgroundColor: on ? c.accentSoft : c.raised,
                  }}
                >
                  <Ionicons
                    name={on ? "checkbox" : "square-outline"}
                    size={22}
                    color={on ? c.accent : c.muted}
                  />
                  <T>{h.name}</T>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <FormError message={error} />
        <Button
          label="Save role"
          busy={busy}
          busyLabel="Saving…"
          onPress={() =>
            Alert.alert("Change role?", question, [
              { text: "Cancel", style: "cancel" },
              { text: "Save", onPress: () => void save() },
            ])
          }
        />
      </View>
    </Sheet>
  );
}

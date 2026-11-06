import { useState, type ReactNode } from "react";
import { Alert, View } from "react-native";

import {
  cancelInviteCopy,
  editBody,
  editForm,
  EMPTY_PERSON,
  personBody,
  personFields,
  turnCopy,
  type AccountControls,
  type PersonForm,
} from "@/lib/accounts";
import { ApiError } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { OfficeHostel, OfficeStudent, Role } from "@/lib/types";
import { haptic } from "@/ui/haptics";
import { Button, Chips, Field, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { space } from "@/ui/theme";

const failed = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.detail : fallback;

/**
 * Turn off / on and Cancel invite for one person, each confirmed in words first. The server's
 * reason is shown when it refuses (someone out right now, the last admin, already set up).
 */
export function AccountActions({
  person,
  controls,
  onEdit,
  onChanged,
}: {
  person: OfficeStudent;
  controls: AccountControls;
  onEdit: () => void;
  /** After a change: what happened, in words, and the list reloads. */
  onChanged: (message: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState<"turn" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const off = person.account === "off";

  const run = async (
    which: "turn" | "cancel",
    call: () => Promise<unknown>,
    done: string,
    fallback: string,
  ): Promise<void> => {
    setBusy(which);
    setError(null);
    try {
      await call();
      haptic.success();
      onChanged(done);
    } catch (e) {
      haptic.warning();
      setError(failed(e, fallback));
    } finally {
      setBusy(null);
    }
  };

  const turn = (): void => {
    const copy = turnCopy(person, off);
    Alert.alert(copy.title, copy.message, [
      { text: "Keep it as it is", style: "cancel" },
      {
        text: copy.action,
        style: off ? "default" : "destructive",
        onPress: () =>
          void run(
            "turn",
            () => office.turnAccount(person.id, off),
            off ? `${person.name}'s account is on again.` : `${person.name}'s account is off.`,
            "Couldn't change that. Try again.",
          ),
      },
    ]);
  };

  const cancel = (): void => {
    const copy = cancelInviteCopy(person);
    Alert.alert(copy.title, copy.message, [
      { text: "Keep the invite", style: "cancel" },
      {
        text: "Cancel invite",
        style: "destructive",
        onPress: () =>
          void run(
            "cancel",
            () => office.cancelInvite(person.id),
            `${person.name}'s invite is cancelled.`,
            "Couldn't cancel the invite. Try again.",
          ),
      },
    ]);
  };

  return (
    <View style={{ gap: space(3) }}>
      {controls.edit ? (
        <Button
          label="Edit details"
          variant="secondary"
          accessibilityLabel={`Edit ${person.name}'s details`}
          onPress={onEdit}
        />
      ) : null}
      {controls.turn ? (
        <Button
          label={off ? "Turn on" : "Turn off"}
          variant="secondary"
          accessibilityLabel={`${off ? "Turn on" : "Turn off"} ${person.name}'s account`}
          busy={busy === "turn"}
          busyLabel={off ? "Turning on…" : "Turning off…"}
          onPress={turn}
        />
      ) : null}
      {controls.cancelInvite ? (
        <Button
          label="Cancel invite"
          variant="secondary"
          accessibilityLabel={`Cancel ${person.name}'s invite`}
          busy={busy === "cancel"}
          busyLabel="Cancelling…"
          onPress={cancel}
        />
      ) : null}
      <FormError message={error} />
    </View>
  );
}

/** Correct a name, roll no. or phone (and, for admins, the email). Only what changed is sent. */
export function EditSheet({
  person,
  canEditEmail,
  onClose,
  onSaved,
}: {
  person: OfficeStudent;
  canEditEmail: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [form, setForm] = useState(() => editForm(person));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((now) => ({ ...now, [key]: value }));

  const save = async (): Promise<void> => {
    const result = editBody(person, form, canEditEmail);
    if ("error" in result) return setError(result.error);
    if (Object.keys(result.body).length === 0) return onClose(); // nothing changed
    setBusy(true);
    setError(null);
    try {
      await office.editAccount(person.id, result.body);
      haptic.success();
      onSaved(`Saved ${result.body.name ?? person.name}'s details.`);
    } catch (e) {
      haptic.warning();
      // The server says why: a taken or non-university email, a bad roll no. or phone.
      setError(failed(e, "Couldn't save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`Edit ${person.name}`}>
      <Field
        label="Name"
        value={form.name}
        onChangeText={set("name")}
        autoCapitalize="words"
        maxLength={100}
      />
      {canEditEmail ? (
        <Field
          label="Email"
          hint="A university address. Their next sign-in uses the new one."
          value={form.email}
          onChangeText={set("email")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          maxLength={254}
        />
      ) : null}
      <Field
        label="Roll no."
        hint="Letters and digits. Leave empty to remove it."
        value={form.rollNo}
        onChangeText={set("rollNo")}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={32}
      />
      <Field
        label="Phone"
        hint="Leave empty to remove it."
        value={form.phone}
        onChangeText={set("phone")}
        keyboardType="phone-pad"
        maxLength={20}
      />
      <FormError message={error} />
      <Button label="Save" busy={busy} busyLabel="Saving…" onPress={() => void save()} />
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const ROLES: { value: Role; label: string }[] = (
  ["student", "warden", "head_warden", "admin"] as const
).map((value) => ({ value, label: ROLE_LABEL[value] }));

/** Admins only: add one person, checked like a CSV import row; they're emailed a set-up link. */
export function AddPersonSheet({
  hostels,
  onClose,
  onAdded,
}: {
  hostels: OfficeHostel[];
  onClose: () => void;
  onAdded: (message: string) => void;
}): ReactNode {
  const [form, setForm] = useState<PersonForm>(EMPTY_PERSON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = personFields(form.role);
  const student = form.role === "student";
  const set = (key: Exclude<keyof PersonForm, "role">) => (value: string) =>
    setForm((now) => ({ ...now, [key]: value }));

  const add = async (): Promise<void> => {
    const result = personBody(form);
    if ("error" in result) return setError(result.error);
    setBusy(true);
    setError(null);
    try {
      const added = await office.addPerson(result.body);
      haptic.success();
      onAdded(`Added ${added.name}. A link to choose a password is on its way to ${added.email}.`);
    } catch (e) {
      haptic.warning();
      // 422 says which field and why ("Student ID: is missing"); 409: the email is taken.
      setError(failed(e, "Couldn't add them. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Add a person">
      <Field
        label="Name"
        value={form.name}
        onChangeText={set("name")}
        autoCapitalize="words"
        maxLength={100}
      />
      <Chips
        label="Role"
        options={ROLES}
        value={form.role}
        onChange={(role) => {
          setForm((now) => ({ ...now, role, hostelId: "" }));
          setError(null);
        }}
      />
      <Field
        label="Student ID"
        hint={student ? "Needed for a student." : "Optional for staff."}
        value={form.studentId}
        onChangeText={set("studentId")}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
      />
      <Field
        label="Email"
        hint={
          student
            ? "Optional. Without one it's their student ID @geu.ac.in."
            : "A university address. Needed without a student ID."
        }
        value={form.email}
        onChangeText={set("email")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
      />
      {fields.hostel ? (
        hostels.length > 0 ? (
          <Chips
            label={fields.hostel}
            options={[
              ...(student ? [{ value: "", label: "Not yet" }] : []),
              ...hostels.map((h) => ({ value: h.id, label: h.name })),
            ]}
            value={form.hostelId}
            onChange={set("hostelId")}
          />
        ) : (
          <T tone="muted">No hostels yet. Add one on the website first.</T>
        )
      ) : (
        <T tone="muted">
          {`A ${ROLE_LABEL[form.role].toLowerCase()} sees every hostel, so there's no hostel to choose.`}
        </T>
      )}
      <Field
        label="Phone"
        hint="Optional."
        value={form.phone}
        onChangeText={set("phone")}
        keyboardType="phone-pad"
        maxLength={20}
      />
      {fields.parent ? (
        <View style={{ gap: space(4) }}>
          <Field
            label="Parent's name"
            hint="Optional. Give both, or neither."
            value={form.parentName}
            onChangeText={set("parentName")}
            autoCapitalize="words"
            maxLength={100}
          />
          <Field
            label="Parent's number"
            value={form.parentPhone}
            onChangeText={set("parentPhone")}
            keyboardType="phone-pad"
            maxLength={20}
          />
        </View>
      ) : null}
      <T tone="caption">They get an email with a link to choose a password, valid 7 days.</T>
      <FormError message={error} />
      <Button label="Add" busy={busy} busyLabel="Adding…" onPress={() => void add()} />
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

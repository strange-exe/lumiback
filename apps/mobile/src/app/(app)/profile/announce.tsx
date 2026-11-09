import { Image } from "expo-image";
import { useCallback, useState, type ReactNode } from "react";
import { AccessibilityInfo, Text, View, type TextStyle } from "react-native";

import {
  ANNOUNCE_KINDS,
  AUDIENCE_ROLES,
  announceBody,
  announceConfirm,
  announceDraft,
  announceError,
  announceTiming,
  canAnnounce,
  historyAudience,
  KIND_LABEL,
  KIND_PATTERN,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
  ROLE_LABEL,
  titleGuidance,
  type AnnounceKind,
  type AnnouncePayload,
  type AnnounceState,
  type Announced,
  type Audience,
  type AudienceRole,
  type Banner,
} from "@/lib/announce";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatStamp } from "@/lib/time";
import { CURRENT } from "@/updates/changelog";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import {
  Button,
  Card,
  Chips,
  Field,
  FormError,
  LoadFailed,
  Notice,
  Press,
  Screen,
  T,
} from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

const fmt = (iso: string): string => formatStamp(new Date(iso));
const DRAFT = announceDraft(CURRENT);

/**
 * Developers only: tell every phone with Lumiback, or chosen roles, about a release, a patch,
 * maintenance or a staff notice. A preview shows it as Android draws it; nothing is sent until
 * the developer confirms, and the server checks the role again. No daily limit (owner,
 * 2026-11-09). Like the website's Announce an update.
 */
export default function Announce(): ReactNode {
  const { user } = useAuth();
  const allowedHere = canAnnounce(user);
  // Asked only for a developer as themselves; anyone else never calls it.
  const load = useCallback(
    () => (allowedHere ? api<AnnounceState>("/admin/announcements") : Promise.resolve(null)),
    [allowedHere],
  );
  const { data, error: loadError, loading, reload } = useData(load);
  // After a send: when it went out (until the next load).
  const [sentAt, setSentAt] = useState<string | null>(null);
  // Starts with this release's title, summary and kind (the changelog), ready to edit.
  const [title, setTitle] = useState(DRAFT.title);
  const [line, setLine] = useState(DRAFT.body);
  const [kind, setKind] = useState<AnnounceKind>(DRAFT.kind);
  const [everyone, setEveryone] = useState(true);
  const [roles, setRoles] = useState<AudienceRole[]>([]);
  const [image, setImage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AnnouncePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reached, setReached] = useState<string | null>(null);

  if (!allowedHere) {
    return (
      <Screen edges={["bottom"]}>
        <T tone="muted">This is for developers only.</T>
      </Screen>
    );
  }

  const last = data ? announceTiming(sentAt ? { ...data, last_at: sentAt } : data, fmt) : null;
  const banners = data?.banners ?? [];
  const audience: Audience = everyone ? "everyone" : roles;
  const banner = kind === "feature" ? (banners.find((b) => b.name === image) ?? null) : null;

  const next = (): void => {
    const checked = announceBody(title, line, { kind, audience, image });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setReached(null);
    setConfirming(checked.body);
  };

  // The only place a push is sent from: the confirm step's button.
  const send = async (): Promise<void> => {
    if (!confirming || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Announced>("/admin/announcements", {
        method: "POST",
        body: confirming,
      });
      haptic.success();
      const done = reachedLine(result.devices);
      setSentAt(new Date().toISOString());
      setReached(done);
      setConfirming(null);
      setTitle("");
      setLine("");
      setKind("notice");
      setEveryone(true);
      setRoles([]);
      setImage(null);
      AccessibilityInfo.announceForAccessibility(done);
      reload(); // the history, with this one at the top
    } catch (e) {
      haptic.warning();
      setError(
        e instanceof ApiError
          ? announceError(e.status, e.detail)
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom"]}>
      <T tone="muted">
        A notification on every phone with Lumiback, or on the roles you choose, on the App updates
        channel. A newer one replaces the last one shown. Send it once the update is published.
      </T>

      {loadError && !data ? (
        <LoadFailed
          title="Couldn't check the last announcement"
          message={loadError}
          after="The form opens once it loads."
          busy={loading}
          onRetry={reload}
        />
      ) : !last ? (
        <T tone="muted">Loading…</T>
      ) : (
        <>
          <T tone="body">{last}</T>
          {reached ? <Notice>{reached}</Notice> : null}

          {confirming ? (
            <Card flat>
              <T tone="label">{KIND_LABEL[confirming.kind ?? "notice"]}</T>
              <Preview title={confirming.title} body={confirming.body} banner={banner} />
              <T tone="muted">{announceConfirm(confirming.audience ?? "everyone")}</T>
              <FormError message={error} />
              <View style={{ gap: space(2) }}>
                <Button
                  label={everyone ? "Send to every phone" : "Send to the chosen roles"}
                  busy={busy}
                  busyLabel="Sending…"
                  onPress={() => void send()}
                />
                {busy ? null : (
                  <Button label="Back" variant="quiet" onPress={() => setConfirming(null)} />
                )}
              </View>
            </Card>
          ) : (
            <Card flat>
              <Chips
                label="Kind"
                options={ANNOUNCE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                value={kind}
                onChange={setKind}
                columns={2}
              />
              <Chips
                label="Send to"
                options={[
                  { value: "everyone", label: "Everyone" },
                  { value: "roles", label: "Choose roles" },
                ]}
                value={everyone ? "everyone" : "roles"}
                onChange={(v) => setEveryone(v === "everyone")}
              />
              {everyone ? null : (
                <Ticks
                  label="Roles (one or more)"
                  options={AUDIENCE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  value={roles}
                  onChange={setRoles}
                />
              )}
              <Field
                label="Title"
                hint={`${titleGuidance(title)} Pattern: ${KIND_PATTERN[kind]}`}
                value={title}
                onChangeText={setTitle}
                maxLength={MAX_ANNOUNCE_TITLE}
                placeholder={KIND_PATTERN[kind]}
                returnKeyType="next"
              />
              <Field
                label="One line about it"
                hint={`Up to ${MAX_ANNOUNCE_BODY} characters: what it does, then what to do.`}
                value={line}
                onChangeText={setLine}
                maxLength={MAX_ANNOUNCE_BODY}
                placeholder="Shift your due-back time once per outing."
                returnKeyType="done"
              />
              {kind === "feature" && banners.length > 0 ? (
                <Chips
                  label="Banner (shown when opened)"
                  options={[
                    { value: "", label: "None" },
                    ...banners.map((b) => ({ value: b.name, label: capital(b.name) })),
                  ]}
                  value={image ?? ""}
                  onChange={(v) => setImage(v || null)}
                />
              ) : null}
              <Preview title={title} body={line} banner={banner} />
              <FormError message={error} />
              <Button label="Continue" onPress={next} />
            </Card>
          )}

          {data ? <History state={data} /> : null}
        </>
      )}
    </Screen>
  );
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Any number of choices (checkboxes), in the Chips style. */
function Ticks<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V[];
  onChange: (value: V[]) => void;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(2) }}>
      <T tone="label">{label}</T>
      <View
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}
      >
        {options.map((option) => {
          const on = value.includes(option.value);
          return (
            <View key={option.value} style={{ flexGrow: 1, flexBasis: "30%" }}>
              <Press
                onPress={() =>
                  onChange(on ? value.filter((v) => v !== option.value) : [...value, option.value])
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: 48,
                  borderRadius: radius.control,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? c.accentSoft : c.raised,
                  borderColor: on ? c.accent : c.line,
                }}
              >
                <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink }}>
                  {option.label}
                </Text>
              </Press>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Android's notification, closed (one line each) and opened (the whole text, the banner, and
 * the Changelog and Update buttons). A picture: nothing in it can be pressed.
 */
function Preview({
  title,
  body,
  banner,
}: {
  title: string;
  body: string;
  banner: Banner | null;
}): ReactNode {
  const c = useColors();
  const shownTitle = title.trim() || "Title";
  const shownBody = body.trim() || "What's new";
  const text = { fontFamily: fonts.regular, fontSize: 14, color: c.boardMuted };
  const strong = { fontFamily: fonts.semibold, fontSize: 14, color: c.onBoard };
  const shade = {
    borderWidth: 1,
    borderColor: c.boardLine,
    borderRadius: radius.card,
    borderCurve: "continuous" as const,
    padding: space(3),
    gap: space(1),
  };
  return (
    <View style={{ gap: space(2) }}>
      <T tone="label">Preview (Android)</T>
      <View
        accessible
        accessibilityLabel={`Preview. ${shownTitle}. ${shownBody}.${
          banner ? " With a banner." : ""
        } Buttons: Changelog, Update.`}
        style={{
          backgroundColor: c.board,
          borderRadius: radius.board,
          borderCurve: "continuous",
          padding: space(3),
          gap: space(3),
        }}
      >
        <View style={shade}>
          <AppLine style={{ ...text, fontSize: 12 }} />
          <Text numberOfLines={1} style={strong}>
            {shownTitle}
          </Text>
          <Text numberOfLines={1} style={text}>
            {shownBody}
          </Text>
        </View>
        <View style={shade}>
          <AppLine style={{ ...text, fontSize: 12 }} />
          <Text style={strong}>{shownTitle}</Text>
          <Text style={text}>{shownBody}</Text>
          {banner ? (
            <Image
              source={{ uri: banner.url }}
              contentFit="cover"
              style={{ width: "100%", aspectRatio: 2, borderRadius: 10, marginTop: space(1) }}
            />
          ) : null}
          <View style={{ flexDirection: "row", gap: space(5), paddingTop: space(1) }}>
            <Text style={{ ...strong, color: c.led }}>Changelog</Text>
            <Text style={{ ...strong, color: c.led }}>Update</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function AppLine({ style }: { style: TextStyle }): ReactNode {
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      <Text style={style}>Lumiback</Text>
      <Text style={style}>now</Text>
    </View>
  );
}

/** The last 20 sent, newest first. */
function History({ state }: { state: AnnounceState }): ReactNode {
  const history = state.history;
  if (!history) return null;
  return (
    <Card flat>
      <T tone="label">Sent recently</T>
      {history.length === 0 ? (
        <T tone="muted">Nothing announced yet.</T>
      ) : (
        history.map((h) => (
          <View key={`${h.at}-${h.title}`} accessible style={{ gap: 2, paddingVertical: space(1) }}>
            <T tone="body">{h.title}</T>
            <T tone="muted">
              {[
                fmt(h.at),
                h.kind ? KIND_LABEL[h.kind] : "Update",
                historyAudience(h.audience),
                h.devices === null ? null : `${h.devices} ${h.devices === 1 ? "phone" : "phones"}`,
                h.by,
              ]
                .filter(Boolean)
                .join(", ")}
            </T>
          </View>
        ))
      )}
    </Card>
  );
}

import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  BOARD_CATEGORIES,
  BOARD_HINT,
  boardError,
  bodyCounter,
  checkPost,
  composeParams,
  defaultExpiry,
  draftFill,
  EXPIRY_DAYS,
  expiryLabel,
  hostelPicker,
  olderTimings,
  postedLine,
  reachLine,
  replaceLabel,
  startTarget,
  targetQuery,
  toggleHostel,
  untilText,
  type BoardTarget,
  type ExpiryDays,
} from "@/lib/board";
import { canPostToBoard } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { BoardCategory, BoardReach, BoardSent } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { READ_ONLY, useViewAs } from "@/lib/view-as";
import { TickRow } from "@/screens/office/StaffBoard";
import { haptic } from "@/ui/haptics";
import {
  Button,
  Chips,
  Field,
  FormError,
  Heading,
  LoadFailed,
  Notice,
  Row,
  Screen,
  Section,
  T,
} from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { space, useColors } from "@/ui/theme";

const REACH_WAIT_MS = 400;

function failure(e: unknown, action: "post" | "reach" | "draft"): string {
  return e instanceof ApiError
    ? boardError(e.status, e.detail, action)
    : "Something went wrong. Try again.";
}

type Reach =
  | { state: "none" }
  | { state: "counting" }
  | { state: "ok"; value: BoardReach }
  | { state: "failed" };

/**
 * Write a hostel board post: category, hostels, title, text, how long it shows, then a
 * confirm step that says who it reaches and until when. Opened from the office's board, or
 * from Rules after adding a holiday (?holiday=YYYY-MM-DD&all=1: the holiday's draft, for
 * every hostel).
 */
export default function NewBoardPost(): ReactNode {
  const c = useColors();
  const { user } = useAuth();
  const role = user?.role;
  const viewing = useViewAs() !== null;
  const raw = useLocalSearchParams<{ holiday?: string; all?: string }>();
  const params = composeParams(raw);

  const loadHostels = useCallback(() => office.hostels(), []);
  const hostels = useData(loadHostels);
  // The office's posts, for "Take down the older timings post" (optional: none if it fails).
  const loadPosts = useCallback(() => office.board(), []);
  const posts = useData(loadPosts);

  const [category, setCategory] = useState<BoardCategory>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<BoardTarget | null>(null);
  const [expires, setExpires] = useState<ExpiryDays>(defaultExpiry("general"));
  const expiryTouched = useRef(false);
  const [drafting, setDrafting] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [replace, setReplace] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<BoardSent | null>(null);

  // Until someone ticks a box: the warden's own hostels, or All hostels when the link asks
  // for it (a holiday). Null while the hostels load.
  const target: BoardTarget | null =
    picked ?? (hostels.data ? startTarget(role, hostels.data, params.all) : null);
  const query = target ? targetQuery(target) : null;

  // Who it reaches, counted again a moment after the hostels change. An answer counts only
  // for the hostels it was asked about.
  const [counted, setCounted] = useState<{ query: string; value: BoardReach | null } | null>(null);
  useEffect(() => {
    if (!query) return;
    let live = true;
    const timer = setTimeout(() => {
      office
        .boardReach(query)
        .then((value) => live && setCounted({ query, value }))
        .catch(() => live && setCounted({ query, value: null }));
    }, REACH_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const reach: Reach = !query
    ? { state: "none" }
    : counted?.query !== query
      ? { state: "counting" }
      : counted.value
        ? { state: "ok", value: counted.value }
        : { state: "failed" };

  const pickCategory = (next: BoardCategory): void => {
    setCategory(next);
    if (!expiryTouched.current) setExpires(defaultExpiry(next));
  };

  // A draft from the rules: a timings post (its default expiry unless one was chosen).
  const applyDraft = useCallback(
    (next: { title: string; body: string }, long: boolean) => {
      setTitle(next.title);
      setBody(next.body);
      setCategory("timings");
      if (!expiryTouched.current) setExpires(defaultExpiry("timings"));
      setTooLong(long);
    },
    [setTitle, setBody, setCategory, setExpires, setTooLong],
  );

  /** "Use the outing rules": fills empty fields; asks before replacing what was written. */
  const fromRules = async (): Promise<void> => {
    if (!query) {
      setError("Choose a hostel, or all hostels.");
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const draft = await office.boardDraft(query);
      const result = draftFill({ title, body }, draft);
      if (!result.asks) applyDraft(result, draft.too_long);
      else {
        Alert.alert("Replace what you wrote?", "The outing rules take the place of your text.", [
          { text: "Keep mine", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => applyDraft(result, draft.too_long),
          },
        ]);
      }
    } catch (e) {
      setError(failure(e, "draft"));
    } finally {
      setDrafting(false);
    }
  };

  // From Rules after adding a holiday: its draft, once, as soon as the hostels are set (the
  // form is still empty then, so nothing is replaced).
  const holidayDrafted = useRef(false);
  useEffect(() => {
    if (!params.holiday || !query || holidayDrafted.current || viewing) return;
    holidayDrafted.current = true;
    office
      .boardDraft(query, params.holiday)
      .then((draft) => applyDraft(draft, draft.too_long))
      .catch((e: unknown) => setError(failure(e, "draft")));
  }, [params.holiday, query, viewing, applyDraft]);

  const older =
    category === "timings" && target && posts.data ? olderTimings(posts.data.posts, target) : [];

  const review = (): void => {
    if (!target) return;
    const check = checkPost({
      category,
      title,
      body,
      hostelIds: target.hostelIds,
      allHostels: target.allHostels,
      expiresInDays: expires,
      replaceTimings: false,
    });
    if (!check.ok) {
      setError(check.error);
      AccessibilityInfo.announceForAccessibility(check.error);
      return;
    }
    setError(null);
    setSendError(null);
    setReplace(true);
    setConfirming(true);
  };

  const send = async (): Promise<void> => {
    if (!target) return;
    const check = checkPost({
      category,
      title,
      body,
      hostelIds: target.hostelIds,
      allHostels: target.allHostels,
      expiresInDays: expires,
      replaceTimings: older.length > 0 && replace,
    });
    if (!check.ok) return setSendError(check.error);
    setSending(true);
    setSendError(null);
    try {
      const result = await office.postToBoard(check.body);
      haptic.success();
      setConfirming(false);
      setSent(result);
      // The list now has this post (and not the timings posts it took down): "Write another"
      // stays on this screen, so focus never reloads it.
      void posts.refetch();
      AccessibilityInfo.announceForAccessibility(postedLine(result));
    } catch (e) {
      haptic.warning();
      const words = failure(e, "post");
      setSendError(words);
      AccessibilityInfo.announceForAccessibility(words);
    } finally {
      setSending(false);
    }
  };

  const writeAnother = (): void => {
    setSent(null);
    setTitle("");
    setBody("");
    setTooLong(false);
    setCategory("general");
    expiryTouched.current = false;
    setExpires(defaultExpiry("general"));
  };

  const counter = bodyCounter(body);
  // Speak the counter only when it crosses into "near the limit" or "too long".
  const zone = counter.over ? "over" : counter.announce ? "near" : "ok";
  const lastZone = useRef(zone);
  useEffect(() => {
    if (zone !== lastZone.current && zone !== "ok") {
      AccessibilityInfo.announceForAccessibility(counter.announce);
    }
    lastZone.current = zone;
  }, [zone, counter.announce]);

  if (!canPostToBoard(role)) {
    return (
      <Screen edges={["bottom"]}>
        <Heading title="New board post" />
        <Notice tone="warn">Only the hostel office posts to the hostel board.</Notice>
      </Screen>
    );
  }

  if (sent) {
    return (
      <Screen edges={["bottom"]}>
        <Heading title="Posted" />
        <Notice>{postedLine(sent)}</Notice>
        <Button label="See the board" onPress={() => router.dismissTo("/office/board")} />
        <Button label="Write another" variant="secondary" onPress={writeAnother} />
      </Screen>
    );
  }

  const picker = hostelPicker(role, hostels.data?.length ?? 0);

  return (
    <Screen edges={["bottom"]}>
      <Heading title="New board post" lede={BOARD_HINT} />
      {viewing ? <Notice tone="warn">{READ_ONLY}</Notice> : null}

      <Chips
        label="Category"
        options={BOARD_CATEGORIES.map((o) => ({ value: o.value, label: o.label }))}
        value={category}
        onChange={pickCategory}
        columns={3}
      />

      {!hostels.data && hostels.loading ? (
        <ActivityIndicator
          color={c.accent}
          accessibilityLabel="Loading your hostels"
          style={{ paddingVertical: space(4) }}
        />
      ) : !hostels.data ? (
        <LoadFailed
          title="Couldn't load your hostels"
          message={hostels.error}
          after="Choose who sees the post once Lumiback can be reached."
          busy={hostels.refreshing}
          onRetry={hostels.reload}
        />
      ) : picker === "none" ? (
        <Notice tone="warn">
          You don&apos;t look after a hostel yet. Ask an admin to assign one.
        </Notice>
      ) : (
        <Section title="Who sees it">
          {picker === "one" ? <Row title={hostels.data[0]!.name} detail="Your hostel" /> : null}
          {picker === "every" ? (
            <TickRow
              label="All hostels"
              detail="Every student, including those without a hostel"
              checked={target?.allHostels ?? false}
              onPress={() =>
                setPicked({ hostelIds: [], allHostels: !(target?.allHostels ?? false) })
              }
            />
          ) : null}
          {(picker === "several" || picker === "every") && !target?.allHostels
            ? hostels.data.map((h) => (
                <TickRow
                  key={h.id}
                  label={h.name}
                  checked={target?.hostelIds.includes(h.id) ?? false}
                  onPress={() =>
                    setPicked({
                      hostelIds: toggleHostel(target?.hostelIds ?? [], h.id),
                      allHostels: false,
                    })
                  }
                />
              ))
            : null}
        </Section>
      )}
      {reach.state === "counting" ? (
        <T tone="caption">Counting who it reaches</T>
      ) : reach.state === "ok" ? (
        <T tone="caption">{reachLine(reach.value)}</T>
      ) : reach.state === "failed" ? (
        <T tone="caption">Couldn&apos;t count who it reaches. You can still post.</T>
      ) : null}

      <Button
        label="Use the outing rules"
        variant="secondary"
        busy={drafting}
        busyLabel="Reading the rules"
        onPress={() => void fromRules()}
      />
      {tooLong ? (
        <Notice tone="warn">
          The rules don&apos;t fit in one post (600 characters, 20 lines). Shorten it before you
          send it.
        </Notice>
      ) : null}

      <Field
        label="Title"
        placeholder="Mess closed for Sunday lunch"
        hint="One line, up to 60 characters."
        value={title}
        onChangeText={setTitle}
        returnKeyType="next"
      />
      <Field
        label="Post"
        placeholder="Lunch on Sunday is in the B block mess."
        hint={counter.text}
        value={body}
        onChangeText={setBody}
        multiline
        textAlignVertical="top"
        style={{ minHeight: 140 }}
      />

      <Chips
        label="Shows for"
        options={EXPIRY_DAYS.map((d) => ({ value: String(d), label: expiryLabel(d) }))}
        value={String(expires)}
        onChange={(v) => {
          expiryTouched.current = true;
          setExpires(Number(v) as ExpiryDays);
        }}
      />
      <T tone="caption">{untilText(expires)}</T>

      <FormError message={error} />
      {viewing || picker === "none" || !hostels.data ? null : (
        <Button label="Review and post" onPress={review} />
      )}

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Post to the board?">
        <View style={{ gap: space(1) }}>
          <T tone="headline">{title.trim()}</T>
          <T tone="muted">
            {reach.state === "ok"
              ? `${reachLine(reach.value)}.`
              : "Goes to every student in the hostels you chose."}
          </T>
          <T tone="muted">{untilText(expires)}.</T>
        </View>
        {older.length > 0 ? (
          <Section>
            <TickRow
              label={replaceLabel(older.length)}
              detail={older.map((p) => p.title).join(", ")}
              checked={replace}
              onPress={() => setReplace((v) => !v)}
            />
          </Section>
        ) : null}
        <FormError message={sendError} />
        <Button
          label="Post to the board"
          busy={sending}
          busyLabel="Posting"
          onPress={() => void send()}
        />
        <Button label="Back to editing" variant="quiet" onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  );
}

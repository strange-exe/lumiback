/**
 * The hostel board, office side: one post in the office's list (status, who it reached, who
 * posted it, Withdraw), and the tick boxes the compose form picks hostels with. Bodies are
 * plain text in a <Text>: no HTML, markdown or links.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";

import {
  authorLine,
  CATEGORY_LABEL,
  hostelsLine,
  seenLine,
  STATUS_LABEL,
  withdrawMissing,
} from "@/lib/board";
import { formatStamp } from "@/lib/time";
import type { StaffBoardPost } from "@/lib/types";
import { Button, Press, StatusChip, T } from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

const STATUS_TONE = { active: "good", ended: "muted", withdrawn: "muted" } as const;

/** One post as the office sees it. `onWithdraw`: null hides the button (viewing as a role). */
export function StaffPostCard({
  post,
  onWithdraw,
  busy,
}: {
  post: StaffBoardPost;
  onWithdraw: ((post: StaffBoardPost) => void) | null;
  busy: boolean;
}): ReactNode {
  const c = useColors();
  const missing = withdrawMissing(post);
  const canWithdraw = post.status === "active" && post.can_withdraw && onWithdraw !== null;
  const ended = post.status === "active" ? "Until" : "Showed until";
  return (
    <View
      style={{
        gap: space(2),
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderRadius: radius.card,
        borderCurve: "continuous",
        padding: space(4),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T tone="label" style={{ flex: 1 }}>
          {CATEGORY_LABEL[post.category]}
        </T>
        {/* Status is a word, never colour alone. */}
        <StatusChip label={STATUS_LABEL[post.status]} tone={STATUS_TONE[post.status]} />
      </View>
      <T tone="headline">{post.title}</T>
      <T tone="caption">{hostelsLine(post)}</T>
      <T tone="caption">
        Posted {formatStamp(post.created_at)}. {ended} {formatStamp(post.expires_at)}.
      </T>
      <T>{post.body}</T>
      <T tone="caption" style={{ fontFamily: fonts.medium, color: c.ink }}>
        {seenLine(post)}
      </T>
      <T tone="caption">{missing ?? authorLine(post.author)}</T>
      {canWithdraw ? (
        <Button
          label="Withdraw"
          variant="secondary"
          busy={busy}
          busyLabel="Taking it down"
          accessibilityLabel={`Withdraw: ${post.title}`}
          onPress={() => onWithdraw(post)}
        />
      ) : null}
    </View>
  );
}

/** A tick box row: a hostel, or All hostels. */
export function TickRow({
  label,
  checked,
  onPress,
  detail,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  detail?: string;
}): ReactNode {
  const c = useColors();
  return (
    <Press
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      // The label replaces the row's text for a screen reader, so it carries the detail too.
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        paddingHorizontal: space(4),
        paddingVertical: space(2),
      }}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={24}
        color={checked ? c.accent : c.muted}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <T>{label}</T>
        {detail ? <T tone="caption">{detail}</T> : null}
      </View>
    </Press>
  );
}

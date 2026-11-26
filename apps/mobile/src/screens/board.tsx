/**
 * The hostel board, student side: one post as the board shows it, the Today card, and marking
 * posts read. Bodies are plain text in a <Text>: no HTML, markdown or links.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";

import { CATEGORY_LABEL, cardOnScreen, postA11yLabel, unseenIds, untilLine } from "@/lib/board";
import { student } from "@/lib/student-api";
import { formatStamp } from "@/lib/time";
import type { BoardPost } from "@/lib/types";
import { useViewAs } from "@/lib/view-as";
import { BOARD_ROUTE } from "@/notify/plan";
import { haptic } from "@/ui/haptics";
import { Press, StatusChip, T, type Viewport } from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

/** How many posts the Today card shows. */
export const CARD_POSTS = 2;

export const EMPTY_BOARD = "Nothing on your hostel's board right now.";

/**
 * Marks posts read on the server, once each per screen visit. Never while viewing as another
 * role (the server refuses it, and a preview isn't a student reading). A failed call is
 * forgotten, so the next look tries again.
 */
export function useMarkSeen(): (posts: readonly BoardPost[]) => void {
  const viewing = useViewAs();
  const sent = useRef(new Set<number>());
  return useCallback(
    (posts) => {
      if (viewing) return;
      const ids = unseenIds([...posts]).filter((id) => !sent.current.has(id));
      if (ids.length === 0) return;
      for (const id of ids) sent.current.add(id);
      student.boardSeen(ids).catch(() => {
        for (const id of ids) sent.current.delete(id);
      });
    },
    [viewing],
  );
}

/**
 * Calls `onSeen` whenever enough of a card is in view. The card must be a direct child of the
 * Screen (its layout y is then its place in the scrolled content).
 */
export function useOnScreen(onSeen: () => void): {
  onViewport: (view: Viewport) => void;
  onLayout: (e: LayoutChangeEvent) => void;
} {
  const latest = useRef(onSeen);
  const where = useRef({ top: 0, height: 0, scrollY: 0, viewport: 0 });
  const check = useCallback(() => {
    if (cardOnScreen(where.current)) latest.current();
  }, []);
  // A new onSeen (new posts loaded) counts at once while the card is in view: the card's frame
  // and the scroll may not change, so no layout or scroll event would check it. A layout
  // effect also has the ref current before the first native layout event.
  useLayoutEffect(() => {
    latest.current = onSeen;
    check();
  }, [onSeen, check]);
  const onViewport = useCallback(
    (view: Viewport) => {
      where.current.scrollY = view.scrollY;
      where.current.viewport = view.viewport;
      check();
    },
    [check],
  );
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      where.current.top = e.nativeEvent.layout.y;
      where.current.height = e.nativeEvent.layout.height;
      check();
    },
    [check],
  );
  return { onViewport, onLayout };
}

/** Category and the "New" label: text, never colour alone. */
function PostTop({ post, isNew }: { post: BoardPost; isNew: boolean }): ReactNode {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
      <T tone="label" style={{ flex: 1 }}>
        {CATEGORY_LABEL[post.category]}
      </T>
      {isNew ? <StatusChip label="New" tone="accent" /> : null}
    </View>
  );
}

/** One post in full, on the board screen. */
export function BoardPostView({ post }: { post: BoardPost }): ReactNode {
  const c = useColors();
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
      {/* Read as one: what it is, who it's from, when; the body follows on its own. */}
      <View
        accessible
        accessibilityLabel={postA11yLabel(post, !post.seen)}
        style={{ gap: space(1) }}
      >
        <PostTop post={post} isNew={!post.seen} />
        <T tone="headline">{post.title}</T>
        <T tone="caption">
          {post.from_label}, {formatStamp(post.created_at)}
        </T>
      </View>
      <T tone="body" selectable>
        {post.body}
      </T>
      {/* Already in the label above. */}
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <T tone="caption">{untilLine(post)}</T>
      </View>
    </View>
  );
}

/** The Today card: the newest posts, short, and the way to the whole board. */
export function BoardCard({
  posts,
  onLayout,
}: {
  posts: BoardPost[];
  onLayout: (e: LayoutChangeEvent) => void;
}): ReactNode {
  const c = useColors();
  const shown = posts.slice(0, CARD_POSTS);
  const more =
    posts.length > CARD_POSTS ? `See all ${posts.length} posts` : "Open the hostel board";
  const open = (): void => {
    haptic.tap();
    router.push(BOARD_ROUTE);
  };
  return (
    <View onLayout={onLayout} style={{ gap: space(3) }}>
      <T tone="label" accessibilityRole="header" style={{ color: c.muted }}>
        Hostel board
      </T>
      <View
        style={{
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: radius.card,
          borderCurve: "continuous",
          overflow: "hidden",
        }}
      >
        {shown.length === 0 ? (
          <T tone="muted" style={{ padding: space(4) }}>
            {EMPTY_BOARD}
          </T>
        ) : (
          shown.map((post, i) => (
            <Press
              key={post.id}
              onPress={open}
              accessibilityLabel={postA11yLabel(post, !post.seen)}
              style={[
                { gap: space(1), padding: space(4) },
                i > 0 ? { borderTopWidth: 1, borderTopColor: c.line } : null,
              ]}
            >
              <PostTop post={post} isNew={!post.seen} />
              <T tone="body" style={{ fontFamily: fonts.medium }} numberOfLines={2}>
                {post.title}
              </T>
              <T tone="muted" numberOfLines={2}>
                {post.body}
              </T>
              <T tone="caption">{post.from_label}</T>
            </Press>
          ))
        )}
        {posts.length > 0 ? (
          <Press
            onPress={open}
            accessibilityRole="link"
            accessibilityLabel={more}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space(2),
              minHeight: 48,
              paddingHorizontal: space(4),
              borderTopWidth: 1,
              borderTopColor: c.line,
            }}
          >
            <T tone="label" style={{ flex: 1, color: c.link }}>
              {more}
            </T>
            <Ionicons name="chevron-forward" size={16} color={c.link} />
          </Press>
        ) : null}
      </View>
    </View>
  );
}

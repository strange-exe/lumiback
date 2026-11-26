import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, type ReactNode } from "react";
import { ActivityIndicator, RefreshControl, View } from "react-native";

import { GONE_FROM_BOARD, goneFromBoard } from "@/lib/board";
import { student } from "@/lib/student-api";
import { useData } from "@/lib/use-data";
import { dismissStaleBoardNotifications } from "@/notify/notify";
import { BoardPostView, EMPTY_BOARD, useMarkSeen } from "@/screens/board";
import { FormError, LoadFailed, Notice, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

/**
 * Every post on the student's hostel board, newest first. A board push opens this with the
 * post's id (or its title), so a post taken down since can say so.
 */
export default function BoardScreen(): ReactNode {
  const c = useColors();
  const { post, title } = useLocalSearchParams<{ post?: string; title?: string }>();
  const load = useCallback(async () => {
    const asked = Date.now();
    const board = await student.board();
    // Notifications for posts that ended or were taken down leave the shade.
    void dismissStaleBoardNotifications(board.posts, asked);
    // Which tapped push this list was loaded for.
    return { posts: board.posts, post, title };
  }, [post, title]);
  const { data, error, loading, refreshing, reload, refetch } = useData(load);
  const markSeen = useMarkSeen();
  // The whole list is drawn at once (at most 30 posts): showing it is reading it.
  useEffect(() => {
    if (data) markSeen(data.posts);
  }, [data, markSeen]);
  // A push tapped while this screen is open only changes its params (no new focus): load
  // again, and judge "gone" only on a list loaded after that tap.
  const current = data !== undefined && data.post === post && data.title === title;
  useEffect(() => {
    if (data && !current) void refetch();
  }, [data, current, refetch]);
  const gone = data && current ? goneFromBoard({ post, title }, data.posts) : false;

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
      {!data && loading ? (
        <ActivityIndicator
          color={c.accent}
          accessibilityLabel="Loading the hostel board"
          style={{ paddingVertical: space(6) }}
        />
      ) : !data ? (
        <LoadFailed
          title="Couldn't load the hostel board"
          message={error}
          after="Posts from your hostel office show here once Lumiback can be reached."
          busy={refreshing}
          onRetry={reload}
        />
      ) : (
        <View style={{ gap: space(4) }}>
          <FormError message={error} />
          {gone ? <Notice tone="warn">{GONE_FROM_BOARD}</Notice> : null}
          {data.posts.length === 0 ? (
            <T tone="muted">{EMPTY_BOARD}</T>
          ) : (
            data.posts.map((p) => <BoardPostView key={p.id} post={p} />)
          )}
        </View>
      )}
    </Screen>
  );
}

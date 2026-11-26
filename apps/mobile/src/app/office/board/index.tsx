import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BOARD_HINT, boardError, withdrawPrompt } from "@/lib/board";
import { canPostToBoard, everyHostel } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { StaffBoardPost } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { READ_ONLY, useViewAs } from "@/lib/view-as";
import { StaffPostCard } from "@/screens/office/StaffBoard";
import { haptic } from "@/ui/haptics";
import { Button, FormError, Heading, LoadFailed, Notice, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

/**
 * The office's hostel board: write a post, and every post in this office's hostels with who
 * it reached, roughly how many have seen it (a step of 5, lib/board.ts seenLine), and Withdraw.
 */
export default function OfficeBoard(): ReactNode {
  const c = useColors();
  const { user } = useAuth();
  const viewing = useViewAs() !== null;
  const poster = canPostToBoard(user?.role);
  const load = useCallback(() => office.board(), []);
  const { data, error, loading, refreshing, reload } = useData(load);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const withdraw = async (post: StaffBoardPost): Promise<void> => {
    setWithdrawing(post.id);
    setActionError(null);
    try {
      await office.withdrawBoardPost(post.id);
      haptic.success();
      AccessibilityInfo.announceForAccessibility(`Took down ${post.title}.`);
      await reload();
    } catch (e) {
      haptic.warning();
      const words =
        e instanceof ApiError
          ? boardError(e.status, e.detail, "withdraw")
          : "Something went wrong. Try again.";
      setActionError(words);
      AccessibilityInfo.announceForAccessibility(words);
    } finally {
      setWithdrawing(null);
    }
  };

  const confirmWithdraw = (post: StaffBoardPost): void => {
    const ask = withdrawPrompt(post.title);
    Alert.alert(ask.title, ask.message, [
      { text: "Keep it", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => void withdraw(post) },
    ]);
  };

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
        title="Hostel board"
        lede="Timings, mess, laundry and repairs: every student in the hostels you choose sees it on Today, and gets a notification."
      />
      {poster && viewing ? (
        <Notice tone="warn">{READ_ONLY}</Notice>
      ) : poster ? (
        <View style={{ gap: space(2) }}>
          <Button label="Write a post" onPress={() => router.push("/office/board/new")} />
          <T tone="caption">{BOARD_HINT}</T>
        </View>
      ) : (
        <Notice tone="warn">Only the hostel office posts to the hostel board.</Notice>
      )}
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
          after="Posts for your hostels show here once Lumiback can be reached."
          busy={refreshing}
          onRetry={reload}
        />
      ) : (
        <View style={{ gap: space(4) }}>
          <T tone="headline" accessibilityRole="header">
            {everyHostel(user?.role) ? "On the board" : "On the board for your hostels"}
          </T>
          <FormError message={actionError ?? error} />
          {data.posts.length === 0 ? (
            <T tone="muted">Nothing posted yet. Posts for your hostels show here.</T>
          ) : (
            data.posts.map((p) => (
              <StaffPostCard
                key={p.id}
                post={p}
                busy={withdrawing === p.id}
                onWithdraw={viewing ? null : confirmWithdraw}
              />
            ))
          )}
        </View>
      )}
    </Screen>
  );
}

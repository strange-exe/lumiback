"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { boardApi, studentBoardApi } from "@/features/board/api";
import {
  boardError,
  boardPost,
  postedText,
  postId,
  readBoardForm,
  seenIds,
  targetsFrom,
} from "@/features/board/board";
import { tokenOrSignIn } from "@/features/admin/form";
import { ApiError } from "@/lib/backend";
import { accessToken, viewingAs } from "@/lib/session";
import type { BoardDraft, BoardReach, FormState } from "@/lib/types";

type Action = "post" | "reach" | "draft" | "withdraw";

/** The API's answer, or its refusal in words (a lapsed session goes back to sign in). */
async function call<T>(
  action: Action,
  run: () => Promise<T>,
): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await run() };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: boardError(error.status, error.detail, action) };
    }
    throw error;
  }
}

/** A new board post. The form keeps what was typed (it is controlled), so no fields come back. */
export async function postToBoard(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const checked = boardPost(readBoardForm(form));
  if (!checked.ok) return { error: checked.error };
  const result = await call("post", () => boardApi.post(token, checked.value));
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/board");
  return { error: null, notice: postedText(result.ok) };
}

export async function withdrawBoardPost(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const raw = form.get("post_id");
  const id = postId(typeof raw === "string" ? raw : "");
  if (id === null) return { error: boardError(404, "", "withdraw") };
  const result = await call("withdraw", () => boardApi.withdraw(token, id));
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/board");
  return { error: null, notice: "Taken down. Students no longer see it." };
}

/** Who a post to these hostels would reach now (the form's reach line). */
export async function boardReach(
  targets: unknown,
): Promise<{ ok: BoardReach } | { error: string }> {
  const token = await tokenOrSignIn();
  const checked = targetsFrom(targets);
  if (!checked.ok) return { error: checked.error };
  return call("reach", () => boardApi.reach(token, checked.value));
}

/**
 * The student's board view: marks the posts it rendered as seen, once per view. Best effort
 * (a failure only leaves "New" on them next time). Never while a developer views as a student:
 * nothing is recorded for a view-as session (the API refuses it too).
 */
export async function markBoardSeen(ids: unknown): Promise<"done" | "skipped" | "failed"> {
  const checked = seenIds(ids);
  const token = await accessToken();
  if (checked === null || token === null || (await viewingAs()) !== null) return "skipped";
  try {
    await studentBoardApi.seen(token, checked);
    return "done";
  } catch (error) {
    if (error instanceof ApiError) return "failed";
    throw error;
  }
}

/** "Use the outing rules": a timings post written from these hostels' rules. */
export async function boardDraft(
  targets: unknown,
): Promise<{ ok: BoardDraft } | { error: string }> {
  const token = await tokenOrSignIn();
  const checked = targetsFrom(targets);
  if (!checked.ok) return { error: checked.error };
  return call("draft", () => boardApi.draft(token, checked.value));
}

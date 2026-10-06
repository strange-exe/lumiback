import { NextResponse } from "next/server";

import { callBackend } from "@/lib/backend";
import { errorResponse, isUuid, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";
import type { ShareSession } from "@/lib/types";

/** The sharer's view of their session, polled by the share screen for new join requests. */
export async function GET(_: Request, ctx: RouteContext<"/api/share/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) return plainError(401, "Not signed in");
  try {
    return NextResponse.json(await callBackend<ShareSession>(`/sessions/${id}`, { token }));
  } catch (error) {
    return errorResponse(error);
  }
}

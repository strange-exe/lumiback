import { NextResponse } from "next/server";

import { callBackend } from "@/lib/backend";
import { errorResponse, isUuid, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";
import type { AccessLogEntry } from "@/lib/types";

/** Who has read the sharer's location (viewers and the hostel office), newest first. */
export async function GET(
  _: Request,
  ctx: RouteContext<"/api/share/[id]/access-log">,
): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) return plainError(401, "Not signed in");
  try {
    return NextResponse.json(
      await callBackend<AccessLogEntry[]>(`/sessions/${id}/access-log`, { token }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import { SUPPORT_EMAIL } from "@/lib/config";

/** A mailto: link to support with the app's version and build filled in at the bottom, so a
 * reply can start from the right build. Nothing else about the phone is included. */
export function supportMailto(build: {
  version: string;
  runtimeVersion?: string | null;
  updateId?: string | null;
}): string {
  const id = [build.version, build.runtimeVersion?.slice(0, 8), build.updateId?.slice(0, 8)]
    .filter(Boolean)
    .join(" / ");
  const body = `\n\n\n---\nLumiback ${id}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Lumiback help")}&body=${encodeURIComponent(body)}`;
}

/**
 * Checking out with safe return ticked is the student's own explicit action in that tab, so that
 * tab sends location for the outing's share straight away (see send-here.ts): without this, the
 * contact would see nothing until the student found and tapped "Share location from this
 * browser". Pure (no Next.js imports) so it runs under `node --test`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The outing share the submitting tab should send for, or null. */
export function safeReturnShareToSend(
  ticked: boolean,
  outing: { safe_return_session_id?: string | null } | null,
): string | null {
  const id = outing?.safe_return_session_id;
  return ticked && typeof id === "string" && UUID.test(id) ? id : null;
}

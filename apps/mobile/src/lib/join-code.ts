/**
 * Pull a join code out of whatever the student pasted: the bare code, "ABCDE-FGHJK", or the
 * whole invite message ("Follow my way back on Lumiback: https://…/join#code=…"). The server
 * does the real validation (Crockford base32, look-alike letters); this only finds the candidate.
 */
const CODE = /(?:^|[^0-9A-Z])([0-9A-Z]{5})[-\s]?([0-9A-Z]{5})(?![0-9A-Z])/i;

export function findJoinCode(text: string): string | null {
  const fromLink = /[#?&]code=([0-9A-Z-]{10,11})/i.exec(text);
  const match = fromLink ? CODE.exec(` ${fromLink[1]}`) : CODE.exec(text);
  if (!match) return null;
  return `${match[1]}-${match[2]}`.toUpperCase();
}

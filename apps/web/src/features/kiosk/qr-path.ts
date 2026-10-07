import qrcode from "qrcode-generator";

const QUIET_ZONE = 4; // modules of white border scanners need around the code

/** Dark modules as one SVG path, merging each row's runs: small, crisp at any size. */
export function qrPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, "M"); // M: survives a smudged or glare-hit tablet screen
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`;
    }
  }
  return { path, size: count + QUIET_ZONE * 2 };
}

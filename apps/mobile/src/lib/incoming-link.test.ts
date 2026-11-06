import { MAX_LINK_LENGTH, safeIncomingPath } from "@/lib/incoming-link";

describe("incoming links", () => {
  it("passes the app's real links through unchanged", () => {
    const gate = "lumiback://scan?qr=https%3A%2F%2Flumiback.abhinesh.codes%2Fg%2Fabc.123.XYZ";
    expect(safeIncomingPath(gate)).toBe(gate);
    expect(safeIncomingPath("lumiback://join?code=AB12CD")).toBe("lumiback://join?code=AB12CD");
  });

  it("sends an oversized link to the home screen instead of parsing it", () => {
    const crafted = "lumiback://scan?qr=" + "%E0%A4".repeat(1000);
    expect(crafted.length).toBeGreaterThan(MAX_LINK_LENGTH);
    expect(safeIncomingPath(crafted)).toBe("/");
  });

  it("allows a link exactly at the limit", () => {
    const edge = "lumiback://scan?qr=" + "a".repeat(MAX_LINK_LENGTH - 19);
    expect(edge.length).toBe(MAX_LINK_LENGTH);
    expect(safeIncomingPath(edge)).toBe(edge);
  });
});

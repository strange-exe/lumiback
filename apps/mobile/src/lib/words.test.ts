import { sentence, viaLabel } from "./words";

test("sentence ends with exactly one full stop", () => {
  expect(sentence("Shopping at Pacific Mall")).toBe("Shopping at Pacific Mall.");
  expect(sentence("Shopping at Pacific Mall.")).toBe("Shopping at Pacific Mall.");
  expect(sentence("Movie!")).toBe("Movie.");
  expect(sentence("Dinner?  ")).toBe("Dinner.");
  // Only one is stripped: the rest is the student's own wording.
  expect(sentence("Wait...")).toBe("Wait...");
});

test("viaLabel is verified only for what the gate saw", () => {
  expect(viaLabel({ out_via: "gate", in_via: "gate" })).toEqual({
    label: "Verified at gate",
    verified: true,
  });
  expect(viaLabel({ out_via: "gate", in_via: "self" })).toEqual({
    label: "Out verified at gate",
    verified: true,
  });
  expect(viaLabel({ out_via: "gate", in_via: null }).label).toBe("Out verified at gate");
  expect(viaLabel({ out_via: "self", in_via: "gate" })).toEqual({
    label: "Self-reported",
    verified: false,
  });
  expect(viaLabel({ out_via: "self", in_via: null }).label).toBe("Self-reported");
});

test("viaLabel names returns the office recorded, and ones nobody recorded", () => {
  for (const out_via of ["gate", "self"] as const) {
    expect(viaLabel({ out_via, in_via: "staff" })).toEqual({
      label: "Recorded by the office",
      verified: false,
    });
    expect(viaLabel({ out_via, in_via: "unrecorded" })).toEqual({
      label: "Return time not recorded",
      verified: false,
    });
  }
});

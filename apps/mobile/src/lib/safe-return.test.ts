import { safeReturnNotice, safeReturnOffer } from "./safe-return";

test("the tick is offered only with an emergency email", () => {
  expect(
    safeReturnOffer({ emergency_name: "Sunita Sharma", emergency_email: "s@gmail.com" }),
  ).toEqual({
    kind: "tick",
    name: "Sunita",
  });
  expect(safeReturnOffer({ emergency_name: null, emergency_email: "s@gmail.com" })).toEqual({
    kind: "tick",
    name: "your emergency contact",
  });
  expect(safeReturnOffer({ emergency_name: "Sunita", emergency_email: null })).toEqual({
    kind: "hint",
  });
  expect(safeReturnOffer({ emergency_name: "Sunita" })).toEqual({ kind: "hint" });
  // Profile not loaded: neither, rather than a hint that may be wrong.
  expect(safeReturnOffer(null)).toEqual({ kind: "none" });
});

test("nothing to say when safe return wasn't ticked", () => {
  expect(safeReturnNotice(false, null, null)).toBeNull();
  expect(safeReturnNotice(false, "id", "started")).toBeNull();
});

test("ticked and sending: nothing to fix", () => {
  expect(safeReturnNotice(true, "id", "started")).toBeNull();
});

test("ticked but not started says the contact wasn't emailed", () => {
  expect(safeReturnNotice(true, null, null)).toMatch(/wasn't emailed/);
});

test("emailed but location can't be sent says how to fix it", () => {
  expect(safeReturnNotice(true, "id", "denied")).toMatch(/Allow location/);
  expect(safeReturnNotice(true, "id", "servicesOff")).toMatch(/Turn on location/);
  expect(safeReturnNotice(true, "id", "error")).toMatch(/Send my location/);
  for (const start of ["denied", "servicesOff", "error"] as const) {
    expect(safeReturnNotice(true, "id", start)).toMatch(/^Your emergency contact got the link/);
  }
});

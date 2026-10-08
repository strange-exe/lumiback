import { curfewLine } from "./curfew";

const campus = { curfew: "21:30", curfew_at: "2026-10-08T21:30:00+05:30" };
const at = (ist: string) => Date.parse(`2026-10-08T${ist}:00+05:30`);

test("hours before: when the gates close, and how long is left", () => {
  expect(curfewLine(campus, at("19:20"))).toEqual({
    title: "Gates close at 9:30 PM",
    detail: "In 2 h 10 min",
    urgent: false,
  });
});

test("the last hour is flagged", () => {
  expect(curfewLine(campus, at("20:45"))).toMatchObject({ detail: "In 45 min", urgent: true });
});

test("seconds before still counts as before (rounded up, never '0 min')", () => {
  expect(curfewLine(campus, at("21:29") + 30_000).detail).toBe("In 1 min");
});

test("after curfew: what to do instead", () => {
  expect(curfewLine(campus, at("21:30"))).toEqual({
    title: "Gates closed at 9:30 PM",
    detail: "Heading out now? Pick your return time when you scan.",
    urgent: true,
  });
});

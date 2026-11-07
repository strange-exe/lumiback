import { apiStatusRows, appStatusRows, type ApiStatus } from "@/lib/status";

const HEAD = "0028";
const status = (over: Partial<ApiStatus["database"]> = {}, commit: string | null = null) =>
  ({
    api_version: "0.1.0",
    commit,
    database: { reachable: true, revision: HEAD, head: HEAD, up_to_date: true, ...over },
    server_time: "2026-11-07T16:30:00Z",
  }) satisfies ApiStatus;

const day = (iso: string) => `day(${iso})`;

test("the app's own build: version, runtime, channel, update and when it was made", () => {
  expect(
    appStatusRows(
      {
        version: "1.14.0",
        runtimeVersion: "3b9a63d6b753fdb9d3d3308930fcc962c8ca8b15",
        channel: "production",
        updateId: "01a11f55-aaaa-4bbb-8ccc-dddddddddddd",
        createdAt: new Date("2026-11-07T10:00:00Z"),
        isEmbeddedLaunch: false,
      },
      day,
    ),
  ).toEqual([
    ["App version", "1.14.0"],
    ["Runtime", "3b9a63d6"],
    ["Channel", "production"],
    ["Update", "01a11f55"],
    ["Update made", "day(2026-11-07T10:00:00.000Z)"],
  ]);
});

test("a development or built-in launch says so instead of blanks", () => {
  expect(
    appStatusRows(
      {
        version: "1.14.0",
        runtimeVersion: null,
        channel: null,
        updateId: null,
        createdAt: null,
        isEmbeddedLaunch: true,
      },
      day,
    ),
  ).toEqual([
    ["App version", "1.14.0"],
    ["Runtime", "Development build"],
    ["Channel", "None"],
    ["Update", "Built-in code"],
  ]);
});

test("the API: version, commit, database and migration in words", () => {
  expect(apiStatusRows(status({}, "ABCDEF1234567"), day)).toEqual([
    ["API version", "0.1.0"],
    ["API commit", "abcdef1"],
    ["Database", "Reachable"],
    ["Migration", "Up to date (0028)"],
    ["Server time", "day(2026-11-07T16:30:00Z)"],
  ]);
  const rows = Object.fromEntries(
    apiStatusRows(status({ revision: "0027", up_to_date: false }, "not a sha"), day),
  );
  expect(rows["API commit"]).toBe("Not reported");
  expect(rows["Migration"]).toBe("Behind: the database is at 0027, the code expects 0028");
  const down = Object.fromEntries(
    apiStatusRows(status({ reachable: false, revision: null, up_to_date: false }), day),
  );
  expect(down["Database"]).toBe("Didn't answer");
  expect(down["Migration"]).toBe("Unknown: the database didn't answer (the code expects 0028)");
});

test("code with no migrations says so, never 'null'", () => {
  const rows = Object.fromEntries(
    apiStatusRows(status({ revision: null, head: null, up_to_date: false }), day),
  );
  expect(rows["Migration"]).toBe(
    "Not migrated: the database has no revision (the code expects no migrations)",
  );
});

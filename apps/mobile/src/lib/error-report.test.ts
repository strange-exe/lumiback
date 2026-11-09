import {
  createReporter,
  describeError,
  installHandler,
  MAX_BODY_BYTES,
  pathOnly,
  sendPending,
  trackRejections,
  type ErrorPayload,
  type GlobalHandler,
  type PendingStore,
} from "@/lib/error-report";

/** UTF-8 bytes, counted independently of the code under test. */
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

function memoryStore(initial: string | null = null): PendingStore & { raw: string | null } {
  return {
    raw: initial,
    read() {
      return this.raw;
    },
    write(raw: string) {
      this.raw = raw;
    },
    clear() {
      this.raw = null;
    },
  };
}

function setup(answers: (boolean | "throw" | "reject")[] = [], max?: number) {
  const sent: ErrorPayload[] = [];
  const reporter = createReporter({
    platform: "android",
    version: "1.19.0",
    route: () => "/today?code=123#k",
    max,
    send: (payload) => {
      sent.push(payload);
      const answer = answers.shift() ?? true;
      if (answer === "throw") throw new Error("send blew up");
      if (answer === "reject") return Promise.reject(new Error("offline"));
      return Promise.resolve(answer);
    },
  });
  return { sent, reporter };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a report carries the message, stack, screen path, version and platform", () => {
  const { sent, reporter } = setup();
  const error = new TypeError("x is undefined");
  reporter.report(error);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    message: "TypeError: x is undefined",
    stack: error.stack,
    route: "/today", // never the query string or fragment
    app_version: "1.19.0",
    platform: "android",
  });
});

test("the same error is sent once, and at most a few per run", () => {
  const { sent, reporter } = setup([], 3);
  // Thrown from the same place twice: the same message and first frame.
  const make = () => new Error("same");
  reporter.report(make());
  reporter.report(make());
  expect(sent).toHaveLength(1);
  for (let i = 0; i < 10; i++) reporter.report(new Error(`error ${i}`));
  expect(sent).toHaveLength(3);
});

test("a failed send stops all reporting: no loop when /errors itself fails", async () => {
  for (const failure of [false, "reject", "throw"] as const) {
    const { sent, reporter } = setup([failure]);
    reporter.report(new Error("first"));
    await settle();
    reporter.report(new Error("second"));
    await settle();
    expect(sent).toHaveLength(1);
  }
});

test("fields are cut to the API's limits", () => {
  const { sent, reporter } = setup();
  const error = new Error("m".repeat(900));
  error.stack = "s".repeat(20_000);
  reporter.report(error);
  expect(sent[0]!.message).toHaveLength(500);
  expect(sent[0]!.stack).toHaveLength(8000);
});

test("nothing is reported for nothing", () => {
  const { sent, reporter } = setup();
  reporter.report(null);
  reporter.report(undefined);
  reporter.report("");
  expect(sent).toHaveLength(0);
  expect(describeError(Object.create(null))?.message).toBe("Unknown error");
  expect(pathOnly("/watch/abc?code=1")).toBe("/watch/abc");
});

test("a gate screen's path never carries the gate's code", () => {
  expect(pathOnly("/g/3f2a9c1e.89570238.MMTP1QMYEA")).toBe("/g/[code]");
  expect(pathOnly("/g/abc/extra?x=1")).toBe("/g/[code]");
  expect(pathOnly("/going")).toBe("/going");
});

test("the body always fits the API's byte cap, even for text that is 3 bytes a letter", () => {
  const { sent, reporter } = setup();
  const devanagari = String.fromCodePoint(0x0915, 0x094d, 0x0937);
  const error = new Error(devanagari.repeat(400));
  error.stack = `Error: x\n    at f (index.bundle:1:2)\n${devanagari.repeat(3000)}`;
  reporter.report(error);
  expect(bytes(sent[0])).toBeLessThanOrEqual(MAX_BODY_BYTES);
  expect(MAX_BODY_BYTES).toBeLessThan(16 * 1024);
  expect(sent[0]!.stack!.startsWith("Error: x\n    at f (index.bundle:1:2)")).toBe(true);
  expect(sent[0]!.stack!.length).toBeGreaterThan(1000);
});

test("quotes and newlines count as the two bytes they take in JSON", () => {
  const { sent, reporter } = setup();
  const error = new Error("quotes");
  error.stack = '"\n'.repeat(4000);
  reporter.report(error);
  expect(bytes(sent[0])).toBeLessThanOrEqual(MAX_BODY_BYTES);
});

test("a cut never leaves half of a character made of two code units", () => {
  const { sent, reporter } = setup();
  const error = new Error("emoji");
  error.stack = "x" + String.fromCodePoint(0x1f600).repeat(8000); // pairs from index 1
  reporter.report(error);
  const last = sent[0]!.stack!.charCodeAt(sent[0]!.stack!.length - 1);
  expect(last < 0xd800 || last > 0xdbff).toBe(true);
});

describe("a crash's report survives the crash", () => {
  function crashing(store: PendingStore) {
    const sent: ErrorPayload[] = [];
    // The app dies before the request finishes: the send never settles.
    const reporter = createReporter({
      platform: "android",
      version: "1.19.0",
      route: () => "/today",
      pending: store,
      send: (payload) => {
        sent.push(payload);
        return new Promise<boolean>(() => undefined);
      },
    });
    return { sent, reporter };
  }

  test("a fatal error is saved before it is sent, and sent on the next launch", async () => {
    const store = memoryStore();
    const { reporter } = crashing(store);
    reporter.report(new TypeError("boom"), true);
    expect(store.raw).not.toBeNull();

    // The next launch: sent, then forgotten.
    const next: ErrorPayload[] = [];
    await sendPending(store, async (payload) => {
      next.push(payload);
      return true;
    });
    expect(next).toEqual([
      expect.objectContaining({
        message: "TypeError: boom",
        route: "/today",
        app_version: "1.19.0", // the version that crashed, not the one sending it
        platform: "android",
      }),
    ]);
    expect(store.raw).toBeNull();
  });

  test("an error that isn't fatal is not saved", () => {
    const store = memoryStore();
    crashing(store).reporter.report(new Error("handled later"));
    expect(store.raw).toBeNull();
  });

  test("a fatal report that did get through is not sent again", async () => {
    const store = memoryStore();
    const reporter = createReporter({
      platform: "android",
      route: () => null,
      pending: store,
      send: () => Promise.resolve(true),
    });
    reporter.report(new Error("boom"), true);
    await settle();
    expect(store.raw).toBeNull();
  });

  test("offline at the next launch: kept for the one after", async () => {
    const store = memoryStore();
    crashing(store).reporter.report(new Error("boom"), true);
    const saved = store.raw;
    await sendPending(store, () => Promise.reject(new Error("Network request failed")));
    expect(store.raw).toBe(saved);
    // Refused by the API (too many, or not valid): dropped, never retried forever.
    await sendPending(store, () => Promise.resolve(false));
    expect(store.raw).toBeNull();
  });

  test("a report saved over a week ago, or not a report, is dropped unsent", async () => {
    const send = jest.fn(() => Promise.resolve(true));
    const old = JSON.stringify({
      at: Date.now() - 8 * 24 * 3600 * 1000,
      payload: { message: "old", stack: null, route: null, platform: "android" },
    });
    for (const raw of [old, "not json", '{"at":1}', JSON.stringify({ at: Date.now() })]) {
      const store = memoryStore(raw);
      await sendPending(store, send);
      expect(store.raw).toBeNull();
    }
    expect(send).not.toHaveBeenCalled();
  });

  test("a store that throws never stops the app", async () => {
    const broken: PendingStore = {
      read: () => {
        throw new Error("disk");
      },
      write: () => {
        throw new Error("disk");
      },
      clear: () => {
        throw new Error("disk");
      },
    };
    const { sent, reporter } = crashing(broken);
    expect(() => reporter.report(new Error("boom"), true)).not.toThrow();
    expect(sent).toHaveLength(1); // still sent now
    await expect(sendPending(broken, () => Promise.resolve(true))).resolves.toBeUndefined();
  });
});

describe("trackRejections", () => {
  test("in a release build, unhandled promise rejections are reported", () => {
    const reported: unknown[] = [];
    let options: { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void } | null =
      null;
    const hermes = { enablePromiseRejectionTracker: (o: typeof options) => (options = o) };
    trackRejections(hermes, false, (e) => reported.push(e));
    expect(options!.allRejections).toBe(true);
    const reason = new Error("nobody caught me");
    options!.onUnhandled(1, reason);
    expect(reported).toEqual([reason]);
  });

  test("in development React Native's own tracker (the yellow box) stays", () => {
    const enable = jest.fn();
    trackRejections({ enablePromiseRejectionTracker: enable }, true, () => undefined);
    expect(enable).not.toHaveBeenCalled();
  });

  test("without Hermes' tracker nothing happens", () => {
    expect(() => trackRejections(undefined, false, () => undefined)).not.toThrow();
    expect(() => trackRejections({}, false, () => undefined)).not.toThrow();
  });
});

describe("installHandler", () => {
  test("tells the reporter whether the error is fatal", () => {
    let current: GlobalHandler = () => undefined;
    const host = {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler: GlobalHandler) => {
        current = handler;
      },
    };
    const seen: (boolean | undefined)[] = [];
    installHandler(host, (_error, fatal) => seen.push(fatal));
    current(new Error("a"), true);
    current(new Error("b"), false);
    expect(seen).toEqual([true, false]);
  });

  function utils(previous: GlobalHandler) {
    let current = previous;
    return {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler: GlobalHandler) => {
        current = handler;
      },
      fire: (error: unknown, fatal?: boolean) => current(error, fatal),
    };
  }

  test("reports the error, then hands it to the handler that was there before", () => {
    const calls: string[] = [];
    const fake = utils((_e, fatal) => calls.push(`previous ${String(fatal)}`));
    installHandler(fake, () => calls.push("reported"));
    fake.fire(new Error("boom"), true);
    expect(calls).toEqual(["reported", "previous true"]);
  });

  test("a reporter that throws never stops the previous handler", () => {
    const calls: string[] = [];
    const fake = utils(() => calls.push("previous"));
    installHandler(fake, () => {
      throw new Error("reporter broke");
    });
    fake.fire(new Error("boom"), false);
    expect(calls).toEqual(["previous"]);
  });

  test("installing twice reports once", () => {
    let reports = 0;
    const fake = utils(() => undefined);
    installHandler(fake, () => (reports += 1));
    installHandler(fake, () => (reports += 1));
    fake.fire(new Error("boom"));
    expect(reports).toBe(1);
  });

  test("without ErrorUtils (tests, web) nothing happens", () => {
    expect(() => installHandler(undefined, () => undefined)).not.toThrow();
  });
});

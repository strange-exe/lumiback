import {
  afterStaleAnswer,
  blockedTapCopy,
  confirmCopy,
  gateCode,
  phaseForNewLink,
  refusal,
  scanBody,
  STALE_RESEND_MS,
  staleOuting,
  startPhase,
  toFix,
} from "@/gate/scan";

describe("stale outing at the gate", () => {
  const fix = { lat: 30.27, lng: 78.0, accuracy_m: 8, mocked: false };

  it("always tells the server this app can answer the stale-outing question", () => {
    expect(scanBody("QR", fix, false)).toEqual({
      qr: "QR",
      ...fix,
      safe_return: false,
      ask_if_stale: true,
    });
    expect(scanBody("QR", fix, true)).not.toHaveProperty("intent");
  });

  it("resends the same scan with the answer, still asking", () => {
    expect(scanBody("QR", fix, true, "out")).toEqual({
      qr: "QR",
      ...fix,
      safe_return: true,
      ask_if_stale: true,
      intent: "out",
    });
    expect(scanBody("QR", fix, false, "in")).toMatchObject({ intent: "in", ask_if_stale: true });
  });

  it("recognises the question only in a 409 with the stale_outing code", () => {
    const problem = {
      code: "stale_outing",
      left_at: "2026-11-05T18:10:00+05:30",
      message:
        "Your outing from Thu 5 Nov was never closed. Are you coming back in, or going out now?",
    };
    expect(staleOuting({ status: 409, problem })).toEqual({
      message: problem.message,
      leftAt: "2026-11-05T18:10:00+05:30",
    });
    expect(staleOuting({ status: 422, problem })).toBeNull();
    expect(staleOuting({ status: 409, problem: null })).toBeNull();
    expect(staleOuting({ status: 409, problem: { code: "other", message: "x" } })).toBeNull();
    expect(staleOuting({ status: 409, problem: { code: "stale_outing", message: "m" } })).toEqual({
      message: "m",
      leftAt: null,
    });
  });

  it("resends while the code is still good, else asks for a fresh scan", () => {
    const readAt = 1_000_000;
    expect(afterStaleAnswer(readAt, readAt + 5_000)).toBe("resend");
    expect(afterStaleAnswer(readAt, readAt + STALE_RESEND_MS)).toBe("resend");
    expect(afterStaleAnswer(readAt, readAt + STALE_RESEND_MS + 1)).toBe("rescan");
    // A code is good for at least 40 s after it's read: the resend window stays inside that.
    expect(STALE_RESEND_MS).toBeLessThan(40_000);
  });
});

const GATE = "61c6a6d7-178a-4cee-ac83-b5c43bb6f783";

describe("startPhase", () => {
  it("opens the camera when no code came with the screen", () => {
    expect(startPhase(undefined)).toEqual({ kind: "camera" });
    expect(startPhase("")).toEqual({ kind: "camera" });
  });

  it("asks before using a code that arrived by link: nothing is checked or sent yet", () => {
    const link = `https://lumiback.abhinesh.codes/g/${GATE}.89570238.MMTP1QMYEA`;
    expect(startPhase(link)).toEqual({ kind: "confirm", qr: link });
    expect(startPhase(`  ${GATE}.1.ABCDEFGHJK `)).toEqual({
      kind: "confirm",
      qr: `${GATE}.1.ABCDEFGHJK`,
    });
  });

  it("refuses a link that isn't a gate code", () => {
    expect(startPhase("https://example.com/menu")).toEqual({
      kind: "refused",
      message: "That link isn't a Lumiback gate code.",
      retry: true,
      fallback: true,
    });
  });
});

describe("phaseForNewLink", () => {
  const first = `${GATE}.1.ABCDEFGHJK`;
  const second = `${GATE}.2.ABCDEFGHJK`;

  it("asks again for a new linked code on an open screen, never with safe return", () => {
    for (const shown of ["camera", "confirm", "refused", "done"] as const) {
      expect(phaseForNewLink(first, second, shown)).toEqual({
        phase: { kind: "confirm", qr: second },
        safeReturn: false,
      });
    }
    // The screen was opened for the camera, then a link arrived.
    expect(phaseForNewLink(undefined, first, "camera")).toEqual({
      phase: { kind: "confirm", qr: first },
      safeReturn: false,
    });
  });

  it("refuses a new link that isn't a gate code instead of waiting forever", () => {
    expect(phaseForNewLink(first, "https://example.com/menu", "confirm")).toEqual({
      phase: {
        kind: "refused",
        message: "That link isn't a Lumiback gate code.",
        retry: true,
        fallback: true,
      },
      safeReturn: false,
    });
  });

  it("changes nothing for the same code, a cleared code, or while a check is running", () => {
    expect(phaseForNewLink(first, first, "confirm")).toBeNull();
    expect(phaseForNewLink(first, undefined, "camera")).toBeNull();
    expect(phaseForNewLink(first, "", "camera")).toBeNull();
    expect(phaseForNewLink(first, second, "checking")).toBeNull();
  });
});

describe("confirmCopy", () => {
  it("names the direction once it's known, and stays neutral before", () => {
    expect(confirmCopy(null).title).toBe("Check in or out at this gate?");
    expect(confirmCopy(false).title).toBe("Tap out at this gate?");
    expect(confirmCopy(true).title).toBe("Tap back in at this gate?");
    expect(confirmCopy(false).action).toBe("Tap out");
    expect(confirmCopy(true).action).toBe("Tap in");
    expect(confirmCopy(null).action).toBe("Continue");
  });
});

describe("blockedTapCopy", () => {
  it("says the tap was refused, why, and what to do next, in plain words", () => {
    expect(blockedTapCopy).toMatch(/didn't count/);
    expect(blockedTapCopy).toMatch(/another app is showing something over Lumiback/);
    expect(blockedTapCopy).toMatch(/then tap again\.$/);
    expect(blockedTapCopy).not.toMatch(/overlay attack|tapjack|FLAG_|obscured/i);
  });
});

describe("gateCode", () => {
  it("accepts the kiosk's URL and the bare triple", () => {
    for (const text of [
      `https://lumiback.abhinesh.codes/g/${GATE}.89570238.MMTP1QMYEA`,
      `http://localhost:3000/g/${GATE}.1.ABCDEFGHJK`,
      `${GATE}.89570238.MMTP1QMYEA`,
      `  https://lumiback.abhinesh.codes/g/${GATE}.89570238.mmtp1qmyea  `,
      `https://lumiback.abhinesh.codes/g/${GATE}.89570238.MMTP1QMYEA?utm=x`,
    ]) {
      expect(gateCode(text)).toBe(text.trim());
    }
  });

  it("rejects anything else", () => {
    for (const text of [
      "",
      "https://example.com/menu",
      "WIFI:S:Hostel;T:WPA;P:secret;;",
      `https://lumiback.abhinesh.codes/g/${GATE}.89570238.SHORT`,
      `https://lumiback.abhinesh.codes/g/${GATE}.89570238.MMTP1QMYEAX`,
      `https://lumiback.abhinesh.codes/x/${GATE}.89570238.MMTP1QMYEA`,
      `https://lumiback.abhinesh.codes/g/not-a-uuid.1.MMTP1QMYEA`,
    ]) {
      expect(gateCode(text)).toBeNull();
    }
  });
});

describe("toFix", () => {
  it("passes coordinates, accuracy and the mock flag through", () => {
    expect(
      toFix({ coords: { latitude: 30.2687, longitude: 77.9947, accuracy: 12 }, mocked: true }),
    ).toEqual({ lat: 30.2687, lng: 77.9947, accuracy_m: 12, mocked: true });
  });

  it("treats unknown accuracy as poor and a missing mock flag as false", () => {
    expect(toFix({ coords: { latitude: 1, longitude: 2, accuracy: null } })).toEqual({
      lat: 1,
      lng: 2,
      accuracy_m: 9_999,
      mocked: false,
    });
  });
});

describe("refusal", () => {
  it("passes on the outing rules' reason, without offering to log the trip instead", () => {
    expect(refusal(422, "Weekday outings end at 8:00 PM. Try again tomorrow.")).toEqual({
      kind: "refused",
      message: "Weekday outings end at 8:00 PM. Try again tomorrow.",
      retry: true,
      fallback: false,
    });
  });

  it("lets the student scan again when it might work next time", () => {
    expect(refusal(422, "You're about 300 m from North Gate.")).toEqual({
      kind: "refused",
      message: "You're about 300 m from North Gate.",
      retry: true,
      fallback: false,
    });
    expect(refusal(0, "")).toMatchObject({ kind: "refused", retry: true });
  });

  it("offers the fallback only when the scan itself couldn't be checked", () => {
    expect(refusal(0, "")).toMatchObject({ retry: true, fallback: true });
    expect(refusal(503, "Service unavailable")).toMatchObject({ retry: true, fallback: true });
    expect(refusal(403, "Not allowed")).toMatchObject({ fallback: false });
  });

  it("doesn't offer a retry for a double scan", () => {
    expect(refusal(409, "You just scanned.")).toEqual({
      kind: "refused",
      message: "You just scanned.",
      retry: false,
      fallback: false,
    });
  });
});

import { confirmCopy, gateCode, refusal, startPhase, toFix } from "@/gate/scan";

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

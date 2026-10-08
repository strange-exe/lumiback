import { gateCode, refusal, toFix } from "@/gate/scan";

const GATE = "61c6a6d7-178a-4cee-ac83-b5c43bb6f783";

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
  it("asks for a return time after curfew", () => {
    expect(refusal(428, "It's past curfew. Choose when you'll be back, then scan again.")).toEqual({
      kind: "needs-time",
      message: "It's past tonight's curfew, so choose when you'll be back.",
    });
  });

  it("lets the student scan again when it might work next time", () => {
    expect(refusal(422, "You're about 300 m from North Gate.")).toEqual({
      kind: "refused",
      message: "You're about 300 m from North Gate.",
      retry: true,
    });
    expect(refusal(0, "")).toMatchObject({ kind: "refused", retry: true });
  });

  it("doesn't offer a retry for a double scan", () => {
    expect(refusal(409, "You just scanned.")).toEqual({
      kind: "refused",
      message: "You just scanned.",
      retry: false,
    });
  });
});

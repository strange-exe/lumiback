import {
  accuracyText,
  CALL_ME_SENT,
  CALL_OUTCOMES,
  callLine,
  callMeError,
  claimLine,
  helpError,
  helpPlace,
  helpResult,
  noticeError,
  noticeResult,
  noticeText,
  officeAction,
  osmLink,
  outcomeLabel,
  telHref,
  toHelpFix,
} from "@/lib/alerts";
import type { HelpRequest, HelpSent } from "@/lib/types";

describe("telHref", () => {
  it("keeps only digits and a plus, so no other scheme or text reaches the URL", () => {
    expect(telHref("+919876543210")).toBe("tel:+919876543210");
    expect(telHref("+91 98765 43210")).toBe("tel:+919876543210");
    expect(telHref("0135-2644 000")).toBe("tel:01352644000");
    expect(telHref("javascript:alert(1)")).toBe("tel:1");
  });
});

describe("osmLink", () => {
  it("points OpenStreetMap at the fix, zoomed to street level", () => {
    expect(osmLink(30.3165, 78.0322)).toBe(
      "https://www.openstreetmap.org/?mlat=30.3165&mlon=78.0322#map=17/30.3165/78.0322",
    );
  });

  it("rounds to six decimals (about 10 cm), negatives included", () => {
    expect(osmLink(-33.86881234, 151.20929876)).toBe(
      "https://www.openstreetmap.org/?mlat=-33.868812&mlon=151.209299#map=17/-33.868812/151.209299",
    );
  });

  it("refuses anything that isn't a real coordinate", () => {
    expect(osmLink(Number.NaN, 78)).toBeNull();
    expect(osmLink(30, Number.POSITIVE_INFINITY)).toBeNull();
    expect(osmLink(91, 78)).toBeNull();
    expect(osmLink(30, -181)).toBeNull();
  });
});

describe("accuracyText", () => {
  it("says how close the fix is", () => {
    expect(accuracyText(24.6)).toBe("within 25 m");
    expect(accuracyText(0)).toBe("within 1 m");
    expect(accuracyText(1500)).toBe("within 1.5 km");
  });

  it("says nothing without an accuracy", () => {
    expect(accuracyText(null)).toBeNull();
    expect(accuracyText(Number.NaN)).toBeNull();
    expect(accuracyText(-1)).toBeNull();
  });
});

describe("helpPlace", () => {
  const base: HelpRequest = {
    id: "h1",
    created_at: "2026-11-08T21:05:00+05:30",
    student_id: "5f0c2a1e-0000-4000-8000-000000000001",
    name: "Asha Rawat",
    roll_no: "21CS042",
    phone: "+919876543210",
    hostel: "Ganga",
    lat: 30.3165,
    lng: 78.0322,
    accuracy_m: 18,
    mocked: false,
    returned: false,
    handled_by: null,
    handled_at: null,
    note: null,
  };

  it("gives the map link and how close the fix is", () => {
    expect(helpPlace(base)).toEqual({
      text: "Location sent with it, within 18 m.",
      map: "https://www.openstreetmap.org/?mlat=30.3165&mlon=78.0322#map=17/30.3165/78.0322",
    });
  });

  it("has no map when the phone sent no fix (or it was cleared)", () => {
    expect(helpPlace({ ...base, lat: null, lng: null, accuracy_m: null })).toEqual({
      text: "No location: the phone didn't send one, or it was cleared after a day.",
      map: null,
    });
  });
});

describe("call outcomes", () => {
  it("has words for every outcome the server takes", () => {
    expect(CALL_OUTCOMES.map((o) => o.value)).toEqual([
      "reached_student",
      "reached_contact",
      "no_answer",
      "left_message",
    ]);
    expect(outcomeLabel("reached_contact")).toBe("Reached their emergency contact");
    expect(outcomeLabel("no_answer")).toBe("No answer");
  });

  it("falls back for an outcome a newer server adds", () => {
    expect(outcomeLabel("something_new")).toBe("Call");
  });

  it("writes a call as time, who, outcome and note", () => {
    expect(
      callLine({
        at: "2026-11-08T21:12:00+05:30",
        by: "Meena Joshi",
        outcome: "no_answer",
        note: null,
      }),
    ).toBe("9:12 PM, Meena Joshi: No answer");
    expect(
      callLine({
        at: "2026-11-08T21:20:00+05:30",
        by: null,
        outcome: "reached_student",
        note: "Bus was late",
      }),
    ).toBe('9:20 PM, a former staff member: Reached the student. "Bus was late"');
  });
});

describe("claimLine", () => {
  it("says who is on it", () => {
    expect(claimLine({ claimed_by: "Meena Joshi", claimed_by_me: true })).toBe("You're on it");
    expect(claimLine({ claimed_by: "Meena Joshi", claimed_by_me: false })).toBe(
      "Claimed by Meena Joshi",
    );
  });

  it("says nothing when nobody has it (or an older server sent no claim)", () => {
    expect(claimLine({ claimed_by: null, claimed_by_me: false })).toBeNull();
    expect(claimLine({})).toBeNull();
  });
});

describe("officeAction", () => {
  it("calls the office when the hostel has a number", () => {
    expect(officeAction({ hostel: "Ganga", name: "Warden", phone: "+911352000000" })).toEqual({
      kind: "call",
      phone: "+911352000000",
    });
  });

  it("asks the office to call when there's no number (or only spaces)", () => {
    expect(officeAction({ hostel: "Ganga", name: null, phone: null })).toEqual({ kind: "ask" });
    expect(officeAction({ hostel: "Ganga", name: null, phone: "  " })).toEqual({ kind: "ask" });
    expect(officeAction(null)).toEqual({ kind: "ask" });
    expect(officeAction(undefined)).toEqual({ kind: "ask" });
  });
});

describe("call me copy", () => {
  it("confirms the ask", () => {
    expect(CALL_ME_SENT).toBe("The office has been asked to call you");
  });

  it("explains the hourly limit, and passes other refusals through", () => {
    expect(callMeError(429, "Too many")).toBe(
      "You've already asked a few times this hour. The office has been told; wait for their call.",
    );
    expect(callMeError(404, "You are not on an outing")).toBe("You are not on an outing");
  });
});

describe("helpResult", () => {
  const sent: HelpSent = {
    office: { hostel: "Ganga", name: "Warden", phone: "+911352000000" },
    office_told: 2,
    followers_told: 1,
    contact_told: true,
  };

  it("says help is on its way and who was told", () => {
    expect(helpResult(sent, true)).toEqual({
      title: "Help is on its way to the hostel office",
      detail:
        "Told: the hostel office, 1 person who follows you and your emergency contact. Your location was sent once.",
    });
  });

  it("counts followers and says when no location went", () => {
    expect(helpResult({ ...sent, followers_told: 3, contact_told: false }, false)).toEqual({
      title: "Help is on its way to the hostel office",
      detail: "Told: the hostel office and 3 people who follow you. No location was sent.",
    });
  });

  it("never claims the office was told when it wasn't", () => {
    expect(helpResult({ ...sent, office_told: 0 }, true).title).toBe("Your help alert was sent");
    expect(
      helpResult({ office: null, office_told: 0, followers_told: 0, contact_told: false }, false),
    ).toEqual({
      title: "No one could be told",
      detail: "Call the hostel office or someone you trust now. No location was sent.",
    });
  });

  it("explains the hourly limit", () => {
    expect(helpError(429, "Too many")).toBe(
      "You've sent several help alerts this hour. The office already has them; call them if you can.",
    );
    expect(helpError(404, "You are not on an outing")).toBe("You are not on an outing");
  });
});

describe("notices", () => {
  it("says how many it went to", () => {
    expect(noticeResult(0)).toBe("No one is out right now");
    expect(noticeResult(1)).toBe("Sent to 1 student");
    expect(noticeResult(14)).toBe("Sent to 14 students");
  });

  it("keeps a notice to one line", () => {
    expect(noticeText("  Come back,\n  the gate\tcloses at 9  ")).toBe(
      "Come back, the gate closes at 9",
    );
  });

  it("explains the hourly limit", () => {
    expect(noticeError(429, "Too many")).toBe(
      "You've sent 10 notices this hour. Wait a while before sending another.",
    );
    expect(noticeError(422, "Too long")).toBe("Too long");
  });
});

describe("toHelpFix", () => {
  it("takes one fix as the server wants it, with the mock flag", () => {
    expect(
      toHelpFix({ coords: { latitude: 30.3, longitude: 78.0, accuracy: 12 }, mocked: true }),
    ).toEqual({ lat: 30.3, lng: 78.0, accuracy_m: 12, mocked: true });
    expect(toHelpFix({ coords: { latitude: 30.3, longitude: 78.0, accuracy: null } })).toEqual({
      lat: 30.3,
      lng: 78.0,
      accuracy_m: 0,
      mocked: false,
    });
  });

  it("caps the accuracy at what the server accepts", () => {
    expect(
      toHelpFix({ coords: { latitude: 30.3, longitude: 78.0, accuracy: 250_000 } })?.accuracy_m,
    ).toBe(100_000);
  });

  it("drops a fix that isn't a real coordinate", () => {
    expect(toHelpFix({ coords: { latitude: Number.NaN, longitude: 78, accuracy: 5 } })).toBeNull();
    expect(toHelpFix({ coords: { latitude: 95, longitude: 78, accuracy: 5 } })).toBeNull();
    expect(toHelpFix(null)).toBeNull();
  });
});

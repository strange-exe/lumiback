import {
  CONTACT_NOTE,
  contactBody,
  contactForm,
  contactSaved,
  normalizePhone,
} from "@/lib/hostel-contact";

describe("normalizePhone (as the server stores it)", () => {
  test("Indian mobiles in the usual ways become +91 and ten digits", () => {
    for (const typed of [
      "98765 43210",
      "9876543210",
      "+91-98765-43210",
      "09876543210",
      "919876543210",
      "(98765) 43210",
      "98765.43210",
    ]) {
      expect(normalizePhone(typed)).toEqual({ phone: "+919876543210" });
    }
  });

  test("other countries keep their + code, 8 to 15 digits", () => {
    expect(normalizePhone("+44 20 7946 0958")).toEqual({ phone: "+442079460958" });
    expect(normalizePhone("+1234567")).toEqual({
      error: "Phone numbers have 8 to 15 digits after the country code.",
    });
    expect(normalizePhone("+1234567890123456")).toEqual({
      error: "Phone numbers have 8 to 15 digits after the country code.",
    });
  });

  test("letters, landlines without a code and short numbers are refused", () => {
    expect(normalizePhone("98765abcde")).toEqual({
      error: "A phone number can only have digits.",
    });
    expect(normalizePhone("0135 2712345")).toEqual({
      error: "Enter a 10-digit Indian mobile number, or add the country code (+).",
    });
    expect(normalizePhone("12345")).toEqual({
      error: "Enter a 10-digit Indian mobile number, or add the country code (+).",
    });
    expect(normalizePhone("5876543210")).toEqual({
      error: "Enter a 10-digit Indian mobile number, or add the country code (+).",
    });
  });

  test("longer than the field allows is refused before anything else", () => {
    expect(normalizePhone("9".repeat(25))).toEqual({
      error: "Keep the phone number to 24 characters.",
    });
  });
});

describe("contactBody", () => {
  test("sends both fields, cleaned; an emptied field is null and clears it", () => {
    expect(contactBody({ name: "  Mr Rawat ", phone: "98765 43210" })).toEqual({
      body: { warden_name: "Mr Rawat", warden_phone: "+919876543210" },
    });
    expect(contactBody({ name: "", phone: "  " })).toEqual({
      body: { warden_name: null, warden_phone: null },
    });
  });

  test("a name needs a letter or digit, one line, at most 80 characters", () => {
    expect(contactBody({ name: "--", phone: "" })).toEqual({
      error: "Enter the warden's name.",
    });
    expect(contactBody({ name: "Mr\nRawat", phone: "" })).toEqual({
      error: "Write the name on one line.",
    });
    expect(contactBody({ name: "a".repeat(81), phone: "" })).toEqual({
      error: "Keep the name to 80 characters.",
    });
    expect(contactBody({ name: "a".repeat(80), phone: "" })).toEqual({
      body: { warden_name: "a".repeat(80), warden_phone: null },
    });
  });

  test("a bad phone stops the save with the reason", () => {
    expect(contactBody({ name: "Mr Rawat", phone: "123" })).toEqual({
      error: "Enter a 10-digit Indian mobile number, or add the country code (+).",
    });
  });
});

test("the form starts from what's saved", () => {
  expect(contactForm({ warden_name: "Mr Rawat", warden_phone: "+919876543210" })).toEqual({
    name: "Mr Rawat",
    phone: "+919876543210",
  });
  expect(contactForm({ warden_name: null, warden_phone: null })).toEqual({ name: "", phone: "" });
});

test("saved: the hostel as the server now has it, by id", () => {
  const list = [
    { id: "a", warden_name: "A", warden_phone: null },
    { id: "b", warden_name: "B", warden_phone: "+919876543210" },
  ];
  expect(contactSaved(list, "b")).toEqual(list[1]);
  expect(contactSaved(list, "c")).toBeNull();
});

test("the note says who sees the number", () => {
  expect(CONTACT_NOTE).toBe(
    "The warden's number is shown to the office when a late student doesn't answer, to students while they're out, and in the email their emergency contact gets when they press Help.",
  );
});

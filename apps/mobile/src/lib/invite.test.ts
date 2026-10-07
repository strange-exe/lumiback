import { inviteLink, inviteMessage, whatsappUrl } from "@/lib/invite";

const WEB = "https://lumiback.abhinesh.codes";

test("the link carries the code in the fragment (never sent to servers or logs)", () => {
  expect(inviteLink(WEB, "7K3MP-QR2XD")).toBe(`${WEB}/join#code=7K3MP-QR2XD`);
});

test("the message gives both the link and the code with its expiry in IST", () => {
  const text = inviteMessage(WEB, "7K3MP-QR2XD", "2026-10-07T21:30:00+05:30");
  expect(text).toBe(
    `Follow my way back on Lumiback: ${WEB}/join#code=7K3MP-QR2XD\n` +
      "Or enter code 7K3MP-QR2XD. It works once, until 9:30 PM.",
  );
});

test("WhatsApp gets the whole message, encoded, with no fixed recipient", () => {
  const url = whatsappUrl("Hi & bye\nline #2");
  expect(url).toBe("https://wa.me/?text=Hi%20%26%20bye%0Aline%20%232");
  expect(decodeURIComponent(url.split("text=")[1] ?? "")).toBe("Hi & bye\nline #2");
});

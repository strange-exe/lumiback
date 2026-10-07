import { findJoinCode } from "@/lib/join-code";

test.each([
  ["7k3mp-qr2xd", "7K3MP-QR2XD"],
  ["7K3MPQR2XD", "7K3MP-QR2XD"],
  ["  7K3MP QR2XD ", "7K3MP-QR2XD"],
  [
    "Follow my way back on Lumiback: https://lumiback.abhinesh.codes/join#code=7K3MP-QR2XD\nOr enter code 7K3MP-QR2XD. It works once, until 9:30 PM.",
    "7K3MP-QR2XD",
  ],
  ["https://lumiback.abhinesh.codes/join#code=7K3MP-QR2XD", "7K3MP-QR2XD"],
])("finds the code in %j", (input, expected) => {
  expect(findJoinCode(input)).toBe(expected);
});

test.each(["", "hello", "7K3MP", "7K3MP-QR2XDZZ", "Lumiback"])("rejects %j", (input) => {
  expect(findJoinCode(input)).toBeNull();
});

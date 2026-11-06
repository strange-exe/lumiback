import assert from "node:assert/strict";
import { test } from "node:test";

import {
  changePasswordProblem,
  MAX_PASSWORD_LENGTH,
  passwordChangedNotice,
  PASSWORDS_DIFFER,
} from "./password.ts";

const NEW = "river-lamp-kettle";

test("a complete form with matching new passwords has no problem", () => {
  assert.equal(changePasswordProblem("old-password-1", NEW, NEW), null);
  // Spaces are part of a password: never trimmed, so they must match exactly too.
  assert.equal(changePasswordProblem("old-password-1", ` ${NEW} `, ` ${NEW} `), null);
});

test("both new passwords must match exactly", () => {
  assert.equal(changePasswordProblem("old-password-1", NEW, `${NEW}x`), PASSWORDS_DIFFER);
  assert.equal(changePasswordProblem("old-password-1", NEW, NEW.toUpperCase()), PASSWORDS_DIFFER);
  assert.equal(changePasswordProblem("old-password-1", NEW, ` ${NEW}`), PASSWORDS_DIFFER);
  assert.equal(changePasswordProblem("old-password-1", NEW, ""), PASSWORDS_DIFFER);
  assert.equal(changePasswordProblem("old-password-1", NEW, null), PASSWORDS_DIFFER);
});

test("the current and the new password are both needed", () => {
  assert.equal(changePasswordProblem("", NEW, NEW), "Enter your current password.");
  assert.equal(changePasswordProblem(null, NEW, NEW), "Enter your current password.");
  assert.equal(changePasswordProblem("old-password-1", "", ""), "Choose a new password.");
  // A file input or a missing field is not a password.
  assert.equal(changePasswordProblem("old-password-1", {}, {}), "Choose a new password.");
});

test("a new password over the backend's limit is caught before sending", () => {
  const longest = "a1".repeat(MAX_PASSWORD_LENGTH / 2);
  assert.equal(changePasswordProblem("old-password-1", longest, longest), null);
  const tooLong = `${longest}b`;
  assert.equal(
    changePasswordProblem("old-password-1", tooLong, tooLong),
    "Password must be at most 128 characters",
  );
});

test("the success message counts the other devices signed out", () => {
  assert.equal(passwordChangedNotice(0), "Password changed. No other devices were signed in.");
  assert.equal(passwordChangedNotice(1), "Password changed. Signed out of 1 other device.");
  assert.equal(passwordChangedNotice(2), "Password changed. Signed out of 2 other devices.");
  assert.equal(passwordChangedNotice(12), "Password changed. Signed out of 12 other devices.");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCOUNT_LABEL, accountFilter, editBody, personBody } from "./accounts.ts";

const edit = (over: Partial<Parameters<typeof editBody>[0]> = {}) =>
  editBody({
    name: "Isha Rao",
    rollNo: "24011001",
    phone: "98765 43210",
    phoneKnown: true,
    email: "",
    emailWas: "isha@geu.ac.in",
    ...over,
  });

test("every account state but active is said in words", () => {
  assert.deepEqual(ACCOUNT_LABEL, {
    invited: "Hasn't set up",
    reset: "Password reset sent",
    off: "Turned off",
  });
});

test("only the two list filters are read from the address bar", () => {
  assert.equal(accountFilter("invited"), "invited");
  assert.equal(accountFilter("off"), "off");
  assert.equal(accountFilter("active"), undefined);
  assert.equal(accountFilter("<script>"), undefined);
  assert.equal(accountFilter(undefined), undefined);
});

test("a warden's edit (no email field) never sends an email", () => {
  assert.deepEqual(edit(), {
    body: { name: "Isha Rao", roll_no: "24011001", phone: "98765 43210" },
  });
});

test("an admin's email is sent only when it changed, lowercased", () => {
  assert.equal("email" in (edit({ email: "ISHA@geu.ac.in" }) as { body: object }).body, false);
  assert.deepEqual(edit({ email: " New@GEU.ac.in " }), {
    body: {
      name: "Isha Rao",
      roll_no: "24011001",
      phone: "98765 43210",
      email: "new@geu.ac.in",
    },
  });
});

test("blank roll no. and a known phone are cleared (sent as null)", () => {
  assert.deepEqual(edit({ rollNo: " ", phone: "" }), {
    body: { name: "Isha Rao", roll_no: null, phone: null },
  });
});

test("a blank phone the page didn't know keeps the number (not sent)", () => {
  assert.deepEqual(edit({ phone: "", phoneKnown: false }), {
    body: { name: "Isha Rao", roll_no: "24011001" },
  });
  assert.deepEqual(edit({ phone: "99999 00000", phoneKnown: false }), {
    body: { name: "Isha Rao", roll_no: "24011001", phone: "99999 00000" },
  });
});

test("a name is needed, and a roll no. follows the backend's rule", () => {
  assert.deepEqual(edit({ name: "  " }), { error: "Enter their name." });
  assert.match((edit({ name: "x".repeat(101) }) as { error: string }).error, /100 characters/);
  for (const bad of ["ab", "24 011", "24-011", "x".repeat(33)]) {
    assert.match((edit({ rollNo: bad }) as { error: string }).error, /3 to 32 letters or digits/);
  }
  assert.equal("body" in edit({ rollNo: "abc" }), true);
});

const person = (over: Partial<Parameters<typeof personBody>[0]> = {}) =>
  personBody({
    name: "Isha Rao",
    role: "student",
    studentId: "24011001",
    email: "",
    hostelId: "h3",
    phone: "",
    parentName: "Ravi Rao",
    parentPhone: "91234 56789",
    ...over,
  });

test("a student: blanks become null, so the email defaults from the student ID", () => {
  assert.deepEqual(person(), {
    body: {
      name: "Isha Rao",
      role: "student",
      student_id: "24011001",
      email: null,
      hostel_id: "h3",
      phone: null,
      parent_name: "Ravi Rao",
      parent_phone: "91234 56789",
    },
  });
});

test("a warden keeps the hostel they look after; no parents for staff", () => {
  const result = person({ role: "warden", email: "Warden@geu.ac.in" });
  assert.ok("body" in result);
  const { body } = result;
  assert.equal(body.role, "warden");
  assert.equal(body.hostel_id, "h3");
  assert.equal(body.email, "warden@geu.ac.in");
  assert.equal(body.parent_name, null);
  assert.equal(body.parent_phone, null);
});

test("head wardens and admins look after no single hostel", () => {
  for (const role of ["head_warden", "admin"]) {
    const result = person({ role });
    assert.ok("body" in result);
    assert.equal(result.body.role, role);
    assert.equal(result.body.hostel_id, null);
  }
});

test("an unknown role is a student, and a name is needed", () => {
  assert.equal((person({ role: "principal" }) as { body: { role: string } }).body.role, "student");
  assert.deepEqual(person({ name: " " }), { error: "Enter their name." });
});

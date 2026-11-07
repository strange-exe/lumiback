import {
  ACCOUNT_FILTERS,
  accountControls,
  cancelInviteCopy,
  editBody,
  editForm,
  emptyListText,
  EMPTY_PERSON,
  personBody,
  personFields,
  signInRefusal,
  turnCopy,
} from "@/lib/accounts";
import { studentsQuery } from "@/lib/office";
import type { AccountState, Role } from "@/lib/types";

const person = (role: Role = "student", account: AccountState = "active") => ({
  id: "p1",
  role,
  account,
});
const NONE = {
  turn: false,
  edit: false,
  editEmail: false,
  cancelInvite: false,
  passwordLink: false,
};

describe("accountControls", () => {
  it("gives an admin every control on someone else, email included", () => {
    expect(accountControls({ id: "a", role: "admin" }, person())).toEqual({
      turn: true,
      edit: true,
      editEmail: true,
      cancelInvite: false,
      passwordLink: true,
    });
  });

  it("lets an admin manage staff too", () => {
    const c = accountControls({ id: "a", role: "admin" }, person("warden"));
    expect(c.turn && c.edit && c.editEmail).toBe(true);
  });

  it("offers Cancel invite only to admins, only on an invited account", () => {
    expect(
      accountControls({ id: "a", role: "admin" }, person("student", "invited")).cancelInvite,
    ).toBe(true);
    for (const account of ["active", "reset", "off"] as const) {
      expect(
        accountControls({ id: "a", role: "admin" }, person("student", account)).cancelInvite,
      ).toBe(false);
    }
    expect(
      accountControls({ id: "w", role: "warden" }, person("student", "invited")).cancelInvite,
    ).toBe(false);
  });

  it("hides the password link for an account that's off (the server refuses it)", () => {
    const c = accountControls({ id: "a", role: "admin" }, person("student", "off"));
    expect(c.passwordLink).toBe(false);
    expect(c.turn).toBe(true);
  });

  it("lets wardens and head wardens turn off and edit students, never the email", () => {
    for (const role of ["warden", "head_warden"] as const) {
      expect(accountControls({ id: "w", role }, person())).toEqual({
        ...NONE,
        turn: true,
        edit: true,
      });
    }
  });

  it("gives wardens and head wardens nothing on staff", () => {
    for (const role of ["warden", "head_warden"] as const) {
      for (const target of ["warden", "head_warden", "admin"] as const) {
        expect(accountControls({ id: "w", role }, person(target))).toEqual(NONE);
      }
    }
  });

  it("gives a developer the admin's controls", () => {
    expect(accountControls({ id: "d", role: "developer" }, person())).toEqual(
      accountControls({ id: "a", role: "admin" }, person()),
    );
    expect(accountControls({ id: "d", role: "developer" }, person("admin")).editEmail).toBe(true);
  });

  it("offers nothing on a developer's account (only a server script changes it)", () => {
    for (const role of ["admin", "developer", "head_warden", "warden"] as const) {
      expect(accountControls({ id: "x", role }, person("developer"))).toEqual(NONE);
    }
  });

  it("never offers anything on your own account, or to a student or nobody", () => {
    expect(accountControls({ id: "p1", role: "admin" }, person())).toEqual(NONE);
    expect(accountControls({ id: "s", role: "student" }, person())).toEqual(NONE);
    expect(accountControls(null, person())).toEqual(NONE);
  });
});

describe("turnCopy", () => {
  it("says what turning off does before it happens", () => {
    const copy = turnCopy({ name: "Asha", role: "student" }, false);
    expect(copy.title).toBe("Turn this account off?");
    expect(copy.action).toBe("Turn off");
    expect(copy.message).toBe(
      "Asha is signed out on every phone and can't sign in, and any live share they're in ends. Their outings and history are kept, and you can turn it back on.",
    );
  });

  it("tells an admin a warden's hostels go to other staff", () => {
    expect(turnCopy({ name: "Ravi", role: "warden" }, false).message).toContain(
      "Requests for the hostels they look after go to other staff.",
    );
  });

  it("says turning on lets them sign in again", () => {
    expect(turnCopy({ name: "Asha", role: "student" }, true)).toEqual({
      title: "Turn this account on?",
      message: "Asha can sign in again with their password.",
      action: "Turn on",
    });
  });
});

describe("cancelInviteCopy", () => {
  it("names who and says the link stops working", () => {
    expect(cancelInviteCopy({ name: "Asha", email: "a@geu.ac.in" }).message).toContain(
      "Asha (a@geu.ac.in) hasn't set up yet. Their account is removed and the link they were emailed stops working.",
    );
  });
});

describe("editBody", () => {
  const before = {
    name: "Asha Rao",
    email: "asha@geu.ac.in",
    roll_no: "22CS1",
    phone: "+919876543210",
  };

  it("sends nothing when nothing changed", () => {
    expect(editBody(before, editForm(before), true)).toEqual({ body: {} });
  });

  it("sends only the changed fields, trimmed", () => {
    const form = { ...editForm(before), name: "  Asha R  ", phone: " +919800000000 " };
    expect(editBody(before, form, false)).toEqual({
      body: { name: "Asha R", phone: "+919800000000" },
    });
  });

  it("clears an emptied roll no. or phone with null", () => {
    const form = { ...editForm(before), rollNo: "  ", phone: "" };
    expect(editBody(before, form, false)).toEqual({ body: { roll_no: null, phone: null } });
  });

  it("doesn't send null for a field that was already empty", () => {
    const empty = { ...before, roll_no: null, phone: null };
    expect(editBody(empty, editForm(empty), false)).toEqual({ body: {} });
  });

  it("sends the email only when the viewer may change it, lower-cased", () => {
    const form = { ...editForm(before), email: " New@GEU.ac.in " };
    expect(editBody(before, form, true)).toEqual({ body: { email: "new@geu.ac.in" } });
    expect(editBody(before, form, false)).toEqual({ body: {} });
  });

  it("refuses an empty name, or an emptied email from an admin", () => {
    expect(editBody(before, { ...editForm(before), name: " " }, true)).toEqual({
      error: "Enter their name.",
    });
    expect(editBody(before, { ...editForm(before), email: "" }, true)).toEqual({
      error: "Enter their email address.",
    });
  });
});

describe("the students list filter", () => {
  it("offers everyone, not set up and turned off, in words", () => {
    expect(ACCOUNT_FILTERS.map((f) => f.label)).toEqual([
      "Everyone",
      "Hasn't set up",
      "Turned off",
    ]);
  });

  it("asks the API for one account state, with the hostel and search", () => {
    expect(studentsQuery({})).toBe("");
    expect(studentsQuery({ account: "off" })).toBe("?account=off");
    expect(studentsQuery({ hostelId: "h1", q: "as", account: "invited" })).toBe(
      "?hostel_id=h1&q=as&account=invited",
    );
    expect(studentsQuery({ q: "a", account: null })).toBe("");
  });

  it("says why the list is empty", () => {
    expect(emptyListText("all", "")).toBe("No students have chosen this hostel yet.");
    expect(emptyListText("all", "zz")).toBe('Nobody matches "zz".');
    expect(emptyListText("invited", "")).toBe("Everyone has set up their account.");
    expect(emptyListText("off", "zz")).toBe('No accounts matching "zz" are turned off.');
  });
});

describe("personFields", () => {
  it("asks a student's hostel and parent, a warden's hostel as Looks after, others neither", () => {
    expect(personFields("student")).toEqual({ hostel: "Hostel", parent: true });
    expect(personFields("warden")).toEqual({ hostel: "Looks after", parent: false });
    expect(personFields("head_warden")).toEqual({ hostel: null, parent: false });
    expect(personFields("admin")).toEqual({ hostel: null, parent: false });
  });
});

describe("personBody", () => {
  it("leaves out empty fields (the server derives a student's email)", () => {
    expect(personBody({ ...EMPTY_PERSON, name: " Asha ", studentId: " 22CS1 " })).toEqual({
      body: { name: "Asha", role: "student", student_id: "22CS1" },
    });
  });

  it("sends a student's hostel, phone and parent", () => {
    const form = {
      ...EMPTY_PERSON,
      name: "Asha",
      studentId: "22CS1",
      email: "Asha@GEU.ac.in",
      hostelId: "h1",
      phone: "+919876543210",
      parentName: "Meera",
      parentPhone: "+919800000000",
    };
    expect(personBody(form)).toEqual({
      body: {
        name: "Asha",
        role: "student",
        student_id: "22CS1",
        email: "asha@geu.ac.in",
        hostel_id: "h1",
        phone: "+919876543210",
        parent_name: "Meera",
        parent_phone: "+919800000000",
      },
    });
  });

  it("sends a warden's hostel but no parent, and neither for an admin", () => {
    const form = {
      ...EMPTY_PERSON,
      name: "Ravi",
      email: "ravi@geu.ac.in",
      hostelId: "h1",
      parentName: "left over",
    };
    expect(personBody({ ...form, role: "warden" })).toEqual({
      body: { name: "Ravi", role: "warden", email: "ravi@geu.ac.in", hostel_id: "h1" },
    });
    expect(personBody({ ...form, role: "admin" })).toEqual({
      body: { name: "Ravi", role: "admin", email: "ravi@geu.ac.in" },
    });
  });

  it("asks for a name first; everything else is the server's to check", () => {
    expect(personBody({ ...EMPTY_PERSON, name: "  " })).toEqual({ error: "Enter their name." });
  });
});

describe("signInRefusal", () => {
  it("sends only an unverified email to the code screen", () => {
    expect(signInRefusal(403, "Email not verified")).toEqual({ verify: true });
  });

  it("shows a turned-off account's message as the server says it", () => {
    const off = "This account has been turned off. Ask your hostel office to turn it back on.";
    expect(signInRefusal(403, off)).toEqual({ verify: false, message: off });
  });

  it("shows any other refusal as is", () => {
    expect(signInRefusal(401, "Invalid email or password")).toEqual({
      verify: false,
      message: "Invalid email or password",
    });
  });
});

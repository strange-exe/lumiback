// password.ts reads ApiError from api.ts, which needs a configured API address and the session.
jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/session", () => ({}));

import { ApiError } from "@/lib/api";
import { changedMessage, changeError, formProblem, MAX_PASSWORD } from "@/lib/password";

const form = (current = "old-password-1", password = "new-password-2", again = password) => ({
  current,
  password,
  again,
});

describe("formProblem", () => {
  it("lets a complete, matching form through", () => {
    expect(formProblem(form())).toBeNull();
  });

  it("asks for each field in order", () => {
    expect(formProblem(form("", "", ""))).toBe("Enter your current password.");
    expect(formProblem(form("old", "", ""))).toBe("Choose a new password.");
    expect(formProblem(form("old", "new-password-2", ""))).toBe("Type the new password again.");
  });

  it("catches a mismatch, exactly as typed", () => {
    expect(formProblem(form("old", "new-password-2", "new-password-3"))).toBe(
      "The new passwords don't match.",
    );
    // Never trimmed: a trailing space is part of the password, as on the server.
    expect(formProblem(form("old", "new-password-2 ", "new-password-2"))).toBe(
      "The new passwords don't match.",
    );
    expect(formProblem(form("old", "Secret-Phrase", "secret-phrase"))).toBe(
      "The new passwords don't match.",
    );
  });

  it("stops a password the server would refuse for length", () => {
    const longest = "a".repeat(MAX_PASSWORD);
    expect(formProblem(form("old", longest))).toBeNull();
    expect(formProblem(form("old", `${longest}a`))).toBe(
      "Password must be 128 characters or fewer.",
    );
  });

  it("leaves strength to the server", () => {
    expect(formProblem(form("old", "short"))).toBeNull();
  });
});

describe("changedMessage", () => {
  it("counts the other devices", () => {
    expect(changedMessage(0)).toBe("Password changed. No other devices were signed in.");
    expect(changedMessage(1)).toBe("Password changed. Signed out of 1 other device.");
    expect(changedMessage(3)).toBe("Password changed. Signed out of 3 other devices.");
  });
});

describe("changeError", () => {
  const fallback = "Couldn't change your password. Try again.";

  it("shows the backend's 403, 422 and 429 sentences", () => {
    const wrong = "Your current password isn't right";
    const weak = "Password must be at least 10 characters";
    const limited = "Too many attempts. Try again in 12 minutes.";
    expect(changeError(new ApiError(403, wrong))).toBe(wrong);
    expect(changeError(new ApiError(422, weak))).toBe(weak);
    expect(changeError(new ApiError(429, limited))).toBe(limited);
  });

  it("passes on the offline and signed-out sentences", () => {
    const offline = "Can't reach Lumiback. Check your connection and try again.";
    expect(changeError(new ApiError(0, offline))).toBe(offline);
    expect(changeError(new ApiError(401, "Please sign in again."))).toBe("Please sign in again.");
  });

  it("uses the fallback for server faults and anything else", () => {
    expect(changeError(new ApiError(500, "Internal Server Error"))).toBe(fallback);
    expect(changeError(new ApiError(422, ""))).toBe(fallback);
    expect(changeError(new Error("boom"))).toBe(fallback);
    expect(changeError("nope")).toBe(fallback);
  });
});

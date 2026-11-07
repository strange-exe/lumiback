import assert from "node:assert/strict";
import { test } from "node:test";

import { commitOf, migrationLine, shortCommit } from "./status.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("a commit is a hex SHA or nothing", () => {
  assert.equal(commitOf(SHA), SHA);
  assert.equal(commitOf(` ${SHA.toUpperCase()} `), SHA);
  for (const bad of [
    undefined,
    null,
    "",
    "main",
    "abc",
    "g".repeat(40),
    "a".repeat(41),
    "<b>1</b>",
  ]) {
    assert.equal(commitOf(bad), null, String(bad));
  }
});

test("a commit is shown short, or says it wasn't reported", () => {
  assert.equal(shortCommit(SHA), "0123456");
  assert.equal(shortCommit(null), "Not reported (not deployed from Git)");
});

test("the migration line says in words whether the database is current", () => {
  const db = { reachable: true, revision: "0028", head: "0028", up_to_date: true };
  assert.equal(migrationLine(db), "Up to date (0028)");
  assert.equal(
    migrationLine({ ...db, revision: "0027", up_to_date: false }),
    "Behind: the database is at 0027, the code expects 0028",
  );
  assert.equal(
    migrationLine({ reachable: false, revision: null, head: "0028", up_to_date: false }),
    "Unknown: the database didn't answer (the code expects 0028)",
  );
  assert.equal(
    migrationLine({ ...db, revision: null, up_to_date: false }),
    "Not migrated: the database has no revision (the code expects 0028)",
  );
});

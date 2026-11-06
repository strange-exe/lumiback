import assert from "node:assert/strict";
import { test } from "node:test";

import { addLabel, csvFileProblem, importSummary, MAX_CSV_BYTES } from "./student-import.ts";

const csv = (size: number, name = "students.csv", type = "text/csv") => ({ name, size, type });

test("a CSV up to 512 KB is fine", () => {
  assert.equal(csvFileProblem(csv(1)), null);
  assert.equal(csvFileProblem(csv(MAX_CSV_BYTES)), null);
});

test("one byte over 512 KB is refused, with its size", () => {
  const problem = csvFileProblem(csv(MAX_CSV_BYTES + 1));
  assert.match(problem ?? "", /513 KB/);
  assert.match(problem ?? "", /512 KB/);
});

test("an empty file is refused", () => {
  assert.equal(csvFileProblem(csv(0)), "That file is empty.");
});

test("the name or the type can say it's a CSV (Windows often reports Excel's type)", () => {
  assert.equal(csvFileProblem(csv(10, "List.CSV", "application/vnd.ms-excel")), null);
  assert.equal(csvFileProblem(csv(10, "export", "text/csv")), null);
  assert.equal(csvFileProblem(csv(10, "list.csv", "")), null);
});

test("other files are refused before their size matters", () => {
  assert.match(csvFileProblem(csv(10, "students.xlsx", "application/vnd.ms-excel")) ?? "", /\.csv/);
  assert.match(csvFileProblem(csv(0, "photo.png", "image/png")) ?? "", /\.csv/);
});

test("the summary counts each kind, singular and plural", () => {
  assert.equal(
    importSummary({ new: 3, existing: 1, errors: 2 }),
    "3 new, 1 already has an account, 2 with problems",
  );
  assert.equal(
    importSummary({ new: 0, existing: 2, errors: 1 }),
    "0 new, 2 already have an account, 1 with a problem",
  );
});

test("the add button names how many", () => {
  assert.equal(addLabel(1), "Add 1 person");
  assert.equal(addLabel(40), "Add 40 people");
});

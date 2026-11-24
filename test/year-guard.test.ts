import test from "node:test";
import assert from "node:assert/strict";
import { yearConflicts } from "../src/engine/resolve.ts";

test("same-title remake: 2002 file rejected for 2026 film", () => {
  assert.equal(yearConflicts("Resident.Evil.2002.1080p.BluRay.AKWAM.mp4", 2026), true);
  assert.equal(yearConflicts("Resident Evil 2026", 2026), false);
  assert.equal(yearConflicts("Resident Evil 2025", 2026), false);
  assert.equal(yearConflicts("Resident Evil", 2026), false);
  assert.equal(yearConflicts("Resident.Evil.2026.mp4", undefined), false);
});

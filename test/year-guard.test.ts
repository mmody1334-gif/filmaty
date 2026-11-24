import test from "node:test";
import assert from "node:assert/strict";
import { yearConflicts, seriesYearConflicts } from "../src/engine/resolve.ts";

test("same-title remake: 2002 file rejected for 2026 film", () => {
  assert.equal(yearConflicts("Resident.Evil.2002.1080p.BluRay.AKWAM.mp4", 2026), true);
  assert.equal(yearConflicts("Resident Evil 2026", 2026), false);
  assert.equal(yearConflicts("Resident Evil 2025", 2026), false);
  assert.equal(yearConflicts("Resident Evil", 2026), false);
  assert.equal(yearConflicts("Resident.Evil.2026.mp4", undefined), false);
});

test("same-title series: The Office UK (2001-2003) rejects US season years", () => {
  assert.equal(seriesYearConflicts(2005, 2001, 2003), true);
  assert.equal(seriesYearConflicts(2013, 2001, 2003), true);
  assert.equal(seriesYearConflicts(2001, 2001, 2003), false);
  assert.equal(seriesYearConflicts(2004, 2001, 2003), false);
  assert.equal(seriesYearConflicts(2007, 2005, 2013), false);
  assert.equal(seriesYearConflicts(2001, 2005, 2013), true);
  assert.equal(seriesYearConflicts(undefined, 2005, 2013), false);
  assert.equal(seriesYearConflicts(2020, 2016, undefined), false);
});

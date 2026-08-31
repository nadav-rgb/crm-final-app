import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildMeasuredEvidenceRows,
  G5_CASE_MANIFEST,
  G5_DIRECT_JWT_MATRIX,
  observeG5Case,
  parseG5ObservationsFromTap,
} from '../../scripts/security/g5-evidence.mjs';
import { RLS_PROTECTED_TABLES, SENSITIVE_TABLES } from '../../scripts/security/verify-rls-live.mjs';

test('G5 evidence manifest requires exact unique case IDs for the complete measured matrix', () => {
  assert.ok(G5_CASE_MANIFEST.length >= 25);
  assert.equal(new Set(G5_CASE_MANIFEST.map((row) => row.caseId)).size, G5_CASE_MANIFEST.length);
  for (const row of G5_CASE_MANIFEST) {
    assert.match(row.caseId, /^SEC-\d{3}$/);
    assert.equal(typeof row.testName, 'string');
    assert.ok(row.testName.length > 10);
  }
});

test('G5 direct-JWT matrix covers every classified object, direct action, and mutable authority transfer', () => {
  assert.deepEqual(
    new Set(G5_DIRECT_JWT_MATRIX.map((row) => row.table)),
    new Set(SENSITIVE_TABLES),
  );
  for (const row of G5_DIRECT_JWT_MATRIX) {
    assert.match(row.caseId, /^SEC-\d{3}$/);
    assert.equal(typeof row.testName, 'string');
    if (RLS_PROTECTED_TABLES.includes(row.table)) {
      assert.deepEqual([...row.actions].sort(), ['delete', 'insert', 'select', 'update']);
    } else {
      assert.deepEqual(row.actions, ['select']);
    }
    if (!['projects', 'payment_config', 'activist_directory'].includes(row.table)) {
      assert.equal(row.authorityTransfer, true, `${row.table} needs an old/new authorized transfer probe`);
    }
  }
});

test('every G5 evidence row is emitted by the isolated live-test implementation', async () => {
  const sources = await Promise.all([
    readFile(new URL('./rls-live.test.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./db-contracts-live.test.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./session-live.test.mjs', import.meta.url), 'utf8'),
  ]);
  const allSources = sources.join('\n');
  assert.match(sources[0], /G5_DIRECT_JWT_MATRIX/);
  for (const source of sources) {
    assert.match(source, /function observeG5CaseInTest\(testContext, caseId, actualStatus\)[\s\S]*testName: testContext\.name/);
  }
  assert.match(sources[0], /observeG5CaseInTest\(t, row\.caseId/);
  assert.match(sources[0], /expectDirectDenied\(selected/);
  assert.match(sources[0], /\.insert\(directInsertPayload\(row\.table, resources\)\)/);
  assert.match(sources[0], /\.update\(directUpdatePayload\(row\.table, resources\)\)/);
  assert.match(sources[0], /\.delete\(\)\.select\(directColumns\(row\.table\)\)/);
  assert.match(sources[0], /authorityTransferPatch\(row\.table, resources\)/);
  assert.match(sources[0], /contacts:legacy-uuid-divergence/);
  const directCaseIds = new Set(G5_DIRECT_JWT_MATRIX.map((row) => row.caseId));
  for (const { caseId } of G5_CASE_MANIFEST) {
    if (directCaseIds.has(caseId)) continue;
    assert.match(allSources, new RegExp(`observeG5CaseInTest\\(t, '${caseId}'`), `${caseId} has no live observation`);
  }
});

test('G5 evidence rows are derived from actual observations and reject missing, duplicate or unobserved cases', () => {
  const observations = G5_CASE_MANIFEST.map(({ caseId, expectedStatus }) => ({
    caseId,
    actualStatus: expectedStatus,
    testName: G5_CASE_MANIFEST.find((row) => row.caseId === caseId).testName,
  }));
  const passedTests = new Set(G5_CASE_MANIFEST.map((row) => row.testName));
  const rows = buildMeasuredEvidenceRows({ observations, passedTests });
  assert.equal(rows.length, G5_CASE_MANIFEST.length);
  assert.deepEqual(rows.map((row) => row.actualStatus), observations.map((row) => row.actualStatus));

  assert.throws(() => buildMeasuredEvidenceRows({
    observations: observations.slice(1), passedTests,
  }), /missing|incomplete/i);
  assert.throws(() => buildMeasuredEvidenceRows({
    observations: [...observations, observations[0]], passedTests,
  }), /duplicate/i);
  assert.throws(() => buildMeasuredEvidenceRows({
    observations: [{
      caseId: 'SEC-999', actualStatus: 'denied', testName: 'unknown direct test name',
    }, ...observations.slice(1)],
    passedTests,
  }), /unknown/i);
  assert.throws(() => buildMeasuredEvidenceRows({
    observations,
    passedTests: new Set([...passedTests].filter((name) => name !== G5_CASE_MANIFEST[0].testName)),
  }), /did not pass|unobserved/i);
  assert.throws(() => buildMeasuredEvidenceRows({
    observations: [{ ...observations[0], testName: 'unrelated passing test' }, ...observations.slice(1)],
    passedTests,
  }), /test binding|observation/i);
});

test('G5 test observation marker is local-gate-only and TAP parsing keeps only exact metadata', () => {
  assert.throws(() => observeG5Case('SEC-001', 'denied', {
    env: { SECURITY_TEST_CONFIRM_ISOLATED: 'false' }, emit() {},
  }), /isolated/i);
  assert.throws(() => observeG5Case('SEC-001', 'denied', {
    env: { SECURITY_TEST_CONFIRM_ISOLATED: 'true' }, emit() {}, testName: 'unrelated live test',
  }), /binding/i);
  const emitted = [];
  observeG5Case('SEC-001', 'denied', {
    env: { SECURITY_TEST_CONFIRM_ISOLATED: 'true' },
    testName: G5_CASE_MANIFEST.find((row) => row.caseId === 'SEC-001').testName,
    emit(line) { emitted.push(line); },
  });
  const parsed = parseG5ObservationsFromTap(`# ${emitted[0]}\n# unrelated diagnostic\n`);
  assert.deepEqual(parsed, [{
    caseId: 'SEC-001', actualStatus: 'denied',
    testName: G5_CASE_MANIFEST.find((row) => row.caseId === 'SEC-001').testName,
  }]);
  assert.throws(() => parseG5ObservationsFromTap('# G5_OBSERVATION {"caseId":"SEC-001","actualStatus":"denied","token":"forbidden"}\n'), /invalid/i);
});

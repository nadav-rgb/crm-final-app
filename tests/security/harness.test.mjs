import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTestPath } from '../../scripts/security/run-tests.mjs';

test('runner rejects paths outside tests/security', () => {
  assert.throws(
    () => normalizeTestPath('../.env.local'),
    /invalid security test path/,
  );
});

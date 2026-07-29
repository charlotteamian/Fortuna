import assert from 'node:assert/strict';
import test from 'node:test';
import { syncProjectVersions, readProjectVersions, validateMarketingVersion } from './ios-release.mjs';

const projectFixture = `
MARKETING_VERSION = 1.0;
CURRENT_PROJECT_VERSION = 1;
MARKETING_VERSION = 1.0;
CURRENT_PROJECT_VERSION = 1;
`;

test('iOS release sync aligns both Xcode configurations with the package version', () => {
  const updated = syncProjectVersions(projectFixture, '1.2.0', '3');
  assert.deepEqual(readProjectVersions(updated), {
    marketingVersions: ['1.2.0'],
    buildNumbers: ['3'],
  });
});

test('iOS release sync rejects ambiguous Xcode version settings', () => {
  assert.throws(
    () => syncProjectVersions('MARKETING_VERSION = 1.0;', '1.2.0', '1'),
    /Expected two iOS target version settings/,
  );
});

test('iOS release sync rejects versions App Store Connect cannot use', () => {
  assert.throws(() => validateMarketingVersion('1.2'), /major.minor.patch/);
  assert.throws(() => syncProjectVersions(projectFixture, '1.2.0', 'zero'), /positive integer/);
});

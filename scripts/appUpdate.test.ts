import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAppVersions, parseGitHubRelease } from '../src/lib/appUpdate.ts';

function release(version: string, overrides: Record<string, unknown> = {}) {
  const assetName = `Fortuna-${version}-release.apk`;
  return {
    tag_name: `v${version}`,
    name: `Fortuna ${version}`,
    body: 'Release notes',
    html_url: `https://github.com/charlotteamian/Fortuna/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [{
      name: assetName,
      browser_download_url: `https://github.com/charlotteamian/Fortuna/releases/download/v${version}/${assetName}`,
      content_type: 'application/vnd.android.package-archive',
      size: 6_500_000,
    }],
    ...overrides,
  };
}

test('compares stable semantic app versions numerically', () => {
  assert.equal(compareAppVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareAppVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareAppVersions('1.2.9', '1.3.0'), -1);
});

test('selects only the exact signed release APK for a newer version', () => {
  const result = parseGitHubRelease(release('1.3.1'), '1.3.0');
  assert.equal(result.latestVersion, '1.3.1');
  assert.equal(result.update?.assetName, 'Fortuna-1.3.1-release.apk');
  assert.equal(result.update?.assetSize, 6_500_000);
});

test('does not offer the same or an older version', () => {
  assert.equal(parseGitHubRelease(release('1.3.0'), '1.3.0').update, null);
  assert.equal(parseGitHubRelease(release('1.2.9'), '1.3.0').update, null);
});

test('rejects debug APKs and untrusted download hosts', () => {
  assert.throws(
    () => parseGitHubRelease(release('1.3.1', {
      assets: [{
        name: 'Fortuna-1.3.1-debug.apk',
        browser_download_url: 'https://github.com/charlotteamian/Fortuna/releases/download/v1.3.1/Fortuna-1.3.1-debug.apk',
      }],
    }), '1.3.0'),
    /UPDATE_ASSET_MISSING/,
  );

  assert.throws(
    () => parseGitHubRelease(release('1.3.1', {
      assets: [{
        name: 'Fortuna-1.3.1-release.apk',
        browser_download_url: 'https://example.com/Fortuna-1.3.1-release.apk',
      }],
    }), '1.3.0'),
    /UNTRUSTED_UPDATE_URL/,
  );
});

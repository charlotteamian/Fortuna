import assert from 'node:assert/strict';
import test from 'node:test';
import { checkForAppUpdate, compareAppVersions, getAppUpdateFailure, parseGitHubRelease } from '../src/lib/appUpdate.ts';

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

test('identifies network download failures and offers the browser recovery path', () => {
  for (const [code, messageKey] of [
    ['UPDATE_NETWORK_TIMEOUT', 'update_network_timeout'],
    ['UPDATE_NETWORK_UNAVAILABLE', 'update_network_unavailable'],
    ['UPDATE_HTTP_FAILED', 'update_server_failed'],
    ['UPDATE_DOWNLOAD_FAILED', 'update_download_failed'],
    ['INCOMPLETE_UPDATE_DOWNLOAD', 'update_download_incomplete'],
  ]) {
    assert.deepEqual(getAppUpdateFailure({ code }), { messageKey, canUseBrowser: true, diagnostic: code });
  }
});

test('does not offer browser recovery for certificate or release validation failures', () => {
  for (const code of ['UPDATE_TLS_FAILED', 'UPDATE_SIGNATURE_MISMATCH', 'UNTRUSTED_UPDATE_URL',
    'UNTRUSTED_UPDATE_REDIRECT', 'UPDATE_PACKAGE_MISMATCH', 'UPDATE_VERSION_MISMATCH', 'INVALID_UPDATE_APK']) {
    assert.equal(getAppUpdateFailure({ code }).canUseBrowser, false);
    assert.notEqual(getAppUpdateFailure({ code }).messageKey, 'update_download_failed');
  }
});

test('keeps storage, cached-file and version errors actionable', () => {
  assert.equal(getAppUpdateFailure({ code: 'UPDATE_STORAGE_FAILED' }).messageKey, 'update_storage_failed');
  assert.equal(getAppUpdateFailure({ code: 'UPDATE_NOT_NEWER' }).messageKey, 'update_not_newer');
  assert.equal(getAppUpdateFailure({ code: 'NO_DOWNLOADED_UPDATE' }).messageKey, 'update_download_missing');
});

test('unknown updater errors use neutral copy without a browser bypass', () => {
  for (const error of [null, 'server message', new Error('unknown'), { code: '__proto__' }, { code: 'unexpected' }]) {
    assert.deepEqual(getAppUpdateFailure(error), { messageKey: 'update_install_failed', canUseBrowser: false, diagnostic: 'UPDATE_UNKNOWN_ERROR' });
  }
});

test('provides safe persistent diagnostics without exposing raw URLs or server messages', () => {
  assert.equal(getAppUpdateFailure({ code: 'UPDATE_HTTP_FAILED', message: 'Update server returned HTTP 403' }).diagnostic,
    'UPDATE_HTTP_FAILED · HTTP 403');
  assert.equal(getAppUpdateFailure({ code: 'UPDATE_HTTP_FAILED', message: 'https://example.com/?token=private' }).diagnostic,
    'UPDATE_HTTP_FAILED');
});

test('update metadata rejects credentials, query overrides and mismatched release pages', () => {
  const valid = release('1.9.0');
  for (const url of [
    valid.assets[0].browser_download_url + '?redirect=elsewhere',
    valid.assets[0].browser_download_url + '#fragment',
    valid.assets[0].browser_download_url.replace('https://', 'https://user:pass@'),
  ]) {
    assert.throws(() => parseGitHubRelease({ ...valid, assets: [{ ...valid.assets[0], browser_download_url: url }] }, '1.8.3'), /UNTRUSTED_UPDATE_URL/);
  }
  assert.throws(() => parseGitHubRelease({ ...valid, html_url: 'https://github.com/charlotteamian/Fortuna/releases/tag/v1.8.3' }, '1.8.3'), /UNTRUSTED_RELEASE_URL/);
});

test('web update checks use a bounded request and parse the exact release, surfacing HTTP errors', async t => {
  let requested: RequestInit | undefined;
  const mockFetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requested = init;
    return new Response(JSON.stringify(release('1.9.0')), { status: 200 });
  });
  assert.equal((await checkForAppUpdate('1.8.3')).update?.version, '1.9.0');
  assert.ok(requested?.signal instanceof AbortSignal);
  assert.equal(requested?.cache, 'no-store');
  mockFetch.mock.mockImplementation(async () => new Response('', { status: 503 }));
  await assert.rejects(checkForAppUpdate('1.8.3'), /UPDATE_CHECK_FAILED_503/);
});

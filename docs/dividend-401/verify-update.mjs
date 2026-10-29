import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseGitHubRelease } from '../../src/lib/appUpdate.ts';
const release = JSON.parse(await readFile(new URL('./release-api.json', import.meta.url), 'utf8'));
const previous = parseGitHubRelease(release, '4.0.0');
const current = parseGitHubRelease(release, '4.0.1');
assert.equal(previous.update?.version, '4.0.1'); assert.equal(current.update, null);
assert.equal(previous.update.assetName, 'Fortuna-4.0.1-release.apk');
const status = url => Number(execFileSync('curl', ['--location', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '--range', '0-0', url], { encoding: 'utf8' }));
const releaseUrlStatus = status(previous.update.releaseUrl), downloadUrlStatus = status(previous.update.downloadUrl);
assert.ok([200, 206].includes(releaseUrlStatus)); assert.ok([200, 206].includes(downloadUrlStatus));
const result = { checkedAt: new Date().toISOString(), previousVersion: '4.0.0', previousOffersVersion: previous.update.version, currentVersion: '4.0.1', currentHasUpdate: false,
  assetName: previous.update.assetName, releaseUrl: previous.update.releaseUrl, downloadUrl: previous.update.downloadUrl, releaseUrlStatus, downloadUrlStatus };
await writeFile(new URL('./update-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

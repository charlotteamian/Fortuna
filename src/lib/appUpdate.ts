export const FORTUNA_RELEASES_API = 'https://api.github.com/repos/charlotteamian/Fortuna/releases/latest';

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  content_type?: unknown;
  size?: unknown;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

export interface AppUpdateInfo {
  version: string;
  title: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string;
  assetName: string;
  assetSize: number;
}

export interface AppUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  update: AppUpdateInfo | null;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function parseVersion(version: string): [number, number, number] {
  if (!VERSION_PATTERN.test(version)) throw new Error('INVALID_APP_VERSION');
  const parts = version.split('.').map(Number);
  return [parts[0], parts[1], parts[2]];
}

export function compareAppVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isTrustedReleaseDownload(downloadUrl: string, version: string, assetName: string): boolean {
  try {
    const url = new URL(downloadUrl);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname === `/charlotteamian/Fortuna/releases/download/v${version}/${assetName}`;
  } catch {
    return false;
  }
}

export function parseGitHubRelease(payload: GitHubReleasePayload, currentVersion: string): AppUpdateCheck {
  parseVersion(currentVersion);
  if (payload.draft === true || payload.prerelease === true) throw new Error('UNSUPPORTED_RELEASE');

  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : '';
  const latestVersion = tagName.startsWith('v') ? tagName.slice(1) : '';
  parseVersion(latestVersion);

  if (compareAppVersions(latestVersion, currentVersion) <= 0) {
    return { currentVersion, latestVersion, update: null };
  }

  const expectedAssetName = `Fortuna-${latestVersion}-release.apk`;
  const assets = Array.isArray(payload.assets) ? payload.assets as GitHubReleaseAsset[] : [];
  const asset = assets.find(candidate => candidate.name === expectedAssetName);
  if (!asset || typeof asset.browser_download_url !== 'string') throw new Error('UPDATE_ASSET_MISSING');
  if (!isTrustedReleaseDownload(asset.browser_download_url, latestVersion, expectedAssetName)) {
    throw new Error('UNTRUSTED_UPDATE_URL');
  }

  const releaseUrl = typeof payload.html_url === 'string' ? payload.html_url : '';
  if (!releaseUrl.startsWith('https://github.com/charlotteamian/Fortuna/releases/')) {
    throw new Error('UNTRUSTED_RELEASE_URL');
  }

  return {
    currentVersion,
    latestVersion,
    update: {
      version: latestVersion,
      title: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : `Fortuna ${latestVersion}`,
      releaseNotes: typeof payload.body === 'string' ? payload.body.trim() : '',
      releaseUrl,
      downloadUrl: asset.browser_download_url,
      assetName: expectedAssetName,
      assetSize: typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : 0,
    },
  };
}

export async function checkForAppUpdate(currentVersion: string): Promise<AppUpdateCheck> {
  const response = await fetch(FORTUNA_RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`UPDATE_CHECK_FAILED_${response.status}`);
  return parseGitHubRelease(await response.json() as GitHubReleasePayload, currentVersion);
}

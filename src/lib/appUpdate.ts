import { Capacitor, CapacitorHttp } from '@capacitor/core';

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

export interface AppUpdateFailure {
  messageKey: string;
  canUseBrowser: boolean;
  diagnostic?: string;
}

const UPDATE_FAILURES: Record<string, AppUpdateFailure> = {
  UPDATE_NETWORK_TIMEOUT: { messageKey: 'update_network_timeout', canUseBrowser: true },
  UPDATE_NETWORK_UNAVAILABLE: { messageKey: 'update_network_unavailable', canUseBrowser: true },
  UPDATE_HTTP_FAILED: { messageKey: 'update_server_failed', canUseBrowser: true },
  UPDATE_DOWNLOAD_FAILED: { messageKey: 'update_download_failed', canUseBrowser: true },
  INCOMPLETE_UPDATE_DOWNLOAD: { messageKey: 'update_download_incomplete', canUseBrowser: true },
  UPDATE_TLS_FAILED: { messageKey: 'update_tls_failed', canUseBrowser: false },
  UPDATE_STORAGE_FAILED: { messageKey: 'update_storage_failed', canUseBrowser: false },
  UPDATE_SIGNATURE_MISMATCH: { messageKey: 'update_signature_mismatch', canUseBrowser: false },
  UPDATE_NOT_NEWER: { messageKey: 'update_not_newer', canUseBrowser: false },
  NO_DOWNLOADED_UPDATE: { messageKey: 'update_download_missing', canUseBrowser: false },
  INVALID_UPDATE_APK: { messageKey: 'update_package_invalid', canUseBrowser: false },
  UPDATE_PACKAGE_MISMATCH: { messageKey: 'update_package_invalid', canUseBrowser: false },
  UPDATE_VERSION_MISMATCH: { messageKey: 'update_package_invalid', canUseBrowser: false },
  UPDATE_TOO_LARGE: { messageKey: 'update_package_invalid', canUseBrowser: false },
  INVALID_UPDATE_VERSION: { messageKey: 'update_source_invalid', canUseBrowser: false },
  UNTRUSTED_UPDATE_URL: { messageKey: 'update_source_invalid', canUseBrowser: false },
  UNTRUSTED_UPDATE_REDIRECT: { messageKey: 'update_source_invalid', canUseBrowser: false },
  INVALID_UPDATE_REDIRECT: { messageKey: 'update_source_invalid', canUseBrowser: false },
  TOO_MANY_UPDATE_REDIRECTS: { messageKey: 'update_source_invalid', canUseBrowser: false },
};

export function getAppUpdateFailure(error: unknown): AppUpdateFailure {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : '';
  if (!Object.hasOwn(UPDATE_FAILURES, code)) {
    return { messageKey: 'update_install_failed', canUseBrowser: false, diagnostic: 'UPDATE_UNKNOWN_ERROR' };
  }
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : '';
  const httpStatus = code === 'UPDATE_HTTP_FAILED' ? /^Update server returned HTTP (\d{3})$/.exec(message)?.[1] : null;
  return { ...UPDATE_FAILURES[code], diagnostic: httpStatus ? `${code} · HTTP ${httpStatus}` : code };
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
      && !url.username && !url.password && !url.port && !url.search && !url.hash
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
  if (releaseUrl !== `https://github.com/charlotteamian/Fortuna/releases/tag/v${latestVersion}`) {
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
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: FORTUNA_RELEASES_API, headers, responseType: 'json',
      connectTimeout: 15_000, readTimeout: 20_000,
    });
    if (response.status !== 200) throw new Error(`UPDATE_CHECK_FAILED_${response.status}`);
    const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    return parseGitHubRelease(payload as GitHubReleasePayload, currentVersion);
  }
  const response = await fetch(FORTUNA_RELEASES_API, {
    headers, signal: AbortSignal.timeout(20_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`UPDATE_CHECK_FAILED_${response.status}`);
  return parseGitHubRelease(await response.json() as GitHubReleasePayload, currentVersion);
}

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AppUpdateDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
}

export interface AppUpdaterStatus {
  supported: boolean;
  installPermissionGranted: boolean;
  downloadedVersion?: string;
}

export interface AppUpdateInstallResult {
  status: 'installer_opened' | 'permission_required';
  versionName: string;
}

interface AppUpdaterPlugin {
  getStatus(): Promise<AppUpdaterStatus>;
  downloadAndInstall(options: { url: string; versionName: string }): Promise<AppUpdateInstallResult>;
  installDownloaded(): Promise<AppUpdateInstallResult>;
  openInstallPermissionSettings(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listener: (event: AppUpdateDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export function supportsAppUpdater(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getAppUpdaterStatus(): Promise<AppUpdaterStatus> {
  if (!supportsAppUpdater()) return { supported: false, installPermissionGranted: false };
  return plugin.getStatus();
}

export async function downloadAndInstallUpdate(url: string, versionName: string): Promise<AppUpdateInstallResult> {
  return plugin.downloadAndInstall({ url, versionName });
}

export async function installDownloadedUpdate(): Promise<AppUpdateInstallResult> {
  return plugin.installDownloaded();
}

export async function openInstallPermissionSettings(): Promise<void> {
  await plugin.openInstallPermissionSettings();
}

export async function addAppUpdateProgressListener(
  listener: (event: AppUpdateDownloadProgress) => void,
): Promise<PluginListenerHandle | null> {
  if (!supportsAppUpdater()) return null;
  return plugin.addListener('downloadProgress', listener);
}

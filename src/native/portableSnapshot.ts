import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface PortableSnapshotStatus {
  supported: boolean;
  configured: boolean;
  directoryName?: string;
  directoryUri?: string;
  lastWriteAt?: number;
}

interface WriteSnapshotResult {
  uri: string;
  writtenAt: number;
}

interface PortableSnapshotPlugin {
  chooseDirectory(): Promise<PortableSnapshotStatus>;
  getStatus(): Promise<PortableSnapshotStatus>;
  writeSnapshot(options: { fileName: string; content: string }): Promise<WriteSnapshotResult>;
  clearDirectory(): Promise<void>;
  addListener(eventName: 'appBackgrounded', listener: () => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<PortableSnapshotPlugin>('PortableSnapshot');

export function supportsPortableSnapshot(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function choosePortableSnapshotDirectory(): Promise<PortableSnapshotStatus> {
  if (!supportsPortableSnapshot()) return { supported: false, configured: false };
  return plugin.chooseDirectory();
}

export async function getPortableSnapshotStatus(): Promise<PortableSnapshotStatus> {
  if (!supportsPortableSnapshot()) return { supported: false, configured: false };
  return plugin.getStatus();
}

export async function writePortableSnapshot(fileName: string, content: string): Promise<WriteSnapshotResult> {
  return plugin.writeSnapshot({ fileName, content });
}

export async function clearPortableSnapshotDirectory(): Promise<void> {
  if (!supportsPortableSnapshot()) return;
  await plugin.clearDirectory();
}

export async function addPortableSnapshotBackgroundListener(listener: () => void): Promise<PluginListenerHandle | null> {
  if (!supportsPortableSnapshot()) return null;
  return plugin.addListener('appBackgrounded', listener);
}

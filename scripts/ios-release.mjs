import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packagePath = resolve(projectRoot, 'package.json');
const projectPath = resolve(projectRoot, 'ios/App/App.xcodeproj/project.pbxproj');
const infoPlistPath = resolve(projectRoot, 'ios/App/App/Info.plist');
const privacyManifestPath = resolve(projectRoot, 'ios/App/App/PrivacyInfo.xcprivacy');
const distPath = resolve(projectRoot, 'dist');
const iosPublicPath = resolve(projectRoot, 'ios/App/App/public');

export function validateMarketingVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json version must use major.minor.patch format; received ${version}`);
  }
  return version;
}

export function syncProjectVersions(projectText, marketingVersion, buildNumber) {
  validateMarketingVersion(marketingVersion);
  if (!/^\d+$/.test(String(buildNumber)) || Number(buildNumber) < 1) {
    throw new Error(`iOS build number must be a positive integer; received ${buildNumber}`);
  }

  const marketingMatches = projectText.match(/MARKETING_VERSION = [^;]+;/g) ?? [];
  const buildMatches = projectText.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) ?? [];
  if (marketingMatches.length !== 2 || buildMatches.length !== 2) {
    throw new Error(`Expected two iOS target version settings; found marketing=${marketingMatches.length}, build=${buildMatches.length}`);
  }

  return projectText
    .replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`)
    .replaceAll(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
}

export function readProjectVersions(projectText) {
  const marketingVersions = [...projectText.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(match => match[1]);
  const buildNumbers = [...projectText.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(match => match[1]);
  return {
    marketingVersions: [...new Set(marketingVersions)],
    buildNumbers: [...new Set(buildNumbers)],
  };
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolutePath = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolutePath));
    else if (entry.isFile()) files.push(relative(root, absolutePath));
  }
  return files.sort();
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function verifyWebAssets(distRoot = distPath, nativeRoot = iosPublicPath) {
  const files = await listFiles(distRoot);
  const mismatches = [];
  for (const file of files) {
    const nativeFile = resolve(nativeRoot, file);
    try {
      if (!(await stat(nativeFile)).isFile() || await sha256(resolve(distRoot, file)) !== await sha256(nativeFile)) {
        mismatches.push(file);
      }
    } catch {
      mismatches.push(file);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`iOS web assets are stale or missing: ${mismatches.join(', ')}`);
  }
  return files.length;
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  return validateMarketingVersion(packageJson.version);
}

async function sync() {
  const marketingVersion = await readPackageVersion();
  const currentProject = await readFile(projectPath, 'utf8');
  const currentVersions = readProjectVersions(currentProject);
  const buildNumber = process.env.FORTUNA_IOS_BUILD_NUMBER
    ?? currentVersions.buildNumbers[0]
    ?? '1';
  const updatedProject = syncProjectVersions(currentProject, marketingVersion, buildNumber);
  if (updatedProject !== currentProject) await writeFile(projectPath, updatedProject);
  process.stdout.write(`Synced iOS version ${marketingVersion} (${buildNumber})\n`);
}

async function verify() {
  const marketingVersion = await readPackageVersion();
  const projectText = await readFile(projectPath, 'utf8');
  const versions = readProjectVersions(projectText);
  if (versions.marketingVersions.length !== 1 || versions.marketingVersions[0] !== marketingVersion) {
    throw new Error(`Xcode marketing version ${versions.marketingVersions.join(', ') || 'missing'} does not match package ${marketingVersion}`);
  }
  if (versions.buildNumbers.length !== 1 || !/^\d+$/.test(versions.buildNumbers[0])) {
    throw new Error(`Xcode build number is missing or inconsistent: ${versions.buildNumbers.join(', ') || 'missing'}`);
  }

  const infoPlist = await readFile(infoPlistPath, 'utf8');
  for (const requiredKey of ['ITSAppUsesNonExemptEncryption', 'NSCalendarsUsageDescription', 'NSCalendarsWriteOnlyAccessUsageDescription']) {
    if (!infoPlist.includes(`<key>${requiredKey}</key>`)) throw new Error(`Info.plist is missing ${requiredKey}`);
  }
  await stat(privacyManifestPath);
  const assetCount = await verifyWebAssets();
  process.stdout.write(`Verified iOS ${marketingVersion} (${versions.buildNumbers[0]}) with ${assetCount} current web assets\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'sync') await sync();
  else if (command === 'verify') await verify();
  else throw new Error('Usage: node scripts/ios-release.mjs <sync|verify>');
}

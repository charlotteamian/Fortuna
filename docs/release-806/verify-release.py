"""Verify the published signed APK against the final local build.

Run only after the release workflows finish and before creating any later commit:
    python3 docs/release-806/verify-release.py
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
REPO = 'charlotteamian/Fortuna'
ENV = dict(os.environ, JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, env=ENV, text=True)


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='8.0.6')
    parser.add_argument('--previous-version', default='8.0.5')
    parser.add_argument('--version-code', type=int, default=50)
    args = parser.parse_args()
    require(re.fullmatch(r'\d+\.\d+\.\d+', args.version), 'Invalid release version')
    require(re.fullmatch(r'\d+\.\d+\.\d+', args.previous_version), 'Invalid previous version')
    require(args.version_code > 0, 'Invalid version code')
    tag = f'v{args.version}'
    asset_name = f'Fortuna-{args.version}-release.apk'
    build = ROOT / 'build' / f'release-{args.version.replace(".", "")}'
    build.mkdir(parents=True, exist_ok=True)
    tools_root = Path(os.environ.get('ANDROID_HOME', '/Users/restartday/Library/Android/sdk')) / 'build-tools'
    tools = sorted(
        (path for path in tools_root.iterdir() if re.fullmatch(r'\d+(?:\.\d+)*', path.name)),
        key=lambda path: tuple(map(int, path.name.split('.'))),
    )[-1]

    head = run('git', 'rev-parse', 'HEAD').strip()
    local_tag = run('git', 'rev-parse', f'{tag}^{{commit}}').strip()
    refs = dict(
        line.split('\t')[::-1]
        for line in run('git', 'ls-remote', 'origin', 'refs/heads/main', f'refs/tags/{tag}', f'refs/tags/{tag}^{{}}').splitlines()
    )
    remote_tag = refs.get(f'refs/tags/{tag}^{{}}', refs.get(f'refs/tags/{tag}'))
    require(local_tag == head, 'Local HEAD differs from release tag')
    require(refs.get('refs/heads/main') == head, 'Remote main differs from local HEAD')
    require(remote_tag == head, 'Remote release tag differs from local HEAD')

    release = json.loads(run('gh', 'api', f'repos/{REPO}/releases/tags/{tag}'))
    require(release['draft'] is False and release['prerelease'] is False, 'Release must be stable and published')
    require(json.loads(run('gh', 'api', f'repos/{REPO}/releases/latest'))['tag_name'] == tag, 'Release is not latest')
    assets = [item for item in release['assets'] if item['name'] == asset_name]
    require(len(assets) == 1, 'Expected exactly one signed release APK asset')
    asset = assets[0]
    url = f'https://github.com/{REPO}/releases/download/{tag}/{asset_name}'
    require(asset['browser_download_url'] == url, 'Unexpected download URL')
    save('release-api.json', release)
    run('gh', 'release', 'download', tag, '--repo', REPO, '--pattern', asset_name, '--dir', str(build), '--clobber')
    apk = build / asset_name
    digest = sha256(apk)
    require(asset.get('digest') == f'sha256:{digest}', 'GitHub asset digest mismatch')
    require(apk.stat().st_size == asset['size'], 'GitHub asset size mismatch')

    signature = run(str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk))
    (OUT / 'signature-verification.txt').write_text(signature)
    signer = re.search(r'Signer #1 certificate SHA-256 digest: (\w+)', signature)
    require(signer, 'No verified signing certificate')
    certificate = signer.group(1).lower()
    pinned = re.sub(r'\s|:', '', (ROOT / 'android/release-signing-cert.sha256').read_text()).lower()
    require(certificate == pinned, 'Pinned signing certificate mismatch')
    badging = run(str(tools / 'aapt'), 'dump', 'badging', str(apk))
    (OUT / 'apk-badging.txt').write_text(badging)
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    require(package and package.groups() == ('com.fortuna.wealthtracker', str(args.version_code), args.version), 'APK package/version mismatch')
    require('application-debuggable' not in badging, 'APK must not be debuggable')

    resources = [path for path in (ROOT / 'dist').rglob('*') if path.is_file()]
    require(resources, 'Missing final dist build')
    bridges = ['cordova.js', 'cordova_plugins.js']
    with zipfile.ZipFile(apk) as archive:
        for path in resources:
            relative = path.relative_to(ROOT / 'dist').as_posix()
            require(archive.read('assets/public/' + relative) == path.read_bytes(), f'Stale APK resource: {relative}')
        for bridge in bridges:
            require(archive.read('assets/public/' + bridge) == (ROOT / 'android/app/src/main/assets/public' / bridge).read_bytes(), f'Stale bridge: {bridge}')

    node_script = """
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';
        import { parseGitHubRelease } from './src/lib/appUpdate.ts';
        const [payloadPath, previousVersion, currentVersion, assetName, downloadUrl] = process.argv.slice(1);
        const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
        const previous = parseGitHubRelease(payload, previousVersion);
        const current = parseGitHubRelease(payload, currentVersion);
        assert.equal(previous.update?.version, currentVersion);
        assert.equal(previous.update?.assetName, assetName);
        assert.equal(previous.update?.downloadUrl, downloadUrl);
        assert.equal(current.update, null);
        process.stdout.write(JSON.stringify({ previous, current }));
    """
    updates = json.loads(run('node', '--input-type=module', '-e', node_script, str(OUT / 'release-api.json'), args.previous_version, args.version, asset_name, url))
    save('update-verification.json', updates)

    public_apk = build / f'public-{asset_name}'
    public_status = run('curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--output', str(public_apk), '--write-out', '%{http_code}', url).strip()
    require(public_status == '200', 'Public APK download did not return HTTP 200')
    require(sha256(public_apk) == digest, 'Public download differs from verified release asset')

    workflows = json.loads(run('gh', 'run', 'list', '--repo', REPO, '--commit', head, '--limit', '30', '--json', 'databaseId,workflowName,headSha,status,conclusion,url,event,headBranch'))
    save('ci-verification.json', workflows)
    required_workflows = ['Android APK Release', 'iOS Release Readiness']
    for name in required_workflows:
        candidates = [item for item in workflows if item['workflowName'] == name]
        require(candidates and candidates[0]['status'] == 'completed' and candidates[0]['conclusion'] == 'success', f'Required workflow not successful: {name}')

    result = {
        'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'releaseUrl': release['html_url'], 'tag': tag, 'commit': head,
        'localTagAndRemoteMainAndTagMatch': True,
        'asset': asset_name, 'assetUrl': url, 'size': apk.stat().st_size,
        'sha256': digest, 'githubDigestMatches': True,
        'package': package.group(1), 'versionName': args.version,
        'versionCode': args.version_code, 'debuggable': False,
        'certificateSha256': certificate, 'pinnedCertificateMatches': True,
        'webBuildResourcesMatched': len(resources), 'capacitorBridgeResourcesMatched': len(bridges),
        'publicDownload': {'status': 200, 'bytes': public_apk.stat().st_size, 'digestMatchesRelease': True},
        'updateParser': {'previousVersion': args.previous_version, 'previousOffersNewRelease': True, 'currentOffersNothing': True},
        'requiredWorkflowsSucceeded': required_workflows,
        'physicalDeviceTested': False, 'emulatorTested': False,
    }
    save('release-verification.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

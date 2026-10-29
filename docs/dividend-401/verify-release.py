from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BUILD = ROOT / 'build' / 'release-401'
BUILD.mkdir(parents=True, exist_ok=True)
VERSION = '4.0.1'
TAG = f'v{VERSION}'
ASSET = f'Fortuna-{VERSION}-release.apk'
REPO = 'charlotteamian/Fortuna'
ENV = dict(os.environ, JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home')
TOOLS = Path('/Users/restartday/Library/Android/sdk/build-tools/36.1.0')

def run(*args):
    return subprocess.check_output(args, cwd=ROOT, env=ENV, text=True)

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

release = json.loads(run('gh', 'api', f'repos/{REPO}/releases/tags/{TAG}'))
assert release['draft'] is False and release['prerelease'] is False
assert json.loads(run('gh', 'api', f'repos/{REPO}/releases/latest'))['tag_name'] == TAG
asset = next(item for item in release['assets'] if item['name'] == ASSET)
assert asset['browser_download_url'] == f'https://github.com/{REPO}/releases/download/{TAG}/{ASSET}'
save('release-api.json', release)
run('gh', 'release', 'download', TAG, '--repo', REPO, '--pattern', ASSET, '--dir', str(BUILD), '--skip-existing')
apk = BUILD / ASSET
digest = hashlib.sha256(apk.read_bytes()).hexdigest()
assert asset['digest'] == f'sha256:{digest}'
assert apk.stat().st_size == asset['size']
signature = run(str(TOOLS / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk))
(OUT / 'signature-verification.txt').write_text(signature)
certificate = re.search(r'Signer #1 certificate SHA-256 digest: (\w+)', signature).group(1).lower()
pinned = (ROOT / 'android/release-signing-cert.sha256').read_text().strip().lower()
assert certificate == pinned
badging = run(str(TOOLS / 'aapt'), 'dump', 'badging', str(apk))
(OUT / 'apk-badging.txt').write_text(badging)
package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
assert package.groups() == ('com.fortuna.wealthtracker', '36', VERSION)
assert 'application-debuggable' not in badging
with zipfile.ZipFile(apk) as archive:
    resources = [file for file in (ROOT / 'dist').rglob('*') if file.is_file()]
    for file in resources:
        name = 'assets/public/' + str(file.relative_to(ROOT / 'dist'))
        assert archive.read(name) == file.read_bytes(), name
    bridges = ['cordova.js', 'cordova_plugins.js']
    for name in bridges:
        assert archive.read('assets/public/' + name) == (ROOT / 'android/app/src/main/assets/public' / name).read_bytes()
commit = run('git', 'rev-list', '-n', '1', TAG).strip()
result = {
    'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'releaseUrl': release['html_url'], 'tag': TAG, 'commit': commit, 'asset': ASSET,
    'sha256': digest, 'githubDigestMatches': True, 'package': package.group(1),
    'versionName': VERSION, 'versionCode': 36, 'debuggable': False,
    'certificateSha256': certificate, 'pinnedCertificateMatches': True,
    'webBuildResourcesMatched': len(resources), 'capacitorBridgeResourcesMatched': len(bridges),
    'physicalDeviceTested': False, 'emulatorTested': False,
}
save('release-verification.json', result)
print(json.dumps(result, ensure_ascii=False, indent=2))

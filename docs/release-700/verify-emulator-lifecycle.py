"""Cover-upgrade the disposable AVD and verify Android Home/app-resume behaviour.

Requires --apk explicitly and refuses every AVD except fortuna700isolated.
No real user database or existing emulator is accessed.
"""
from pathlib import Path
import argparse,importlib.util,json,re,time

spec=importlib.util.spec_from_file_location('fortuna700_emulator',Path(__file__).with_name('emulator-helper.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def wait_labels(required,timeout=20):
    start=time.monotonic()
    while time.monotonic()-start<timeout:
        values=m.labels(m.ui())
        if all(any(text in value for value in values) for text in required):return values
        time.sleep(.3)
    raise AssertionError(f'Missing {required}; last synthetic UI labels={values}')

def check_lifecycle(name,required,forbidden=None):
    pid_before=m.adb('shell','pidof',m.PACKAGE).strip()
    result=m.lifecycle(name,required,forbidden)
    result.update(pidBefore=pid_before,pidAfter=m.adb('shell','pidof',m.PACKAGE).strip())
    return result

parser=argparse.ArgumentParser();parser.add_argument('--apk',type=Path,required=True);args=parser.parse_args()
m.assert_isolated();assert args.apk.is_file()
before=json.loads((m.OUTPUT/'emulator-upgrade-before.json').read_text())
result={'environment':'New isolated Android36.1 arm64 AVD fortuna700isolated/emulator-5582; signed6.0.1 cover-upgraded; synthetic account UI only; no physical-device evidence', 'checks':[]}
try:
    install=m.adb('install','-r',str(args.apk.resolve()));assert 'Success' in install,install
    (m.OUTPUT/'emulator-cover-install.txt').write_text(install)
    package=m.adb('shell','dumpsys','package',m.PACKAGE)
    assert 'versionCode=43 ' in package and 'versionName=7.0.0' in package, 'Unexpected release package'
    (m.OUTPUT/'emulator-upgrade-after-package.txt').write_text(package)
    result['checks'].append({'name':'Signed6.0.1/41 to7.0.0/43 cover-install','passed':True})
    m.resume();wait_labels(['FORTUNA700_SYNTHETIC_CASH'])
    m.tap_label('FORTUNA700_SYNTHETIC_CASH',partial=True)
    values=wait_labels(['FORTUNA700_SYNTHETIC_CASH','USD'])
    if 'Show Amount' in values:m.tap_label('Show Amount')
    values=wait_labels(['1,234.56','USD','FORTUNA700_SYNTHETIC_CASH'])
    m.capture('emulator-upgrade-after-detail')
    result['checks'].append({'name':'Synthetic account, USD currency and exact123456 minor-unit balance retained','passed':True})
    m.tap_label('← Back');wait_labels(['FORTUNA700_SYNTHETIC_CASH','Main navigation'])
    result['checks'].append(check_lifecycle('home',['FORTUNA700_SYNTHETIC_CASH','Main navigation'],['New chat']))
    m.tap_label('Dividends');wait_labels(['Refresh All Quotes & Dividends','Open Q&A'])
    result['checks'].append(check_lifecycle('dividend',['Refresh All Quotes & Dividends','Open Q&A'],['New chat']))
    m.tap_label('Stocks & plans',partial=True);wait_labels(['New chat','Review current plan','Batch Import'])
    result['checks'].append(check_lifecycle('selection',['New chat','Review current plan','Batch Import'],['Chat history']))
    m.tap_label('Chat');wait_labels(['Chat history','Send'])
    root=m.ui();edit=[n for n in root.iter('node') if n.get('class')=='android.widget.EditText'];assert edit
    x1,y1,x2,y2=map(int,re.findall(r'\d+',edit[-1].get('bounds')))
    m.adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
    m.adb('shell','input','text','FORTUNA700_DRAFT_KEEP')
    m.adb('shell','input','keyevent','KEYCODE_BACK')
    wait_labels(['FORTUNA700_DRAFT_KEEP'])
    result['checks'].append(check_lifecycle('chat',['Chat history','FORTUNA700_DRAFT_KEEP','Send'],['Review current plan']))
    result['success']=True
finally:
    (m.OUTPUT/'emulator-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))

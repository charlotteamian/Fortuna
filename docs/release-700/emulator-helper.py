"""Operate only the disposable Fortuna 7.0.0 release-verification AVD."""
from pathlib import Path
import argparse,json,re,subprocess,time,xml.etree.ElementTree as ET

ADB='/Users/restartday/Library/Android/sdk/platform-tools/adb'
SERIAL='emulator-5582'
PACKAGE='com.fortuna.wealthtracker'
OUTPUT=Path(__file__).parent

def adb(*args, binary=False):
    result=subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,text=not binary,check=True)
    return result.stdout

def assert_isolated():
    assert adb('shell','getprop','ro.boot.qemu.avd_name').strip()=='fortuna700isolated', 'Refusing a non-isolated AVD'

def ui():
    path='/sdcard/fortuna700-isolated-ui.xml'
    adb('shell','uiautomator','dump',path)
    value=adb('exec-out','cat',path)
    return ET.fromstring(value)

def labels(root):
    return [n.get('text','') or n.get('content-desc','') for n in root.iter('node') if n.get('text') or n.get('content-desc')]

def tap_label(value, partial=False, nth=0):
    root=ui();matches=[n for n in root.iter('node') if (value in (n.get('text',''),n.get('content-desc','')) if not partial else any(value in n.get(k,'') for k in ['text','content-desc'])) and n.get('bounds')]
    assert len(matches)>nth, f'Label {value!r} missing; visible={labels(root)}'
    x1,y1,x2,y2=map(int,re.findall(r'\d+',matches[nth].get('bounds')))
    adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))

def capture(name):
    root=ui();(OUTPUT/f'{name}.xml').write_text(ET.tostring(root,encoding='unicode'))
    (OUTPUT/f'{name}.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
    return root

def resume():
    adb('shell','am','start','-n',PACKAGE+'/.MainActivity')

def lifecycle(name, required, forbidden=None):
    before=capture('emulator-'+name+'-before');before_labels=labels(before)
    for text in required: assert any(text in t for t in before_labels),f'{name}: missing {text!r} before background'
    adb('shell','input','keyevent','KEYCODE_HOME');time.sleep(1)
    resume();time.sleep(1)
    after=capture('emulator-'+name+'-after');after_labels=labels(after)
    for text in required: assert any(text in t for t in after_labels),f'{name}: missing {text!r} after resume'
    for text in forbidden or []: assert not any(text in t for t in after_labels),f'{name}: unexpected {text!r} after resume'
    return {'page':name,'required':required,'passed':True,'beforeVisibleLabels':len(before_labels),'afterVisibleLabels':len(after_labels)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['labels','capture','tap','text','swipe','resume']);parser.add_argument('value',nargs='?');parser.add_argument('--partial',action='store_true');parser.add_argument('--nth',type=int,default=0)
    args=parser.parse_args();assert_isolated()
    if args.action=='labels':print(json.dumps(labels(ui()),ensure_ascii=False,indent=2))
    elif args.action=='capture':print(json.dumps(labels(capture(args.value)),ensure_ascii=False,indent=2))
    elif args.action=='tap':tap_label(args.value,args.partial,args.nth)
    elif args.action=='text':adb('shell','input','text',args.value.replace(' ','%s'))
    elif args.action=='swipe':adb('shell','input','swipe','360','1320','360','450','450')
    elif args.action=='resume':resume()

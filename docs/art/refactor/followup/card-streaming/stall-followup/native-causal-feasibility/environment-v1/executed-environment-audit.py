"""Read-only own-task native capability checks; no install, privilege change or game."""
import argparse, ctypes, hashlib, json, os, platform, shutil, struct, subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True,type=Path);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=False)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def command(argv,name):
 p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False);(args.out/(name+'.stdout')).write_bytes(p.stdout);(args.out/(name+'.stderr')).write_bytes(p.stderr)
 return {'argv':argv,'returncode':p.returncode,'stdout':name+'.stdout','stderr':name+'.stderr','stdoutSha256':hashlib.sha256(p.stdout).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr).hexdigest()}
script=Path(__file__).read_bytes();(args.out/'executed-environment-audit.py').write_bytes(script)
result={'scope':'Read-only installed binaries/known debug locations/kernel settings; one disabled own-task software counter and ptrace on newly spawned /usr/bin/true only. No process-memory read, sampling, Chromium attach, install, permission change or GPU/game workload.','scriptSha256':hashlib.sha256(script).hexdigest(),'uid':os.getuid(),'platform':platform.platform(),'machine':platform.machine(),'tools':{n:shutil.which(n) for n in ['chromium','readelf','nm','addr2line','objdump','strace','perf','gdb','lldb','bpftrace','trace-cmd']},'binaries':[],'settings':{}}
for name in ['chromium','libEGL.so','libGLESv2.so','libvk_swiftshader.so','chrome-sandbox']:
 path=Path('/usr/lib/chromium')/name;st=path.stat();row={'path':str(path),'bytes':st.st_size,'sha256':sha(path),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(st.st_mode&0o7777)}
 if name!='chrome-sandbox':
  row['sections']=command(['readelf','-SW',str(path)],name+'-sections');row['notes']=command(['readelf','-n',str(path)],name+'-notes');row['debuglink']=command(['readelf','--string-dump=.gnu_debuglink',str(path)],name+'-debuglink');row['exports']=command(['nm','-D','--defined-only','-C',str(path)],name+'-exports')
  text=(args.out/row['sections']['stdout']).read_text();row['hasSymtab']=' .symtab ' in text;row['hasEmbeddedDwarfDebug']=' .debug_' in text;row['hasEhFrame']=' .eh_frame ' in text
  exported=(args.out/row['exports']['stdout']).read_text();row['criticalNativeFunctionsExported']={n:n in exported for n in ['WaitForToken','RingBuffer','TransferBuffer','GLES2Implementation','HandleSetToken']}
 result['binaries'].append(row)
result['packages']=command(['dpkg-query','-W','-f=${Package}\t${Version}\t${Status}\n','chromium','chromium-common','chromium-dbgsym','gdb','linux-perf','strace'],'installed-packages');result['straceVersion']=command(['strace','--version'],'strace-version')
for name in ['/proc/sys/kernel/perf_event_paranoid','/proc/sys/kernel/kptr_restrict','/proc/sys/kernel/perf_event_mlock_kb','/proc/sys/kernel/unprivileged_bpf_disabled','/proc/sys/kernel/yama/ptrace_scope','/proc/sys/kernel/unprivileged_userns_clone','/proc/sys/user/max_user_namespaces','/proc/self/status']:
 try:
  text=Path(name).read_text()
  if name=='/proc/self/status':text='\n'.join(s for s in text.splitlines() if s.split(':')[0] in ['Uid','Gid','CapInh','CapPrm','CapEff','CapBnd','NoNewPrivs','Seccomp','Seccomp_filters'])
  result['settings'][name]={'readable':True,'value':text.strip()}
 except OSError as e:result['settings'][name]={'readable':False,'error':str(e)}
result['debugSearch']={'root':'/usr/lib/debug','files':sorted(str(p) for p in Path('/usr/lib/debug').rglob('*') if p.is_file()),'otherDirectories':[{'path':p,'exists':Path(p).exists(),'candidates':sorted(str(f) for f in Path(p).glob('*.debug')) if Path(p).exists() else []} for p in ['/usr/lib/chromium','/usr/lib/chromium/.debug','/usr/local/lib/debug','/workspace/.debug','/tmp/.debug']]}
ids=['73255ebb863e89705adfd9f96d605f6470c41f6e','6e271506994c1a98093d6ac7875ad34ee7ddbe05','4375c1d2ccd8794228ea1c3d52017797c80bd315'];result['matchingDebugFileLocations']=[{'buildId':i,'path':str(Path('/usr/lib/debug/.build-id')/i[:2]/(i[2:]+'.debug')),'exists':(Path('/usr/lib/debug/.build-id')/i[:2]/(i[2:]+'.debug')).exists()} for i in ids]
result['traceRoots']=[{'path':p,'exists':Path(p).exists(),'readable':os.access(p,os.R_OK)} for p in ['/sys/kernel/tracing','/sys/kernel/debug/tracing','/sys/kernel/debug','/dev/dri']]
assert platform.machine()=='x86_64';attr=ctypes.create_string_buffer(struct.pack('IIQQQQQII',1,64,0,0,0,0,(1<<0)|(1<<5)|(1<<6),0,0));libc=ctypes.CDLL(None,use_errno=True);libc.syscall.restype=ctypes.c_long;ctypes.set_errno(0);fd=libc.syscall(ctypes.c_long(298),ctypes.byref(attr),ctypes.c_int(0),ctypes.c_int(-1),ctypes.c_int(-1),ctypes.c_ulong(8));err=ctypes.get_errno();result['ownTaskPerfProbe']={'syscall':'perf_event_open','pid':0,'type':1,'config':0,'disabled':True,'excludeKernel':True,'excludeHypervisor':True,'samplePeriod':0,'resultFd':fd,'errno':err,'error':os.strerror(err) if fd<0 else None,'meaning':'Descriptor permission only; not native-stack/Chrome attach, symbolization or GPU sampling proof.'}
if fd>=0:os.close(fd);result['ownTaskPerfProbe']['fdClosed']=True
result['ownChildPtraceProbe']=command(['strace','-f','-e','trace=execve,exit_group','-o',str(args.out/'own-child-strace.log'),'/usr/bin/true'],'own-child-strace');result['ownChildPtraceMeaning']='Only newly spawned /usr/bin/true; not an assertion that Chromium renderer/GPU attach is authorized or possible.'
result['noProductionOrSystemConfigurationChanged']=True;(args.out/'environment.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'out':str(args.out),'perfOwnDescriptorAllowed':fd>=0,'ownChildPtraceExit':result['ownChildPtraceProbe']['returncode'],'gdb':result['tools']['gdb'],'perfTool':result['tools']['perf'],'matchingDebugFilesFound':sum(r['exists'] for r in result['matchingDebugFileLocations']),'productionChanged':False}))

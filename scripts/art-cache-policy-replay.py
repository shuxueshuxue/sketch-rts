"""Replay actual GPU-miss requests; counts are not wall-time predictions."""
import json, sys
from collections import OrderedDict, Counter
trace=json.load(open(sys.argv[1]))['rasterTrace'];rows=[]
for mb in [8,16,32,40,48,56,64]:
 for policy in ['lru','admit2','lfu']:
  cache=OrderedDict();seen=Counter();used=hits=stores=0
  for key in trace['requests']:
   seen[key]+=1
   if key in cache: hits+=1;cache.move_to_end(key);continue
   if policy=='admit2' and seen[key]<2:continue
   size=trace['sizes'][key]
   if size>mb*1048576:continue
   while cache and used+size>mb*1048576:
    old=next(iter(cache)) if policy!='lfu' else min(cache,key=lambda k:seen[k]);used-=cache.pop(old)
   cache[key]=size;used+=size;stores+=1
  rows.append(dict(mib=mb,policy=policy,hits=hits,stores=stores,bytes=used))
result=dict(method=__doc__,requests=len(trace['requests']),unique=len(set(trace['requests'])),results=rows)
print(json.dumps(result,indent=2))

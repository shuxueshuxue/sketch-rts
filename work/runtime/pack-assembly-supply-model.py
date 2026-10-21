import gzip, hashlib, json, pathlib, sys
source = pathlib.Path(sys.argv[1])
raw = source.read_bytes()
data = json.loads(gzip.decompress(raw) if source.suffix == '.gz' else raw)
profiles, indices, samples = [], {}, []
for sample in data['samples']:
    if sample['dataset'] != 'fixed':
        continue
    producers = []
    for producer in sample['producers']:
        points = []
        for point in producer['points']:
            members = []
            for member in point['members']:
                key = json.dumps(member, sort_keys=True, separators=(',', ':'))
                if key not in indices:
                    indices[key] = len(profiles)
                    profiles.append(member)
                members.append(indices[key])
            total = sum(profiles[index]['force'] for index in members)
            assert abs(total - point['force']) < 1e-10
            points.append([point['offsetTicks'], point['force'], members])
        producers.append({**{key: value for key, value in producer.items() if key != 'points'}, 'points': points})
    samples.append({**{key: value for key, value in sample.items() if key != 'producers'}, 'producers': producers})
packed = {**{key: value for key, value in data.items() if key != 'samples'},
          'packing': {'version': 1, 'sourceGzipSha256': hashlib.sha256(raw).hexdigest(),
                      'pointColumns': ['offsetTicks', 'force', 'memberProfileIndices'],
                      'evidenceIdsAreNotFutureEntityIds': True},
          'memberProfiles': profiles, 'samples': samples}
target = pathlib.Path(sys.argv[2])
target.write_text(json.dumps(packed, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({'sourceSha256': hashlib.sha256(raw).hexdigest(), 'samples':len(samples),
                  'memberProfiles':len(profiles), 'bytes':target.stat().st_size,
                  'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))

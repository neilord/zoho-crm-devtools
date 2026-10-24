import json, sys
f = sys.argv[1]
keep = ('LayoutCount','RecalcStyleCount','ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration')
for l in open(f):
    d = json.loads(l); s = d['scenario']
    if s.startswith('gesture'):
        print(s, d['label'], 'frame mean/p95/max', d['frameMs'].get('mean'), d['frameMs'].get('p95'), d['frameMs'].get('max'), '>25:', d['over25ms'], '>50:', d['over50ms'], 'handler', d['handlerMs'].get('mean'), d['handlerMs'].get('max'), 'nodes', d['boardNodes'])
        print('    perFrame', {k: v for k, v in d['perFrame'].items() if k in keep})
        print('    trace', {k: (v['n'], v['ms']) for k, v in d['trace'].items()})
    elif s.startswith('open'):
        print(s, d['marksMs'], 'long', d['longTasks'], 'task', d['delta']['TaskDuration'], 'script', d['delta']['ScriptDuration'], 'layout', d['delta']['LayoutDuration'], d['delta']['LayoutCount'], 'nodes', d['overlayNodes'])
    elif s.startswith('switch') or s.startswith('search') or s.startswith('inspector') or s.startswith('rail') or s.startswith('island'):
        if 'delta' in d:
            print(s, 'wall', d['wallMs'], 'task', d['delta']['TaskDuration'], 'script', d['delta']['ScriptDuration'], 'layout', d['delta']['LayoutDuration'], d['delta']['LayoutCount'], 'style', d['delta']['RecalcStyleDuration'], d['delta']['RecalcStyleCount'], 'long', d['longTasks'], 'nodes', d['overlayNodes'], 'dNodes', d['delta']['Nodes'])
        else:
            print(s, d)
    elif s.startswith('fog'):
        print(s, {k: v for k, v in d.items() if k not in ('label', 'scenario', 'trace')})
        print('    trace', {k: (v['n'], v['ms']) for k, v in d['trace'].items()})
    elif s == 'leak-sample':
        print(d['label'], 'listeners', d['JSEventListeners'], 'nodes', d['Nodes'], 'heap', d['JSHeapUsedSize'])

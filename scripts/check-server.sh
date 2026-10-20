#!/usr/bin/env bash
# Read-only post-update checks; requires Docker Compose and host Python 3.
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "用法：bash scripts/check-server.sh [预期镜像完整标签]" >&2
  exit 2
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "用法：bash scripts/check-server.sh [预期镜像完整标签]"
  echo "检查镜像、后台、地面洞穴和固定的 15 个模组；只读，不重启服务。"
  echo "退出码：0=全部通过，1=未通过或证据不足，2=参数或依赖缺失。"
  exit 0
fi
for dst_dependency in docker python3; do
  if ! command -v "$dst_dependency" >/dev/null 2>&1; then
    echo "缺少依赖：$dst_dependency" >&2
    exit 2
  fi
done

dst_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$dst_project_root"

python3 - "${1:-ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47}" <<'PY'
import base64
import json
import re
import subprocess
import sys
from urllib.request import Request, urlopen

EXPECTED = sys.argv[1]
IDS = '831523966 1200745268 2287303119 1909182187 2847908822 623749604 604761020 2753774601 2078243581 362175979 1185229307 1207269058 3753319890 3760106287 378160973'.split()
checks = []


def run(*args, merge_stderr=False):
    return subprocess.check_output(
        args, text=True, timeout=40,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE,
    )


def check(name, ok):
    checks.append(bool(ok))
    print(('PASS  ' if ok else 'CHECK ') + name)


def container(service):
    cid = run('docker', 'compose', 'ps', '-a', '-q', service).strip()
    if not cid or '\n' in cid:
        raise RuntimeError(service + ': 找不到唯一容器')
    return json.loads(run('docker', 'inspect', cid))[0]


def http(web, path):
    env = dict(x.split('=', 1) for x in web['Config']['Env'] if '=' in x)
    port = web['NetworkSettings']['Ports']['80/tcp'][0]['HostPort']
    credentials = env.get('BASIC_AUTH_USER', 'admin') + ':' + env.get('BASIC_AUTH_PASSWORD', '')
    auth = base64.b64encode(credentials.encode()).decode()
    req = Request(
        'http://127.0.0.1:' + port + path,
        headers={'Authorization': 'Basic ' + auth},
    )
    with urlopen(req, timeout=40) as response:
        return response.read().decode()


try:
    game, api, web = [
        container(s) for s in ('dst-server', 'admin-api', 'admin-web')
    ]
    check('新镜像：' + game['Config']['Image'],
          game['Config']['Image'] == EXPECTED)
    for name, item in [('dst-server', game), ('admin-api', api), ('admin-web', web)]:
        check(name + ' 容器运行',
              item['State']['Running'] and not item['State'].get('OOMKilled', False))
    check('Docker 健康状态',
          game['State'].get('Health', {}).get('Status') == 'healthy')

    for name, path, valid in [
        ('后台页面', '/', lambda b: '<div id="app"' in b),
        ('后台 API 与 Docker 控制连接', '/api/server/status',
         lambda b: json.loads(b).get('overall') == 'running'),
        ('世界配置读取', '/api/config/server',
         lambda b: json.loads(b).get('steamToken') == ''
         and bool(json.loads(b).get('steamTokenMasked'))),
    ]:
        try:
            check(name, valid(http(web, path)))
        except Exception as error:
            check(name + '（' + type(error).__name__ + '）', False)

    state = json.loads(run(
        'docker', 'exec', game['Id'], 'cat', '/run/dst/status.json',
    ))
    check('监督器 overall=running', state.get('overall') == 'running')
    for name in ('Master', 'Caves'):
        shard = next(
            (s for s in state.get('shards', []) if s.get('name') == name), {},
        )
        check(name + ' 就绪且未退出',
              shard.get('ready') is True
              and shard.get('pid', 0) > 0
              and shard.get('exitCode') is None)
    try:
        run('docker', 'exec', game['Id'], 'python3',
            '/usr/local/bin/dst-supervisor.py', '--healthcheck')
        check('状态心跳与进程存活', True)
    except subprocess.SubprocessError:
        check('状态心跳与进程存活', False)

    # Include both Docker log streams, limited to the current container start.
    log = run('docker', 'logs', '--since', game['State']['StartedAt'],
              game['Id'], merge_stderr=True)
    shard_logs = {
        s: '\n'.join(line for line in log.splitlines()
                     if line.startswith('[' + s + ']'))
        for s in ('Master', 'Caves')
    }

    def last(pattern, text):
        return max(
            (m.start() for m in re.finditer(pattern, text, re.I)), default=-1,
        )

    linked = True
    for name, pattern in [
        ('Master', r'\[Shard\].*Secondary Caves\(2\) ready!'),
        ('Caves', r'\[Shard\].*secondary shard LUA is now ready!'),
    ]:
        text = shard_logs[name]
        ready = last(pattern, text)
        lost = last(r'\[Shard\].*(?:disconnect|lost connection|connection.*lost)', text)
        linked = linked and ready >= 0 and ready > lost
    check('地面与洞穴已绑定，之后无分片断连记录', linked)
    check('本轮无 Lua/模组报错记录', not re.search(
        r'LUA ERROR|MOD ERROR|stack traceback:|Error loading mod|Failed to load mod',
        log, re.I,
    ))

    print('\nMod ID        Master加载  Caves加载')
    totals = {'Master': 0, 'Caves': 0}
    for mid in IDS:
        result = []
        for name in ('Master', 'Caves'):
            pattern = (
                r'\bMod:\s*workshop-' + mid
                + r'(?!\d)[^\n]*\bLoading\s+mod(?:main|worldgenmain)\.lua\b'
            )
            ok = bool(re.search(pattern, shard_logs[name], re.I))
            totals[name] += int(ok)
            checks.append(ok)
            result.append('OK' if ok else 'CHECK')
        print(f'{mid:<13} {result[0]:<11} {result[1]}')
    for name, count in totals.items():
        print(f'{name}: {count}/15')
    print('\n' + (
        'PASS：镜像、后台、双分片及 15 个模组的启动检查通过。'
        if all(checks) else
        'CHECK：存在未通过或证据不足的项目，请查看本轮日志。'
    ))
    sys.exit(0 if all(checks) else 1)
except Exception as error:
    # Do not print HTTP bodies or container configuration containing credentials.
    print('CHECK：检查未完成（' + type(error).__name__ + '）。')
    print('请检查 docker compose ps -a 和 docker compose logs --tail=100。')
    sys.exit(1)
PY

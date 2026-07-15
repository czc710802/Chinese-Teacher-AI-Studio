import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(process.cwd());
const statusScript = path.join(repoRoot, 'ops/scripts/status-production.sh');
const restartScript = path.join(repoRoot, 'ops/scripts/restart-production.sh');

function createMockBinDir(config = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'prod-status-mocks-'));
  const stateDir = path.join(dir, 'state');
  mkdirSync(stateDir);

  const launchctlScript = `#!/bin/bash
set -euo pipefail
log_file="${config.launchctlLog || path.join(dir, 'launchctl.log')}"
echo "launchctl $*" >> "$log_file"
cmd="\${1:-}"
shift || true
case "$cmd" in
  print)
    label="\${1:-}"
    if [[ "$label" == *"${config.serverLabel || 'com.zhenwanyue.ai-server'}" ]]; then
      state="${config.serverState || 'running'}"
      pid="${config.serverPid || '1047'}"
      program="${config.serverProgram || '/Users/chenxiansheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'}"
      last_exit="${config.serverLastExit || '0'}"
    elif [[ "$label" == *"${config.tunnelLabel || 'com.zhenwanyue.cloudflared'}" ]]; then
      state="${config.tunnelState || 'running'}"
      pid="${config.tunnelPid || '1016'}"
      program="${config.tunnelProgram || '/Users/chenxiansheng/Desktop/workspace/高中作文AI批改App/tools/cloudflared'}"
      last_exit="${config.tunnelLastExit || '0'}"
    elif [[ "$label" == *"${config.watchdogLabel || 'com.zhenwanyue.health-watchdog'}" ]]; then
      state="${config.watchdogState || 'running'}"
      pid="${config.watchdogPid || '1018'}"
      program="${config.watchdogProgram || '/bin/bash'}"
      last_exit="${config.watchdogLastExit || '0'}"
    else
      exit 1
    fi
    cat <<EOF
gui/501/$label = {
  state = $state
  pid = $pid
  program = $program
  last exit code = $last_exit
}
EOF
    ;;
  kickstart|bootstrap|enable|bootout)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

  const lsofScript = `#!/bin/bash
set -euo pipefail
log_file="${config.lsofLog || path.join(dir, 'lsof.log')}"
echo "lsof $*" >> "$log_file"
if [[ "${config.portListening ?? 1}" == "1" ]]; then
  cat <<EOF
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    ${config.portPid || '1047'} user   15u  IPv4 0x0      0t0  TCP *:${config.port || '4000'} (LISTEN)
EOF
  exit 0
fi
exit 1
`;

const curlScript = `#!/bin/bash
set -euo pipefail
log_file="${config.curlLog || path.join(dir, 'curl.log')}"
echo "curl $*" >> "$log_file"
out_file=""
url=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    -o|--output)
      out_file="\${args[i+1]:-}"
      ((i++))
      ;;
    --write-out|--connect-timeout|--max-time|--noproxy)
      ((i++))
      ;;
    -s|-S|-sS|--silent|--show-error)
      ;;
    http*://*)
      url="\${args[i]}"
      ;;
  esac
done
case "$url" in
  http://127.0.0.1:4000/api/health)
    remaining_file="${config.fail127File || path.join(stateDir, 'fail127')}"
    remaining="${config.fail127BeforeSuccess || 0}"
    if [[ -f "$remaining_file" ]]; then
      remaining="$(cat "$remaining_file")"
    fi
    if (( remaining > 0 )); then
      printf '%s' "$((remaining - 1))" > "$remaining_file"
      echo '{"ok":false}' > "\${out_file:-/dev/null}"
      exit 7
    fi
    echo '{"ok":true,"source":"127"}' > "\${out_file:-/dev/null}"
    echo '200'
    ;;
  http://localhost:4000/api/health)
    remaining_file="${config.failLocalhostFile || path.join(stateDir, 'failLocalhost')}"
    remaining="${config.failLocalhostBeforeSuccess || 0}"
    if [[ -f "$remaining_file" ]]; then
      remaining="$(cat "$remaining_file")"
    fi
    if (( remaining > 0 )); then
      printf '%s' "$((remaining - 1))" > "$remaining_file"
      echo '{"ok":false}' > "\${out_file:-/dev/null}"
      exit 7
    fi
    if [[ "${config.localhostOk ?? '1'}" == "1" ]]; then
      echo '{"ok":true,"source":"localhost"}' > "\${out_file:-/dev/null}"
      echo '200'
      exit 0
    fi
    echo '{"ok":false}' > "\${out_file:-/dev/null}"
    exit 7
    ;;
  https://pi.zhenwanyue.icu/api/health)
    if [[ "${config.publicOk ?? '1'}" == "1" ]]; then
      echo '{"ok":true,"source":"public"}' > "\${out_file:-/dev/null}"
      echo '200'
      exit 0
    fi
    echo '{"ok":false}' > "\${out_file:-/dev/null}"
    exit 7
    ;;
  *)
    echo '{"ok":true}' > "\${out_file:-/dev/null}"
    echo '200'
    ;;
esac
`;

  for (const [name, content] of [['launchctl', launchctlScript], ['lsof', lsofScript], ['curl', curlScript]]) {
    const file = path.join(dir, name);
    writeFileSync(file, content, 'utf8');
    chmodSync(file, 0o755);
  }

  return {
    dir,
    stateDir,
    path: `${dir}:${process.env.PATH}`,
    logs: {
      launchctl: config.launchctlLog || path.join(dir, 'launchctl.log'),
      lsof: config.lsofLog || path.join(dir, 'lsof.log'),
      curl: config.curlLog || path.join(dir, 'curl.log')
    }
  };
}

function runScript(scriptPath, env = {}, options = {}) {
  return spawnSync('bash', [scriptPath, ...(options.args || [])], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      PATH: env.PATH || process.env.PATH
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
}

test('prod status tolerates a transient first local health failure', () => {
  const mocks = createMockBinDir({
    fail127BeforeSuccess: 1,
    publicOk: 1,
    localhostOk: 1
  });
  const result = runScript(statusScript, { PATH: mocks.path });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /final status: HEALTHY|final status: STARTING|final status: DEGRADED/);
  assert.match(result.stdout, /127\.0\.0\.1 health result: 200/);
  assert.match(result.stdout, /public health result: 200/);
});

test('prod status reports degraded when localhost and 127.0.0.1 differ', () => {
  const mocks = createMockBinDir({
    publicOk: 1,
    localhostOk: 0,
    failLocalhostBeforeSuccess: 1
  });
  const result = runScript(statusScript, { PATH: mocks.path });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /final status: DEGRADED/);
  assert.match(result.stdout, /localhost health result: 000/);
});

test('prod status fails when local health never comes back and port is down', () => {
  const mocks = createMockBinDir({
    portListening: 0,
    publicOk: 0,
    localhostOk: 0,
    fail127BeforeSuccess: 20,
    failLocalhostBeforeSuccess: 20
  });
  const result = runScript(statusScript, { PATH: mocks.path });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /final status: UNHEALTHY|final status: STARTING/);
});

test('prod status reports starting when launchd and port are ready but health is still warming up', () => {
  const mocks = createMockBinDir({
    portListening: 1,
    publicOk: 0,
    localhostOk: 0,
    fail127BeforeSuccess: 20,
    failLocalhostBeforeSuccess: 20
  });
  const result = runScript(statusScript, { PATH: mocks.path });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /final status: STARTING/);
  assert.match(result.stdout, /后端进程和端口已就绪/);
});

test('prod restart waits for readiness before reporting status', () => {
  const mocks = createMockBinDir({
    fail127BeforeSuccess: 1,
    publicOk: 1,
    localhostOk: 1
  });
  const result = runScript(restartScript, {
    PATH: mocks.path,
    PROD_RESTART_WAIT_SECONDS: '15',
    PROD_RESTART_CHECK_INTERVAL_SECONDS: '1',
    PROD_STATUS_RETRIES: '2',
    PROD_STATUS_INITIAL_WAIT_SECONDS: '0',
    PROD_STATUS_RETRY_DELAY_SECONDS: '0'
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /waiting for production services/);
  assert.match(result.stdout, /core services ready|core services not fully ready/);
  const launchctlLog = readFileSync(mocks.logs.launchctl, 'utf8');
  assert.match(launchctlLog, /kickstart/);
});

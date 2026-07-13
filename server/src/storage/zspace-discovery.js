import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function asBool(value) {
  return Boolean(value?.open || value === true);
}

function textBlob(candidate = {}) {
  return [
    candidate.ip,
    candidate.hostname,
    candidate.name,
    candidate.vendor,
    candidate.model,
    candidate.ssdp?.manufacturer,
    candidate.ssdp?.modelName,
    candidate.ssdp?.friendlyName,
    candidate.services?.http?.title,
    candidate.services?.https?.title,
    candidate.services?.http?.server,
    candidate.services?.https?.server
  ].filter(Boolean).join(' ').toLowerCase();
}

export function classifyNasCandidate(candidate = {}) {
  const blob = textBlob(candidate);
  const services = candidate.services || {};
  const protocols = {
    smb: asBool(services.smb) || asBool(services.netbios),
    webdav: asBool(services.webdav) || asBool(services.webdavHttps),
    sftp: asBool(services.sftp),
    http: asBool(services.http),
    https: asBool(services.https)
  };
  const isZspace = /zspace|z-space|极空间|z2\s*pro|z2pro|zos/.test(blob);
  let model = candidate.model || candidate.ssdp?.modelName || '';
  if (/z2\s*pro|z2pro/.test(blob)) model = 'Z2 Pro';
  return {
    ...candidate,
    protocols,
    isNas: Boolean(protocols.smb || protocols.webdav || protocols.sftp || isZspace),
    isZspace,
    model: model || (isZspace ? 'ZSpace NAS' : ''),
    confidence: [
      isZspace ? 50 : 0,
      protocols.smb ? 15 : 0,
      protocols.webdav ? 10 : 0,
      protocols.sftp ? 5 : 0,
      protocols.http || protocols.https ? 5 : 0
    ].reduce((sum, value) => sum + value, 0)
  };
}

export function mergeCandidates(candidates = []) {
  const map = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const key = candidate.ip || candidate.hostname || candidate.name;
    if (!key) continue;
    const existing = map.get(key) || { services: {}, sources: [], shares: [] };
    map.set(key, {
      ...existing,
      ...candidate,
      hostname: candidate.hostname || existing.hostname,
      name: candidate.name || existing.name,
      services: { ...(existing.services || {}), ...(candidate.services || {}) },
      ssdp: { ...(existing.ssdp || {}), ...(candidate.ssdp || {}) },
      sources: uniq([...(existing.sources || []), ...(candidate.sources || [])]),
      shares: uniq([...(existing.shares || []), ...(candidate.shares || [])])
    });
  }
  return [...map.values()].map(classifyNasCandidate)
    .filter((candidate) => candidate.isNas || candidate.ip || candidate.hostname)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

export function recommendConnection({ candidates = [], volumes = [] } = {}) {
  const mounted = volumes.find((volume) => volume.likelyZspace && volume.writable)
    || volumes.find((volume) => /作文ai|zspace|z2|极空间/i.test(`${volume.path} ${volume.mountedFrom || ''}`) && volume.writable);
  if (mounted) {
    return {
      protocol: 'local_mount',
      host: '',
      port: '',
      mountPath: mounted.path,
      remotePath: '/作文AI',
      reason: 'Mac 已挂载可写共享目录，程序可按普通文件目录写入，最少凭证暴露，失败面最小。'
    };
  }
  const zspace = candidates.find((candidate) => candidate.isZspace) || candidates[0];
  if (!zspace) {
    return {
      protocol: 'local_mount',
      host: '',
      port: '',
      mountPath: '/Volumes/作文AI',
      remotePath: '/作文AI',
      reason: '未发现明确极空间设备，先保留本地挂载方案，避免猜测 IP 或凭证。'
    };
  }
  if (zspace.protocols?.smb) {
    return {
      protocol: 'local_mount',
      host: zspace.ip || zspace.hostname || '',
      port: 445,
      mountPath: '/Volumes/作文AI',
      remotePath: '/作文AI',
      reason: '发现 SMB 服务。推荐先用 macOS 挂载 SMB 后让应用写本地挂载目录，稳定且不需要在应用进程中处理 NAS 密码。'
    };
  }
  if (zspace.protocols?.webdav) {
    const httpsWebdav = zspace.services?.webdavHttps?.open;
    return {
      protocol: 'webdav',
      host: zspace.ip || zspace.hostname || '',
      port: httpsWebdav ? 5006 : 5005,
      mountPath: '',
      remotePath: '/作文AI',
      reason: '未发现可用挂载目录，但发现 WebDAV 服务，可作为第二优先级同步方式。'
    };
  }
  if (zspace.protocols?.sftp) {
    return {
      protocol: 'sftp',
      host: zspace.ip || zspace.hostname || '',
      port: 22,
      mountPath: '',
      remotePath: '/作文AI',
      reason: '发现 SFTP 端口开放，但需要确认极空间是否启用 SFTP 用户和安全凭证。'
    };
  }
  return {
    protocol: 'local_mount',
    host: zspace.ip || zspace.hostname || '',
    port: '',
    mountPath: '/Volumes/作文AI',
    remotePath: '/作文AI',
    reason: '发现疑似极空间，但无法无凭证确认文件协议；推荐先启用并挂载 SMB。'
  };
}

export function buildEnvSuggestion({ recommendation = {} } = {}) {
  return [
    'NAS_ENABLED=true',
    `NAS_PROTOCOL=${recommendation.protocol || 'local_mount'}`,
    `NAS_HOST=${recommendation.host || ''}`,
    `NAS_PORT=${recommendation.port || ''}`,
    'NAS_USERNAME=',
    'NAS_PASSWORD=',
    `NAS_REMOTE_PATH=${recommendation.remotePath || '/作文AI'}`,
    `NAS_MOUNT_PATH=${recommendation.mountPath || '/Volumes/作文AI'}`,
    'NAS_SYNC_INTERVAL_SECONDS=60',
    'NAS_RETRY_COUNT=5',
    'NAS_TIMEOUT_MS=15000',
    'NAS_VERIFY_TLS=true'
  ].join('\n');
}

function protocolText(candidate = {}) {
  const protocols = candidate.protocols || {};
  return [
    `SMB=${protocols.smb ? '开启/可达' : '未确认'}`,
    `WebDAV=${protocols.webdav ? '开启/可达' : '未确认'}`,
    `SFTP=${protocols.sftp ? '开启/可达' : '未确认'}`,
    `HTTP=${protocols.http ? '可达' : '未确认'}`,
    `HTTPS=${protocols.https ? '可达' : '未确认'}`
  ].join('，');
}

export function renderZspaceSetupMarkdown({
  generatedAt = new Date().toISOString(),
  candidates = [],
  volumes = [],
  recommendation = {},
  envSuggestion = '',
  scanNotes = []
} = {}) {
  const zspaces = candidates.filter((candidate) => candidate.isZspace);
  const nasCandidates = candidates.filter((candidate) => candidate.isNas || candidate.confidence > 0);
  const candidateRows = (nasCandidates.length ? nasCandidates : candidates).map((candidate, index) => (
    `| ${index + 1} | ${candidate.ip || ''} | ${candidate.hostname || candidate.name || ''} | ${candidate.isZspace ? '是' : '未确认'} | ${candidate.model || ''} | ${protocolText(candidate)} | ${(candidate.shares || []).join(', ')} |`
  )).join('\n') || '| - | 未发现 |  |  |  |  |  |';
  const volumeRows = volumes.map((volume) => (
    `| ${volume.path} | ${volume.mountedFrom || ''} | ${volume.writable ? '可写' : '未确认/不可写'} | ${volume.likelyZspace ? '疑似极空间' : ''} |`
  )).join('\n') || '| 未发现可用挂载目录 |  |  |  |';

  return `# 极空间 Z2 Pro 自动发现与接入建议

生成时间：${generatedAt}

## 当前发现的极空间

${zspaces.length ? `发现 ${zspaces.length} 台疑似极空间设备。` : '未能无凭证确认极空间设备。'}

| # | IP | Hostname | 极空间 | 型号 | 协议探测 | 共享目录 |
|---|---|---|---|---|---|---|
${candidateRows}

## /Volumes 挂载检查

| 路径 | 来源 | 状态 | 识别 |
|---|---|---|---|
${volumeRows}

## 推荐连接方式

- 推荐协议：${recommendation.protocol || 'local_mount'}
- 推荐主机：${recommendation.host || '无'}
- 推荐端口：${recommendation.port || '无'}
- 推荐挂载目录：${recommendation.mountPath || '无'}
- 推荐远端目录：${recommendation.remotePath || '/作文AI'}
- 原因：${recommendation.reason || '暂无'}

## .env.production 建议追加块

只建议追加，不要由脚本自动写入生产配置。

\`\`\`bash
${envSuggestion}
\`\`\`

## 自动扫描说明

${scanNotes.length ? scanNotes.map((note) => `- ${note}`).join('\n') : '- 无额外说明。'}
- 共享目录列为空表示当前无凭证扫描无法枚举 SMB/WebDAV 目录；这通常需要 NAS 用户名和密码，并不代表共享目录不存在。

## 下一步还需要哪些信息

- NAS 用户名和密码仍需由你确认后写入本机受保护配置，脚本不会猜测或生成凭证。
- 如果推荐 SMB 本地挂载，需要确认 Mac 是否要长期自动挂载该共享目录。
- 如果只发现 WebDAV/SFTP，需要确认极空间端是否已经开启对应服务以及端口。
- 确认共享目录中是否已有或需要新建 \`作文AI\`。
`;
}

export function getLocalSubnets(networkInterfaces = os.networkInterfaces()) {
  const subnets = [];
  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const parts = entry.address.split('.').map(Number);
      if (parts.length !== 4) continue;
      subnets.push({
        interface: entry.address,
        cidr: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`,
        prefix: `${parts[0]}.${parts[1]}.${parts[2]}.`,
        self: entry.address
      });
    }
  }
  return subnets;
}

export function subnetHosts(subnets = getLocalSubnets(), limit = 512) {
  const hosts = [];
  for (const subnet of subnets) {
    for (let i = 1; i <= 254 && hosts.length < limit; i += 1) {
      const ip = `${subnet.prefix}${i}`;
      if (ip !== subnet.self) hosts.push(ip);
    }
  }
  return uniq(hosts);
}

export function probeTcpPort(ip, port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open, error = '') => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (error) => done(false, error.code || error.message));
    socket.connect(port, ip);
  });
}

function requestHttpSummary(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const request = client.request(url, {
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { 'user-agent': 'essay-ai-zspace-discovery/1.0' }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 8192) response.destroy();
      });
      response.on('end', () => {
        const title = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
        resolve({
          open: true,
          statusCode: response.statusCode,
          server: response.headers.server || '',
          title,
          location: response.headers.location || ''
        });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => resolve({ open: false, error: error.code || error.message }));
    request.end();
  });
}

function runCommand(command, args = [], timeoutMs = 3000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout = '', stderr = '') => {
      resolve({
        ok: !error,
        stdout,
        stderr,
        error: error?.message || ''
      });
    });
  });
}

function parseDnsSdBrowse(output = '', serviceType = '') {
  return output.split(/\r?\n/)
    .filter((line) => line.includes(' Add '))
    .map((line) => {
      const parts = line.trim().split(/\s{2,}/);
      const name = parts.at(-1) || '';
      return name ? { name, hostname: `${name.replace(/\s+/g, '-')}.local`, services: { [serviceType]: { open: true } }, sources: ['bonjour'] } : null;
    })
    .filter(Boolean);
}

export async function discoverBonjour() {
  const serviceMap = {
    smb: '_smb._tcp',
    http: '_http._tcp',
    https: '_https._tcp',
    webdav: '_webdav._tcp',
    sftp: '_sftp-ssh._tcp'
  };
  const candidates = [];
  const notes = [];
  for (const [key, type] of Object.entries(serviceMap)) {
    const result = await runCommand('dns-sd', ['-B', type, 'local'], 2200);
    const parsed = parseDnsSdBrowse(result.stdout, key);
    for (const candidate of parsed) {
      try {
        candidate.ip = (await dns.lookup(candidate.hostname, { family: 4 })).address;
      } catch {
        candidate.ip = '';
      }
    }
    candidates.push(...parsed);
    notes.push(`Bonjour ${type}: 发现 ${parsed.length} 个服务`);
  }
  return { candidates, notes };
}

function parseSsdpResponse(message = '') {
  const headers = {};
  for (const line of message.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseXmlTag(xml = '', tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))?.[1]?.trim() || '';
}

async function fetchText(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16384) response.destroy();
      });
      response.on('end', () => resolve(body));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(''));
  });
}

export async function discoverSsdp(timeoutMs = 2500) {
  const socket = dgram.createSocket('udp4');
  const responses = [];
  const message = Buffer.from([
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    'MAN: "ssdp:discover"',
    'MX: 2',
    'ST: ssdp:all',
    '',
    ''
  ].join('\r\n'));

  await new Promise((resolve) => {
    socket.on('message', (msg, rinfo) => responses.push({ msg: msg.toString(), rinfo }));
    socket.on('error', () => resolve());
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(message, 1900, '239.255.255.250', () => {});
      setTimeout(resolve, timeoutMs);
    });
  }).catch(() => {});
  socket.close();

  const candidates = [];
  for (const response of responses) {
    const headers = parseSsdpResponse(response.msg);
    const xml = headers.location ? await fetchText(headers.location) : '';
    candidates.push({
      ip: response.rinfo.address,
      hostname: '',
      ssdp: {
        location: headers.location || '',
        server: headers.server || '',
        st: headers.st || '',
        usn: headers.usn || '',
        friendlyName: parseXmlTag(xml, 'friendlyName'),
        manufacturer: parseXmlTag(xml, 'manufacturer'),
        modelName: parseXmlTag(xml, 'modelName')
      },
      services: { http: headers.location?.startsWith('http:') ? { open: true } : undefined },
      sources: ['ssdp']
    });
  }
  return { candidates, notes: [`SSDP: 收到 ${responses.length} 个响应`] };
}

export async function scanHostPorts(hosts = subnetHosts(), { concurrency = 64, timeoutMs = 450 } = {}) {
  const ports = {
    sftp: 22,
    http: 80,
    https: 443,
    smb: 445,
    netbios: 139,
    webdav: 5005,
    webdavHttps: 5006,
    httpAlt: 8080,
    httpsAlt: 8443
  };
  const candidates = [];
  let index = 0;

  async function worker() {
    while (index < hosts.length) {
      const ip = hosts[index++];
      const services = {};
      await Promise.all(Object.entries(ports).map(async ([name, port]) => {
        const result = await probeTcpPort(ip, port, timeoutMs);
        if (result.open) services[name] = { open: true, port };
      }));
      if (Object.keys(services).length) {
        if (services.http) services.http = { ...services.http, ...(await requestHttpSummary(`http://${ip}/`)) };
        if (services.https) services.https = { ...services.https, ...(await requestHttpSummary(`https://${ip}/`)) };
        candidates.push({ ip, services, sources: ['tcp-scan'] });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length || 1) }, worker));
  return { candidates, notes: [`TCP: 扫描 ${hosts.length} 个地址`] };
}

export async function inspectVolumes(volumesDir = '/Volumes') {
  const mountResult = await runCommand('mount', [], 2000);
  const mountLines = mountResult.stdout.split(/\r?\n/);
  const volumes = [];
  let names = [];
  try {
    names = fs.readdirSync(volumesDir).filter((name) => name && name !== '.timemachine');
  } catch {
    names = [];
  }
  for (const name of names) {
    const volumePath = path.join(volumesDir, name);
    const mountLine = mountLines.find((line) => line.includes(` on ${volumePath} `)) || '';
    let writable = false;
    try {
      fs.accessSync(volumePath, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    volumes.push({
      name,
      path: volumePath,
      mountedFrom: mountLine.split(' on ')[0] || '',
      type: mountLine.match(/\(([^,)]+)/)?.[1] || '',
      writable,
      likelyZspace: /zspace|z2|极空间|作文ai|作文AI|zima|zos/i.test(`${name} ${mountLine}`)
    });
  }
  return { volumes, notes: [`/Volumes: 发现 ${volumes.length} 个挂载项`] };
}

export async function inspectSmbShares(candidate) {
  if (!candidate?.ip && !candidate?.hostname) return [];
  const host = candidate.ip || candidate.hostname;
  const result = await runCommand('smbutil', ['view', '-g', `//guest@${host}`], 3500);
  const shares = result.stdout.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && !/^Share|^-+$|^smb:|^Password/i.test(name))
    .filter((name) => /作文AI|Documents|Public|Backup|home|homes|share/i.test(name));
  return uniq(shares);
}

export async function discoverZspaceNetwork({ scanTcp = true } = {}) {
  const scanNotes = [];
  const allCandidates = [];
  const bonjour = await discoverBonjour();
  scanNotes.push(...bonjour.notes);
  allCandidates.push(...bonjour.candidates);

  const ssdp = await discoverSsdp();
  scanNotes.push(...ssdp.notes);
  allCandidates.push(...ssdp.candidates);

  if (scanTcp) {
    const hosts = subnetHosts();
    const tcp = await scanHostPorts(hosts);
    scanNotes.push(...tcp.notes);
    allCandidates.push(...tcp.candidates);
  }

  const merged = mergeCandidates(allCandidates);
  for (const candidate of merged.filter((item) => item.protocols?.smb).slice(0, 8)) {
    candidate.shares = uniq([...(candidate.shares || []), ...(await inspectSmbShares(candidate))]);
  }
  const volumeResult = await inspectVolumes();
  scanNotes.push(...volumeResult.notes);
  const recommendation = recommendConnection({ candidates: merged, volumes: volumeResult.volumes });
  const envSuggestion = buildEnvSuggestion({ recommendation });
  return {
    generatedAt: new Date().toISOString(),
    candidates: merged,
    volumes: volumeResult.volumes,
    recommendation,
    envSuggestion,
    scanNotes
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEnvSuggestion,
  classifyNasCandidate,
  mergeCandidates,
  recommendConnection,
  renderZspaceSetupMarkdown
} from '../src/storage/zspace-discovery.js';

test('classifies ZSpace Z2 Pro from mixed discovery signals', () => {
  const candidate = classifyNasCandidate({
    ip: '192.168.1.8',
    hostname: 'zspace-z2pro.local',
    services: {
      smb: { open: true },
      http: { open: true, title: 'ZSpace Z2 Pro' },
      webdav: { open: false },
      sftp: { open: true }
    },
    ssdp: {
      manufacturer: 'ZSpace',
      modelName: 'Z2 Pro'
    }
  });

  assert.equal(candidate.isZspace, true);
  assert.equal(candidate.model, 'Z2 Pro');
  assert.equal(candidate.protocols.smb, true);
  assert.equal(candidate.protocols.sftp, true);
});

test('prefers mounted SMB when a matching writable volume is present', () => {
  const recommendation = recommendConnection({
    candidates: [{
      ip: '192.168.1.8',
      hostname: 'zspace-z2pro.local',
      isZspace: true,
      protocols: { smb: true, webdav: true, sftp: false }
    }],
    volumes: [{
      path: '/Volumes/作文AI',
      name: '作文AI',
      mountedFrom: '//user@zspace-z2pro/作文AI',
      likelyZspace: true,
      writable: true
    }]
  });

  assert.equal(recommendation.protocol, 'local_mount');
  assert.equal(recommendation.mountPath, '/Volumes/作文AI');
  assert.match(recommendation.reason, /已挂载/);
});

test('builds suggested env without secrets and without modifying production config', () => {
  const env = buildEnvSuggestion({
    recommendation: {
      protocol: 'webdav',
      host: '192.168.1.8',
      port: 5006,
      remotePath: '/作文AI',
      mountPath: ''
    }
  });

  assert.match(env, /NAS_ENABLED=true/);
  assert.match(env, /NAS_PROTOCOL=webdav/);
  assert.match(env, /NAS_HOST=192\.168\.1\.8/);
  assert.match(env, /NAS_USERNAME=/);
  assert.match(env, /NAS_PASSWORD=/);
  assert.doesNotMatch(env, /secret|token/i);
});

test('merges candidates by ip while preserving discovered protocols', () => {
  const merged = mergeCandidates([
    { ip: '192.168.1.8', hostname: 'nas-a', services: { smb: { open: true } } },
    { ip: '192.168.1.8', hostname: 'nas-a.local', services: { webdav: { open: true } } }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].services.smb.open, true);
  assert.equal(merged[0].services.webdav.open, true);
});

test('renders ZSpace setup markdown with discoveries and next required inputs', () => {
  const markdown = renderZspaceSetupMarkdown({
    generatedAt: '2026-07-10T00:00:00.000Z',
    candidates: [{
      ip: '192.168.1.8',
      hostname: 'zspace-z2pro.local',
      isZspace: true,
      model: 'Z2 Pro',
      protocols: { smb: true, webdav: false, sftp: true, http: true, https: false },
      shares: ['作文AI', 'Public']
    }],
    volumes: [{ path: '/Volumes/作文AI', likelyZspace: true, writable: true }],
    recommendation: { protocol: 'local_mount', mountPath: '/Volumes/作文AI', reason: '已挂载，最稳定。' },
    envSuggestion: 'NAS_ENABLED=true\nNAS_PROTOCOL=local_mount\n',
    scanNotes: ['Bonjour ok']
  });

  assert.match(markdown, /当前发现的极空间/);
  assert.match(markdown, /192\.168\.1\.8/);
  assert.match(markdown, /推荐连接方式/);
  assert.match(markdown, /NAS_PROTOCOL=local_mount/);
  assert.match(markdown, /下一步还需要哪些信息/);
});

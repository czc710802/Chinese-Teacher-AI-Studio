import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPublicUrl, getPublicAccessStatus } from '../src/services/public-access.js';

test('builds public access status from env and tunnel config', () => {
  const files = new Map([
    ['/app/tools/cloudflared', 'binary'],
    ['/app/tools/cloudflared-production.yml', [
      'tunnel: gaozhong-yuwen',
      'protocol: http2',
      'ingress:',
      '  - hostname: pi.example.com',
      '    service: http://127.0.0.1:4000',
      '  - service: http_status:404'
    ].join('\n')]
  ]);

  const status = getPublicAccessStatus({
    appDir: '/app',
    env: { PUBLIC_APP_ORIGIN: 'https://origin.example.com' },
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => files.get(filePath)
  });

  assert.equal(status.enabled, true);
  assert.equal(status.url, 'https://origin.example.com');
  assert.equal(status.tunnelHost, 'pi.example.com');
  assert.equal(status.tunnelService, 'http://127.0.0.1:4000');
  assert.equal(status.tunnelProtocol, 'http2');
  assert.equal(status.hasTunnelBinary, true);
});

test('falls back to cloudflared hostname when public env url is absent', () => {
  const files = new Map([
    ['/app/tools/cloudflared-production.yml', 'ingress:\n  - hostname: essay.example.com\n    service: http://127.0.0.1:4000\n']
  ]);

  const status = getPublicAccessStatus({
    appDir: '/app',
    env: {},
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => files.get(filePath)
  });

  assert.equal(status.enabled, true);
  assert.equal(status.url, 'https://essay.example.com');
  assert.equal(status.hasTunnelBinary, false);
});

test('buildPublicUrl prefers PUBLIC_APP_URL and keeps absolute paths canonical', () => {
  assert.equal(
    buildPublicUrl('/student-mobile/join?token=join_123', { env: { PUBLIC_APP_URL: 'https://pi.zhenwanyue.icu' } }),
    'https://pi.zhenwanyue.icu/student-mobile/join?token=join_123'
  );
  assert.equal(
    buildPublicUrl('https://pi.zhenwanyue.icu/student-mobile/join?token=join_123', { env: { PUBLIC_APP_URL: 'https://dev.example.com' } }),
    'https://pi.zhenwanyue.icu/student-mobile/join?token=join_123'
  );
});

test('production tunnel config pins http2 protocol for restricted networks', () => {
  const configUrl = new URL('../../tools/cloudflared-production.yml', import.meta.url);
  const config = fs.readFileSync(configUrl, 'utf8');

  assert.match(config, /^protocol:\s*http2\s*$/m);
});

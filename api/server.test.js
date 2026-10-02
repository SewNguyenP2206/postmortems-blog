const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { getVisitorSnapshot } = require('./server');

test('stores a keyed IP hash and coarse visitor metadata, not raw identifiers', () => {
  process.env.IP_HASH_SECRET = 'test-secret-with-at-least-32-characters';
  const ip = '203.0.113.42';
  const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1';
  const headers = {
    'user-agent': userAgent,
    referer: 'https://example.com/private/path?token=should-not-be-stored'
  };
  const req = {
    ip,
    get(name) {
      return headers[name.toLowerCase()];
    }
  };
  const snapshot = getVisitorSnapshot(req, 'sample-post', new Date('2026-10-02T00:00:00.000Z'));

  assert.equal(snapshot.slug, 'sample-post');
  assert.equal(snapshot.ipHash, createHmac('sha256', process.env.IP_HASH_SECRET).update(ip).digest('hex'));
  assert.equal(snapshot.device, 'mobile');
  assert.equal(snapshot.browser, 'Safari');
  assert.equal(snapshot.operatingSystem, 'iOS');
  assert.equal(snapshot.referrerHost, 'example.com');
  assert.equal(Object.hasOwn(snapshot, 'ip'), false);
  assert.equal(Object.hasOwn(snapshot, 'userAgent'), false);
  assert.equal(JSON.stringify(snapshot).includes(ip), false);
  assert.equal(JSON.stringify(snapshot).includes('should-not-be-stored'), false);
});
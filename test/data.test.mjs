import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTags, validateApiProfiles, upgradeUserData, mergeTaggedRecords } from '../data-core.js';

test('tags accept common separators, deduplicate, trim and bound size', () => {
    assert.deepEqual(normalizeTags('甜文，校园;甜文|番外\n '), ['甜文', '校园', '番外']);
    assert.deepEqual(normalizeTags([' a ', 'a', null, 3]), ['a']);
    assert.equal(normalizeTags('x'.repeat(100))[0].length, 40);
    assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => 'tag' + i)).length, 20);
});

test('API profile allowlist removes secrets and validates IDs, counts and required fields', () => {
    const profile = { id: 'profile', name: '常用', url: 'https://example.com/v1', model: 'm' };
    assert.deepEqual(validateApiProfiles([{ ...profile, apiKey: 'private', proxy_password: 'private', headers: { Authorization: 'private' } }]), [profile]);
    for (const id of ['__proto__', 'constructor', 'prototype', 'bad id']) assert.throws(() => validateApiProfiles([{ ...profile, id }]), /编号/);
    assert.throws(() => validateApiProfiles([profile, profile]), /重复/);
    assert.throws(() => validateApiProfiles([{ ...profile, name: '' }]), /名称/);
    assert.throws(() => validateApiProfiles(Array(101).fill(profile)), /100/);
});

test('old settings migrate once without losing saved replies, tags or active API', () => {
    const data = { api: { url: 'https://example.com/v1', model: 'm' }, saved: [{ id: 's', text: '原正文' }], replies: [{ id: 'r', tags: ['番外'], text: '原回复' }] };
    assert.equal(upgradeUserData(data), true);
    assert.equal(data.apiProfiles.length, 1);
    assert.equal(data.activeApiProfileId, 'api-legacy');
    assert.equal(data.saved[0].text, '原正文');
    assert.deepEqual(data.saved[0].tags, []);
    assert.deepEqual(data.replies[0].tags, ['番外']);
    assert.equal(upgradeUserData(data), false);
    assert.equal(data.apiProfiles.length, 1);
});

test('backup merge unions tags for duplicates and remaps colliding record IDs for associations', () => {
    const current = [{ id: 's', title: '重复', text: '相同正文', tags: ['校园'] }];
    const incoming = [{ id: 'duplicate', title: '重复', text: '相同正文', tags: ['甜文'] }, { id: 's', title: '新指令', text: '不同正文', tags: ['番外'] }];
    const mapping = mergeTaggedRecords(current, incoming, () => 'replacement-id', i => JSON.stringify([i.title, i.text]));
    assert.equal(current.length, 2);
    assert.deepEqual(current[0].tags, ['校园', '甜文']);
    assert.equal(mapping.get('duplicate'), 's');
    assert.equal(mapping.get('s'), 'replacement-id');
});

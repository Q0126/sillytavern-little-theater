import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { filterCollectedText, normalizeCollectionFilter, snapshotCollectedMessage } from '../data-core.js';

test('collection filtering handles multiple literal blocks, nesting, unmatched markers and disabled mode', () => {
    assert.equal(filterCollectedText('<think>推理</think>正文<think>另一段</think>结尾'), '正文结尾');
    assert.equal(filterCollectedText('正文<think>未闭合内容'), '正文');
    assert.equal(filterCollectedText('<think>外层<think>内层</think>外层</think>正文'), '正文');
    assert.equal(filterCollectedText('<div>正文</div>'), '<div>正文</div>');
    const custom = { enabled: true, start: '<hide.*>', end: '</hide.*>' };
    assert.equal(filterCollectedText('前<hide.*>去掉</hide.*>后', custom), '前后');
    assert.equal(filterCollectedText('<think>保留</think>', { enabled: false, start: '', end: '' }), '<think>保留</think>');
    assert.throws(() => normalizeCollectionFilter({ start: '', end: '</think>' }), /填写/);
    assert.throws(() => normalizeCollectionFilter({ start: '<x>', end: '<x>' }), /不同/);
    assert.throws(() => snapshotCollectedMessage({ mes: '<think>全部</think>' }, null, 'id', 1), /没有/);
});

test('actual host collection saves independent copies, deduplicates, and survives source edit/deletion', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function collectMessage('), source.indexOf('\nfunction installBookmarks()'));
    const context = { chat: [{ name: '用户', is_user: true, mes: '用户脑洞' }, { name: '角色', mes: '<think>隐藏</think>小剧场正文' }] };
    const settings = { data: { saved: [], replies: [] }, lastStoryByChat: { chat: 'instruction' } };
    let saved = 0, synchronized = 0;
    const messages = [];
    const sandbox = { getContext: () => context, snapshotCollectedMessage, settings, crypto: { randomUUID: () => 'id-' + saved }, Date, Math, chatIdentity: () => 'chat', saveSettings: () => saved++, synchronizePanel: () => synchronized++, notify: (type, text) => messages.push([type,text]) };
    vm.runInNewContext(fn + '\n globalThis.collect=collectMessage;', sandbox);
    sandbox.collect(1, true); sandbox.collect(1, true); sandbox.collect(1, false); sandbox.collect(0, true);
    assert.equal(settings.data.saved.length, 2);
    assert.equal(settings.data.replies.length, 1);
    assert.equal(settings.data.replies[0].storyId, 'instruction');
    assert.equal(settings.data.saved[1].contentType, 'scene');
    assert.equal(settings.data.saved[1].text, '小剧场正文');
    assert.equal(context.chat[1].mes, '<think>隐藏</think>小剧场正文');
    context.chat[1].mes = '改变后的正文'; context.chat.splice(0);
    assert.equal(settings.data.saved[1].text, '小剧场正文');
    assert.equal(settings.data.saved[0].text, '用户脑洞');
    assert.equal(settings.data.replies[0].text, '小剧场正文');
    assert.equal(saved, 3); assert.equal(synchronized, 3);
});

test('message scene metadata and filter survive the backup allowlist', () => {
    const html = fs.readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
    const fn = html.slice(html.indexOf('const validId='), html.indexOf('\nfunction makeBackup()'));
    const defaults = JSON.parse(fs.readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
    const record = snapshotCollectedMessage({ name: '角色', mes: '正文' }, null, 'scene-1', 10, true);
    const sandbox = { normalizeCollectionFilter, normalizeTags: v => v || [], validateApiProfiles: v => v, upgradeUserData: () => {}, validateThemeCatalog: v => v, reservedThemeIds: () => [], paletteOptions: mode => [{id: mode === 'day' ? 'cream' : 'violet'}], upgradeBuiltInPresets: v => v, upgradePromptState: () => {}, upgradeAffixes: () => {} };
    vm.runInNewContext(fn + '\n globalThis.clean=validateBackupData;', sandbox);
    defaults.saved.push(record); defaults.collectionFilter = { enabled: true, start: '<hide>', end: '</hide>' };
    const output = sandbox.clean(defaults);
    assert.equal(output.saved[0].contentType, 'scene');
    assert.equal(output.saved[0].role, '角色');
    assert.equal(output.saved[0].text, '正文');
    assert.deepEqual(output.collectionFilter, defaults.collectionFilter);
});

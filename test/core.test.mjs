import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiUrl, chatIdentity, collectContext, makeProxyBody, parseCompletion, requestCompletion } from '../core.mjs';

function fixture() {
    return {
        characterId: 0, name1: '小明', name2: '星',
        getCurrentChatId: () => 'chat-1',
        characters: [{ name: '星', avatar: 'star.png', data: { description: '{{char}}认识{{user}}', personality: '冷静', scenario: '夜晚', mes_example: '你好' } }],
        chat: [{ is_system: true, mes: '隐藏指令' }, { name: '小明', is_user: true, mes: '聊到旅行' }],
        powerUserSettings: { persona_description: '旅行者', forbiddenGlobalPreset: '全局聊天预设' },
        getCharacterCardFields: () => ({ system: '不应读取', jailbreak: '不应读取' }),
    };
}

test('API base URL accepts an endpoint but rejects credentials and parameters', () => {
    assert.equal(normalizeApiUrl(' https://api.example.com/v1/chat/completions/ '), 'https://api.example.com/v1');
    assert.equal(normalizeApiUrl('http://localhost:8000/v1/'), 'http://localhost:8000/v1');
    for (const url of ['bad', 'javascript:alert(1)', 'https://key@api.example.com', 'https://api.example.com/?key=x', 'https://api.example.com/#x']) {
        assert.throws(() => normalizeApiUrl(url));
    }
});

test('context loads full character data, persona and recent chat without global presets', async () => {
    const context = fixture();
    let loaded;
    context.unshallowCharacter = async id => { loaded = id; };
    context.chat.push(...Array.from({ length: 25 }, (_, i) => ({ name: '星', mes: String(i), is_user: false })));
    const snapshot = await collectContext(() => context);
    assert.equal(loaded, 0);
    assert.equal(snapshot.data.roles[0].description, '星认识小明');
    assert.equal(snapshot.data.user.description, '旅行者');
    assert.equal(snapshot.data.recentChat.length, 20);
    assert.equal(snapshot.data.recentChat[0].text, '5');
    assert.equal(snapshot.identity, chatIdentity(context));
    assert.doesNotMatch(JSON.stringify(snapshot), /不应读取|隐藏指令|全局聊天预设/);
});

test('switching chats during character loading aborts reference collection', async () => {
    const context = fixture();
    context.unshallowCharacter = async () => { context.getCurrentChatId = () => 'chat-2'; };
    await assert.rejects(collectContext(() => context), /聊天已切换/);
    await assert.rejects(collectContext(() => ({ characters: [] })), /打开一个角色/);
});

test('group reference includes member data even when the active character fields differ', async () => {
    const context = fixture();
    context.groupId = 'g';
    context.groups = [{ id: 'g', members: ['star.png'] }];
    context.getCharacterCardFields = () => ({ description: '另一个角色', persona: '用户设定' });
    const snapshot = await collectContext(() => context);
    assert.equal(snapshot.data.roles[0].description, '星认识小明');
    assert.equal(snapshot.data.user.description, '用户设定');
});

test('proxy payload contains only the independent generation settings and bounded output', () => {
    const request = { messages: [{ role: 'system', content: '编写小剧场指令' }, { role: 'user', content: '旅行脑洞' }], max_tokens: 512, globalPreset: '不要继承' };
    const body = makeProxyBody({ url: 'https://api.example.com/v1/', model: 'model' }, request, { data: { roles: [] } }, 'test-key');
    assert.equal(body.messages.length, 3);
    assert.equal(body.messages[0].content, '编写小剧场指令');
    assert.equal(body.messages[2].content, '旅行脑洞');
    assert.equal(body.proxy_password, 'test-key');
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 512);
    assert.equal(body.reverse_proxy, 'https://api.example.com/v1');
    assert.equal(request.messages.length, 2);
    assert.ok(!('globalPreset' in body));
    assert.throws(() => makeProxyBody({ url: 'https://api.example.com', model: '' }, request), /模型/);
    assert.throws(() => makeProxyBody({ url: 'https://api.example.com', model: 'm' }, { ...request, max_tokens: 0 }), /上限/);
});

test('completion parser handles thinking blocks, multimodal content, truncation and backend errors', () => {
    assert.deepEqual(parseCompletion({ choices: [{ message: { content: '<think>推理</think>请写旅行小剧场。' }, finish_reason: 'length' }] }), { text: '请写旅行小剧场。', truncated: true });
    assert.equal(parseCompletion({ choices: [{ message: { content: [{ text: '请写' }, { text: '小剧场' }] } }] }).text, '请写小剧场');
    assert.throws(() => parseCompletion({ error: { message: '余额不足' } }), /余额不足/);
    assert.throws(() => parseCompletion({}, 401), /401/);
    assert.throws(() => parseCompletion({ choices: [] }), /没有返回/);
});

test('generation uses the Tavern server with its request headers and propagates cancellation', async t => {
    const controller = new AbortController();
    let actual;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        actual = { url, options };
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '请写小剧场。' } }] }) };
    });
    const output = await requestCompletion(() => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-csrf' }) }), { url: 'https://api.example.com/v1', model: 'm' }, { messages: [{ role: 'user', content: '脑洞' }], max_tokens: 128 }, null, 'key', controller.signal);
    assert.equal(output.text, '请写小剧场。');
    assert.equal(actual.url, '/api/backends/chat-completions/generate');
    assert.equal(actual.options.credentials, 'same-origin');
    assert.equal(actual.options.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(actual.options.signal, controller.signal);
    t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Stopped', 'AbortError'); });
    await assert.rejects(requestCompletion(() => ({ getRequestHeaders: () => ({}) }), { url: 'https://api.example.com', model: 'm' }, { messages: [{ role: 'user', content: '脑洞' }], max_tokens: 128 }, null, '', controller.signal), { name: 'AbortError' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { makeProxyBody } from '../core.mjs';

const expected = `你是小剧场创作指令整理助手。仅把用户本次输入的脑洞整理成可直接发送给酒馆角色的创作指令，不生成故事正文。保留用户明确写出的情境、参与者、事件、限制和要求；仅补充必要的连接语，使表达清晰，不为凑字数添加新的剧情要求。不用于推断或规定角色在本次情境下的态度。禁止自行指定角色的初始态度、情绪、心理、反应、具体台词、选择、行动路线、情绪转变或结局；不要安排角色先如何再如何、从某种态度转变为另一种态度。用户明确指定的反应或情绪要求可以原样保留，未指定的一律留白，由酒馆角色依据人设和现场情境自行发挥。不要追加描写某种情绪变化、逐渐接受某事等引导角色反应的要求。只整理用户的脑洞，不读取、改写或补入前缀和后缀，前后缀由界面另行拼接。只输出整理后的创作指令，不附解释、分析、思考过程、状态栏或反问。
$所有人称严格用{{user}}和{{char}}称呼，不要出现人名`;
const defaults = JSON.parse(fs.readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../panel.html', import.meta.url), 'utf8');

function promptLogic(preset = defaults.promptPresets[0]) {
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const declarations = script.match(/^(?:const (?:legacyBuiltInPrompt|previousBuiltInPrompt|previousIdeaOnlyPrompt|previousNoAttitudePrompt|previousVerbatimPrompt|builtInPrompt|defaultPreset)=|function upgradeBuiltInPresets).*$/gm).join('\n');
    const migration = script.match(/^function upgradePromptState\(data\)\{[\s\S]*?^\}/m)[0];
    const request = script.match(/^function buildGenerationRequest\(\).*$/m)[0];
    const sandbox = { state: { api: { model: 'test-model' } }, activePreset: () => preset, buildPrompt: () => '脑洞原文' };
    vm.runInNewContext(declarations + '\n' + migration + '\n' + request + '\n globalThis.logic={upgradePromptState,buildGenerationRequest,builtInPrompt};', sandbox);
    return sandbox.logic;
}

test('default preset and generated system message match the supplied two-line text exactly', () => {
    assert.equal(defaults.promptPresets[0].systemPrompt, expected);
    const logic = promptLogic();
    assert.equal(logic.builtInPrompt, expected);
    const request = logic.buildGenerationRequest();
    assert.equal(request.messages[0].content, expected);
    assert.equal(request.messages[1].content, '脑洞原文');
    assert.equal(request.max_tokens, 1024);
    const body = makeProxyBody({ url: 'https://example.com/v1', model: 'test-model' }, request, { data: { roles: [] } }, 'test-key');
    assert.equal(body.messages[0].content, expected);
    assert.equal(body.messages.at(-1).content, '脑洞原文');
});

test('update replaces only the active preset once and preserves later edits', () => {
    const logic = promptLogic();
    const data = { promptPresets: [{ id: 'active', systemPrompt: '当前的自定义旧指令' }, { id: 'other', systemPrompt: '另一组自建预设' }], activePresetId: 'active', verbatimPromptVersion: 1 };
    logic.upgradePromptState(data);
    assert.equal(data.promptPresets[0].systemPrompt, expected);
    assert.equal(data.promptPresets[1].systemPrompt, '另一组自建预设');
    assert.equal(data.verbatimPromptVersion, 2);
    data.promptPresets[0].systemPrompt = '之后手动编辑的内容';
    logic.upgradePromptState(data);
    assert.equal(data.promptPresets[0].systemPrompt, '之后手动编辑的内容');
});

test('requests preserve whitespace and never append target-word instructions', () => {
    const raw = '\n' + expected + '\n';
    const request = promptLogic({ systemPrompt: raw, targetWords: 9000, maxTokens: 256 }).buildGenerationRequest();
    assert.equal(request.messages[0].content, raw);
    assert.equal(request.max_tokens, 256);
    assert.ok(!request.messages[0].content.includes('篇幅要求'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { makeProxyBody } from '../core.mjs';

const expected = `你是小剧场创作指令编写助手。你的任务是把用户输入的脑洞整理成一段可直接发送给酒馆角色、让角色据此创作小剧场的指令，保持用户的核心脑洞、指定情境与要求，严格禁止擅自编造重要的人物对于剧情的态度，不替角色安排具体台词或预先决定剧情结局。
仅根据用户本次输入的脑洞整理指令，不读取、改写或补入前缀和后缀；前后缀由界面在发送时单独拼接。
$所有称呼严格用user和char代替，禁止出现人名`;
const defaults = JSON.parse(fs.readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../panel.html', import.meta.url), 'utf8');

function promptLogic(preset = defaults.promptPresets[0]) {
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const declarations = script.match(/^(?:const (?:legacyBuiltInPrompt|previousBuiltInPrompt|previousIdeaOnlyPrompt|previousNoAttitudePrompt|builtInPrompt|defaultPreset)=|function upgradeBuiltInPresets).*$/gm).join('\n');
    const migration = script.match(/^function upgradePromptState\(data\)\{[\s\S]*?^\}/m)[0];
    const request = script.match(/^function buildGenerationRequest\(\).*$/m)[0];
    const sandbox = { state: { api: { model: 'test-model' } }, activePreset: () => preset, buildPrompt: () => '脑洞原文' };
    vm.runInNewContext(declarations + '\n' + migration + '\n' + request + '\n globalThis.logic={upgradePromptState,buildGenerationRequest,builtInPrompt};', sandbox);
    return sandbox.logic;
}

test('default preset and generated system message match the supplied three-line text exactly', () => {
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
    const data = { promptPresets: [{ id: 'active', systemPrompt: '当前的自定义旧指令' }, { id: 'other', systemPrompt: '另一组自建预设' }], activePresetId: 'active' };
    logic.upgradePromptState(data);
    assert.equal(data.promptPresets[0].systemPrompt, expected);
    assert.equal(data.promptPresets[1].systemPrompt, '另一组自建预设');
    assert.equal(data.verbatimPromptVersion, 1);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { replyParts } from '../render-core.js';

test('HTML status bars are rendered directly while preserving surrounding prose and non-HTML code', () => {
    const source='正文\n```html\n<!DOCTYPE html><html><head><style>.status{color:red}</style></head><body><div class="status">状态栏</div></body></html>\n```\n后文\n```js\nconsole.log("hello");\n```';
    const parts=replyParts(source);
    assert.equal(parts.filter(p=>p.html!==undefined).length,1);
    assert.match(parts.find(p=>p.html).html,/<div class="status">状态栏/);
    assert.equal(parts[0].text,'正文\n');
    assert.match(parts.at(-1).text,/```js/);
    assert.equal(parts.map(p=>p.text||'').join('').includes('状态栏'),false);
});

test('full HTML documents, fragments and unlabeled HTML fences are recognized without treating ordinary code as HTML', () => {
    assert.equal(replyParts('<!DOCTYPE html>\n<html><body>状态栏</body></html>')[0].html.includes('状态栏'),true);
    assert.equal(replyParts('<style>.status{color:red}</style><div>状态栏</div>')[0].html.includes('<style>'),true);
    assert.equal(replyParts('```\n<div>状态栏</div>\n```')[0].html,'<div>状态栏</div>\n');
    assert.equal(replyParts('```javascript\n<div>example</div>\n```')[0].html,undefined);
    assert.equal(replyParts('```javascript\n<html><body>example</body></html>\n```')[0].html,undefined);
    const parts=replyParts('前文\n<html><body>状态栏</body></html>\n后文');
    assert.equal(parts.length,3);assert.match(parts[1].html,/<html>/);
});

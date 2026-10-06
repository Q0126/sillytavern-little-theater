import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_VARIABLES, validateTheme, themeSignature, validateThemeCatalog, makeThemeFile, parseThemeFile } from '../theme-core.js';

const fixture = () => ({ id: 'custom-1', name: '自制樱粉', mode: 'day', variables: Object.fromEntries(THEME_VARIABLES.map(key => [key, key === 'shadow' ? '#0003' : '#F4EFE5'])) });

test('selected theme roundtrips all color variables while excluding unrelated user data', () => {
    const source = { ...fixture(), apiKey: 'private-key', replies: ['私人回复'], prefixes: ['私人前缀'] };
    const file = makeThemeFile(source);
    const parsed = parseThemeFile(JSON.stringify(file));
    assert.equal(parsed.name, '自制樱粉');
    assert.equal(parsed.variables.bg, '#f4efe5');
    assert.equal(parsed.variables.shadow, '#0003');
    assert.equal(Object.keys(parsed.variables).length, 15);
    assert.ok(!('id' in parsed));
    assert.doesNotMatch(JSON.stringify(file), /private-key|私人回复|私人前缀/);
});

test('theme files reject missing colors, invalid mode, CSS and HTML injection', () => {
    for (const value of ['url(https://example.com)', '#fff; background:red', '</style><script>bad()</script>', 'var(--text)', '#12345']) {
        assert.throws(() => validateTheme({ ...fixture(), variables: { ...fixture().variables, bg: value } }));
    }
    const missing = fixture(); delete missing.variables.accent;
    assert.throws(() => validateTheme(missing), /accent/);
    assert.throws(() => validateTheme({ ...fixture(), mode: 'auto' }), /模式/);
    assert.throws(() => validateTheme({ ...fixture(), name: ' ' }), /名称/);
    assert.throws(() => validateTheme({ ...fixture(), variables: { ...fixture().variables, externalUrl: 'https://example.com' } }), /字段/);
});

test('only a theme file is accepted by the appearance importer', () => {
    assert.throws(() => parseThemeFile('not JSON'), /JSON/);
    assert.throws(() => parseThemeFile(JSON.stringify({ app: 'little-theater', version: 1, data: {} })), /美化/);
    assert.throws(() => parseThemeFile(JSON.stringify({ ...makeThemeFile(fixture()), version: 2 })), /美化/);
});

test('custom catalogs preserve selections by ID and reject builtin collisions or duplicate IDs', () => {
    assert.deepEqual(validateThemeCatalog(), []);
    assert.equal(validateThemeCatalog([fixture()])[0].id, 'custom-1');
    assert.throws(() => validateThemeCatalog([fixture(), fixture()]), /重复/);
    assert.throws(() => validateThemeCatalog([{ ...fixture(), id: 'cream' }], ['cream']), /冲突/);
    assert.throws(() => validateThemeCatalog(Array.from({ length: 201 }, (_, i) => ({ ...fixture(), id: String(i) }))), /200/);
});

test('theme deduplication uses name, mode and stable color order, and preserves changed variants', () => {
    const theme = validateTheme(fixture());
    const reordered = { ...theme, variables: Object.fromEntries(Object.entries(theme.variables).reverse()) };
    assert.equal(themeSignature(theme), themeSignature(reordered));
    assert.notEqual(themeSignature(theme), themeSignature({ ...theme, mode: 'night' }));
    assert.notEqual(themeSignature(theme), themeSignature({ ...theme, variables: { ...theme.variables, bg: '#ffffff' } }));
});

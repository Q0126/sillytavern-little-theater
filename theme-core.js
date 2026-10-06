/** Portable appearance files contain colors only, independent of user data. */
export const THEME_VARIABLES = Object.freeze(['bg', 'panel', 'card', 'field', 'text', 'muted', 'line', 'accent', 'ink', 'soft', 'pink', 'danger', 'nav', 'shadow', 'glow']);

export function validateTheme(raw, requireId = false) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('美化内容无效');
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 60) throw new Error('美化名称应为 1–60 个字');
    if (!['day', 'night'].includes(raw.mode)) throw new Error('美化模式应为 day（日间）或 night（夜间）');
    if (!raw.variables || typeof raw.variables !== 'object' || Array.isArray(raw.variables)) throw new Error('缺少美化色值');
    if (Object.keys(raw.variables).some(key => !THEME_VARIABLES.includes(key))) throw new Error('美化包含不支持的色值字段');
    const variables = {};
    for (const key of THEME_VARIABLES) {
        const value = raw.variables[key];
        if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())) {
            throw new Error(`${key} 应填写十六进制色值，例如 #a46385 或 #00000033`);
        }
        variables[key] = value.trim().toLowerCase();
    }
    const theme = { name: raw.name.trim(), mode: raw.mode, variables };
    if (requireId) {
        if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(raw.id)) throw new Error('美化编号无效');
        theme.id = raw.id;
    }
    return theme;
}

export function themeSignature(theme) {
    return JSON.stringify([theme.mode, theme.name, ...THEME_VARIABLES.map(key => theme.variables[key])]);
}

export function validateThemeCatalog(raw = [], reservedIds = []) {
    if (!Array.isArray(raw) || raw.length > 200) throw new Error('自定义美化最多保存 200 组');
    const ids = new Set(reservedIds);
    return raw.map(item => {
        const theme = validateTheme(item, true);
        if (ids.has(theme.id)) throw new Error('美化编号重复或与内置美化冲突');
        ids.add(theme.id);
        return theme;
    });
}

export function makeThemeFile(theme) {
    return { app: 'little-theater-theme', version: 1, exportedAt: new Date().toISOString(), theme: validateTheme(theme) };
}

export function parseThemeFile(text) {
    let file;
    try { file = JSON.parse(text); } catch { throw new Error('请选择有效的美化 JSON 文件'); }
    if (file?.app !== 'little-theater-theme' || file?.version !== 1) throw new Error('请选择从“美化”窗口导出的文件');
    return validateTheme(file.theme);
}

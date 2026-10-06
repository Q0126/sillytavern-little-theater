export function normalizeTags(value) {
    const tags = Array.isArray(value) ? value : String(value || '').split(/[,，;；|\n]+/);
    return [...new Set(tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

export function validateApiProfiles(value = []) {
    if (!Array.isArray(value) || value.length > 100) throw new Error('API 配置列表无效，最多保存 100 组');
    const ids = new Set();
    return value.map(p => {
        if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(p.id) || ['__proto__', 'constructor', 'prototype'].includes(p.id) || ids.has(p.id)) throw new Error('API 配置编号无效或重复');
        ids.add(p.id);
        for (const [field, limit] of [['name', 80], ['url', 4096], ['model', 1000]]) {
            if (typeof p[field] !== 'string' || !p[field].trim() || p[field].length > limit) throw new Error('API 配置名称、地址或模型无效');
        }
        // Deliberately allowlist metadata: keys never enter exported state.
        return { id: p.id, name: p.name.trim(), url: p.url.trim(), model: p.model.trim() };
    });
}

export function upgradeUserData(data) {
    for (const list of [data.saved || [], data.replies || []]) for (const item of list) item.tags = normalizeTags(item.tags);
    data.apiProfiles = validateApiProfiles(data.apiProfiles || []);
    if (!data.apiProfiles.length && data.api?.url && data.api?.model) {
        data.apiProfiles.push({ id: 'api-legacy', name: '原有 API 配置', url: data.api.url, model: data.api.model });
        data.activeApiProfileId = 'api-legacy';
        return true;
    }
    if (!data.apiProfiles.some(p => p.id === data.activeApiProfileId)) data.activeApiProfileId = '';
    return false;
}

export function mergeTaggedRecords(current, incoming, makeId, signature) {
    const map = new Map();
    for (const item of incoming) {
        const same = current.find(i => signature(i) === signature(item));
        if (same) {
            same.tags = normalizeTags([...(same.tags || []), ...(item.tags || [])]);
            map.set(item.id, same.id);
        } else {
            const copy = { ...item, tags: normalizeTags(item.tags), id: current.some(i => i.id === item.id) ? makeId() : item.id };
            current.push(copy); map.set(item.id, copy.id);
        }
    }
    return map;
}

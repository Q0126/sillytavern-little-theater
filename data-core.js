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
    data.collectionFilter = normalizeCollectionFilter(data.collectionFilter);
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

export function normalizeCollectionFilter(value) {
    if (value == null) return { enabled: true, start: '<think>', end: '</think>' };
    if (typeof value !== 'object' || typeof value.start !== 'string' || typeof value.end !== 'string' || value.start.length > 200 || value.end.length > 200) throw Error('收藏过滤标记无效');
    const filter = { enabled: value.enabled !== false, start: value.start, end: value.end };
    if (filter.enabled && (!filter.start.trim() || !filter.end.trim() || filter.start === filter.end)) throw Error('请填写不同的开头和结尾标记，或关闭过滤');
    return filter;
}

export function filterCollectedText(text, value) {
    const filter = normalizeCollectionFilter(value);
    const source = String(text || '');
    if (!filter.enabled) return source.trim();
    let cursor = 0, output = '', depth = 0;
    while (cursor < source.length) {
        const start = source.indexOf(filter.start, cursor);
        const end = depth ? source.indexOf(filter.end, cursor) : -1;
        if (depth && end !== -1 && (start === -1 || end < start)) {
            depth--; cursor = end + filter.end.length;
        } else if (start !== -1) {
            if (!depth) output += source.slice(cursor, start);
            depth++; cursor = start + filter.start.length;
        } else {
            if (!depth) output += source.slice(cursor);
            break;
        }
    }
    return output.trim();
}

export function snapshotCollectedMessage(message, filter, id, now, scene = false, storyId = '') {
    if (!message || message.is_system) throw Error('不能收藏系统消息');
    const text = filterCollectedText(message.mes, filter);
    if (!text) throw Error('过滤后没有可收藏的正文');
    const role = String(message.name || (message.is_user ? '用户' : '角色'));
    return { id, title: role + ' · ' + text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 24), text, role, tags: [], created: now, updated: now, ...(scene ? { contentType: 'scene' } : { storyId }) };
}

// The version of the code loaded in this browser, independent of repository updates.
export const CURRENT_VERSION = '1.3.5';
export const UPDATE_URL = 'https://raw.githubusercontent.com/Q0126/sillytavern-little-theater/main/changelog.json';

export function compareVersions(a, b) {
    const parse = value => {
        if (typeof value !== 'string' || !/^\d{1,6}(?:\.\d{1,6}){1,3}$/.test(value)) throw Error('版本号无效');
        return value.split('.').map(Number);
    };
    const left = parse(a), right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff) return Math.sign(diff);
    }
    return 0;
}

export function validateChangelog(data) {
    if (data?.app !== 'little-theater-changelog' || data.version !== 1 || !Array.isArray(data.releases) || !data.releases.length || data.releases.length > 100) throw Error('更新日志格式无效');
    const seen = new Set();
    const releases = data.releases.map(r => {
        compareVersions(r?.version, CURRENT_VERSION);
        if (seen.has(r.version) || typeof r.date !== 'string' || typeof r.title !== 'string' || !Array.isArray(r.changes) || r.changes.some(c => typeof c !== 'string')) throw Error('更新日志条目无效');
        seen.add(r.version);
        return { version: r.version, date: r.date, title: r.title, changes: [...r.changes] };
    }).sort((a, b) => compareVersions(b.version, a.version));
    return releases;
}

export async function fetchChangelog(url, fetcher = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (!response.ok) throw Error('更新日志加载失败（HTTP ' + response.status + '）');
        return validateChangelog(await response.json());
    } finally { clearTimeout(timer); }
}

export function releaseLabel(version, installed) {
    const comparison = compareVersions(version, installed);
    return comparison === 0 ? '当前运行版本' : comparison > 0 ? '尚未安装' : '历史版本';
}

export function replyParts(text) {
    const source = String(text || '');
    const parts = [];
    const fence = /^(`{3,}|~{3,})[ \t]*([^\n\r]*)\r?\n([\s\S]*?)^\1[ \t]*\r?$/gm;
    let cursor = 0;
    for (const match of source.matchAll(fence)) {
        if (match.index > cursor) parts.push({ text: source.slice(cursor, match.index) });
        const language = match[2].trim().toLowerCase();
        const html = language === 'html' || language === 'htm' || (!language && /^\s*(?:<!doctype\s+html|<html\b|<style\b|<div\b|<details\b|<section\b)/i.test(match[3]));
        parts.push(html ? { html: match[3] } : { text: match[0], code: true });
        cursor = match.index + match[0].length;
    }
    if (cursor < source.length) parts.push({ text: source.slice(cursor) });
    return parts.flatMap(part => {
        if (part.html !== undefined || part.code) return [part];
        const document = /(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?<\/html\s*>/i.exec(part.text);
        if (document) return [
            ...(document.index ? [{ text: part.text.slice(0, document.index) }] : []),
            { html: document[0] },
            ...(document.index + document[0].length < part.text.length ? [{ text: part.text.slice(document.index + document[0].length) }] : []),
        ];
        if (/^\s*(?:<!doctype\s+html|<html\b|<style\b|<div\b|<details\b|<section\b)/i.test(part.text)) return [{ html: part.text }];
        return [part];
    });
}

export function buildReplyDocument(text, formatter, Parser = DOMParser, colors = {}) {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const safeColor = (value, fallback) => /^[#a-zA-Z0-9(),.% -]+$/.test(value || '') ? value : fallback;
    const styles = [], bodies = [];
    for (const part of replyParts(text)) {
        let html = part.html;
        if (html === undefined) {
            try { html = formatter?.(part.text); } catch {}
            if (typeof html !== 'string') html = '<div class="lt-plain">' + escape(part.text) + '</div>';
        }
        const parsed = new Parser().parseFromString(html, 'text/html');
        parsed.querySelectorAll('script,iframe,object,embed,form,meta,base').forEach(el => el.remove());
        for (const el of parsed.querySelectorAll('*')) {
            for (const attr of Array.from(el.attributes)) {
                if (attr.name.startsWith('on') || ['srcdoc','srcset','autofocus'].includes(attr.name)) el.removeAttribute(attr.name);
            }
        }
        for (const link of parsed.querySelectorAll('link')) {
            if (link.getAttribute('rel')?.toLowerCase() !== 'stylesheet' || !/^https?:\/\//i.test(link.getAttribute('href') || '')) link.remove();
        }
        for (const el of parsed.querySelectorAll('style,link')) { styles.push(el.outerHTML); el.remove(); }
        bodies.push(parsed.body.innerHTML);
    }
    const background = safeColor(colors.background, '#fafafa'), color = safeColor(colors.text, '#333'), accent = safeColor(colors.accent, '#8069b3');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https: http:; font-src https: http: data:; img-src https: http: data:; form-action 'none'; base-uri 'none'"><style>body{margin:0;padding:16px;background:${background};color:${color};font:14px/1.9 system-ui;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin:10px 0;padding-left:12px;border-left:3px solid ${accent}}a{color:${accent}}.lt-plain{white-space:pre-wrap}.mes_text{white-space:normal}</style>${styles.join('\n')}</head><body><div class="mes_text">${bodies.join('\n')}</div></body></html>`;
}

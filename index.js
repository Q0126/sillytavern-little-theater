import { chatIdentity, collectContext, requestCompletion, requestModels, upgradeAffixes } from './core.mjs';
import { upgradeUserData } from './data-core.js';

const MODULE = 'little_theater_v1';
const PANEL_URL = new URL('./panel.html?v=1.3.0', import.meta.url).href;
let shell, frame, settings, sending = false, tavernBusy = false, observer, scrollLock;
const clone = value => JSON.parse(JSON.stringify(value));
const getContext = () => SillyTavern.getContext();
const notify = (type, text) => globalThis.toastr?.[type]?.(text, '脑洞小剧场');

function saveSettings() { getContext().saveSettingsDebounced(); }
function synchronizePanel() { frame?.contentWindow?.LittleTheaterUI?.receiveState(clone(settings.data)); }
function readState() { return clone(settings.data); }
function saveState(data) { settings.data = clone(data); saveSettings(); }

function lockBackgroundScroll() {
    if (scrollLock) return;
    scrollLock = [document.documentElement, document.body].map(element => ({
        element,
        value: element.style.getPropertyValue('overflow'),
        priority: element.style.getPropertyPriority('overflow'),
    }));
    scrollLock.forEach(({ element }) => element.style.setProperty('overflow', 'hidden', 'important'));
}
function unlockBackgroundScroll() {
    scrollLock?.forEach(({ element, value, priority }) => {
        if (value) element.style.setProperty('overflow', value, priority);
        else element.style.removeProperty('overflow');
    });
    scrollLock = undefined;
}

function showPanel() {
    if (!shell) {
        shell = document.createElement('dialog');
        shell.id = 'lt-dialog';
        shell.className = 'lt-shell';
        shell.hidden = true;
        shell.setAttribute('role', 'dialog');
        shell.setAttribute('aria-label', '脑洞小剧场');
        shell.setAttribute('aria-modal', 'true');
        const pane = document.createElement('div');
        pane.className = 'lt-pane';
        const bar = document.createElement('div');
        bar.className = 'lt-bar';
        const title = document.createElement('span');
        title.textContent = '脑洞小剧场';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lt-close';
        close.textContent = '关闭 ×';
        close.setAttribute('aria-label', '关闭脑洞小剧场');
        close.onclick = hidePanel;
        bar.append(title, close);
        frame = document.createElement('iframe');
        frame.id = 'lt-panel-frame';
        frame.src = PANEL_URL;
        frame.title = '脑洞小剧场面板';
        frame.setAttribute('allow', 'clipboard-write');
        frame.onload = synchronizePanel;
        pane.append(bar, frame);
        shell.append(pane);
        shell.addEventListener('click', e => {
            if (e.target !== shell) return;
            const bounds = shell.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) hidePanel();
        });
        shell.addEventListener('cancel', e => { e.preventDefault(); hidePanel(); });
        shell.addEventListener('close', () => {
            if (shell.open) return;
            shell.hidden = true;
            unlockBackgroundScroll();
        });
        document.body.append(shell);
    }
    if (shell.open) { synchronizePanel(); return; }
    shell.hidden = false;
    try {
        shell.showModal();
        lockBackgroundScroll();
    } catch (error) {
        shell.hidden = true;
        notify('error', '无法打开小剧场弹窗：' + error.message);
        return;
    }
    synchronizePanel();
}
function hidePanel() {
    if (shell?.open) shell.close();
    if (shell) shell.hidden = true;
    unlockBackgroundScroll();
}

async function send(text, storyId, sourceIdentity) {
    if (sending || tavernBusy) throw new Error('酒馆正在生成或发送，请等当前回复完成');
    const context = getContext();
    const identity = chatIdentity(context);
    if (sourceIdentity && sourceIdentity !== identity) throw new Error('当前聊天已切换，请重新生成，或从已保存的指令中发送');
    if (context.characterId === undefined && !context.groupId) throw new Error('请先打开角色聊天');
    const textarea = document.querySelector('#send_textarea');
    const button = document.querySelector('#send_but');
    const stop = document.querySelector('#stop_but');
    if (!textarea || !button) throw new Error('没有找到酒馆的用户发送按钮');
    if (button.disabled || (stop && stop.offsetParent !== null)) throw new Error('酒馆正在生成，请稍后发送');
    if (!String(text).trim()) throw new Error('指令内容不能为空');
    const draft = textarea.value;
    const startLength = context.chat.length;
    const event = context.eventTypes.USER_MESSAGE_RENDERED || context.eventTypes.MESSAGE_SENT;
    sending = true;
    let timer, handler, sent = false;
    try {
        await new Promise((resolve, reject) => {
            const check = index => {
                const latest = getContext();
                if (chatIdentity(latest) !== identity) return;
                const message = latest.chat[Number(index)];
                if (message?.is_user && Number(index) >= startLength && typeof message.mes === 'string') { sent = true; resolve(); }
            };
            handler = check;
            context.eventSource.on(event, handler);
            timer = setTimeout(() => {
                getContext().chat.slice(startLength).forEach((_, n) => check(startLength + n));
                if (!sent) reject(new Error('酒馆尚未确认发送，请检查连接或当前编辑状态'));
            }, 8000);
            textarea.value = text;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            button.click();
        });
        settings.lastStoryByChat ||= {};
        settings.lastStoryByChat[identity] = storyId || '';
        saveSettings();
        hidePanel();
        return true;
    } finally {
        clearTimeout(timer);
        context.eventSource.removeListener?.(event, handler);
        context.eventSource.off?.(event, handler);
        if (chatIdentity(getContext()) === identity && ((sent && !textarea.value) || (!sent && textarea.value === text))) {
            textarea.value = draft;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sending = false;
    }
}

function collectReply(index) {
    const context = getContext();
    const message = context.chat[index];
    if (!message || message.is_user || message.is_system || !message.mes?.trim()) return;
    const data = settings.data;
    data.replies ||= [];
    const role = message.name || context.name2 || '角色';
    const text = message.mes;
    if (data.replies.some(r => r.text === text && r.role === role)) { notify('info', '这条回复已经收藏'); return; }
    data.replies.unshift({
        id: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2),
        title: role + ' · ' + text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 24),
        text,
        role,
        tags: [],
        storyId: settings.lastStoryByChat?.[chatIdentity(context)] || '',
        created: Date.now(), updated: Date.now(),
    });
    saveSettings();
    synchronizePanel();
    notify('success', '已收藏到“小剧场 → 已保存 → 角色回复”');
}

function installBookmarks() {
    const context = getContext();
    document.querySelectorAll('#chat .mes[mesid]').forEach(element => {
        const index = Number(element.getAttribute('mesid'));
        const message = context.chat[index];
        const existing = element.querySelector('.lt-reply-bookmark');
        if (!message || message.is_user || message.is_system) { existing?.remove(); return; }
        if (existing) return;
        const toolbar = element.querySelector('.mes_buttons');
        if (!toolbar) return;
        const button = document.createElement('button');
        button.className = 'mes_button lt-reply-bookmark fa-solid fa-bookmark';
        button.title = '收藏到脑洞小剧场';
        button.setAttribute('aria-label', button.title);
        button.type = 'button';
        button.addEventListener('click', e => { e.stopPropagation(); collectReply(Number(element.getAttribute('mesid'))); });
        toolbar.append(button);
    });
}

async function initialize() {
    if (globalThis.LittleTheaterHost) return;
    const context = getContext();
    const response = await fetch(new URL('./defaults.json', import.meta.url));
    if (!response.ok) throw new Error('扩展默认配置加载失败，请重新安装或刷新');
    const defaults = await response.json();
    context.extensionSettings[MODULE] ||= {};
    settings = context.extensionSettings[MODULE];
    settings.data ||= defaults;
    if (upgradeAffixes(settings.data)) saveSettings();
    settings.profileKeys ||= {};
    if (upgradeUserData(settings.data)) settings.profileKeys['api-legacy'] = settings.apiKey || '';
    saveSettings();
    globalThis.LittleTheaterHost = {
        readState, saveState,
        readKey: () => settings.apiKey || '',
        saveKey: key => { settings.apiKey = String(key || ''); saveSettings(); },
        readProfileKey: id => Object.hasOwn(settings.profileKeys, id) ? settings.profileKeys[id] : '',
        saveProfileKey: (id, key) => {
            if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw Error('配置编号无效');
            settings.profileKeys[id] = String(key || ''); settings.apiKey = String(key || ''); saveSettings();
        },
        removeProfileKey: id => { delete settings.profileKeys[id]; saveSettings(); },
        clearProfileKeys: () => { settings.profileKeys = {}; settings.apiKey = ''; saveSettings(); },
        formatReply: (text, role) => {
            const formatter = getContext().messageFormatting;
            return typeof formatter === 'function' ? formatter(text, role || '', false, false, -1) : null;
        },
        snapshot: () => collectContext(getContext),
        generate: (api, request, snapshot, signal) => requestCompletion(getContext, api, request, snapshot, settings.apiKey, signal),
        connectApi: (api, key, signal) => requestModels(getContext, api, key, signal),
        send, close: hidePanel,
    };
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (container) {
        const block = document.createElement('div');
        block.className = 'lt-settings';
        const button = document.createElement('button');
        button.className = 'menu_button';
        button.textContent = '✦ 打开脑洞小剧场';
        button.onclick = showPanel;
        block.append(button); container.append(block);
    }
    const wand = document.querySelector('#extensionsMenu');
    if (wand) {
        const wrapper = document.createElement('div');
        wrapper.id = 'lt-wand-container';
        wrapper.className = 'extension_container';
        const item = document.createElement('div');
        item.id = 'lt-menu-item';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.setAttribute('role', 'button'); item.tabIndex = 0;
        const icon = document.createElement('div');
        icon.className = 'fa-solid fa-masks-theater extensionsMenuExtensionButton';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = '脑洞小剧场';
        item.append(icon, label);
        item.onclick = showPanel;
        item.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPanel(); } };
        wrapper.append(item);
        wand.append(wrapper);
    }
    context.eventSource.on(context.eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => { if (!dryRun) tavernBusy = true; });
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, () => { tavernBusy = false; installBookmarks(); });
    let scheduled = false;
    observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; installBookmarks(); });
    });
    const chat = document.querySelector('#chat');
    if (chat) observer.observe(chat, { childList: true, subtree: true });
    installBookmarks();
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && shell && !shell.hidden) hidePanel(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch(e => notify('error', e.message)), { once: true });
else initialize().catch(e => notify('error', e.message));

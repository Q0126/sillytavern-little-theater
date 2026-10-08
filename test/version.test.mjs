import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CURRENT_VERSION, UPDATE_URL, compareVersions, fetchChangelog, releaseLabel } from '../version-core.js';
const release = version => ({version, date:'2026-10-08',title:'新增功能',changes:['功能一']});
const log = versions => ({app:'little-theater-changelog',version:1,releases:versions.map(release)});

test('running version matches manifest and local release; numeric comparisons identify uninstalled features', () => {
    const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
    const changelog=JSON.parse(fs.readFileSync(new URL('../changelog.json',import.meta.url),'utf8'));
    assert.equal(CURRENT_VERSION,manifest.version);assert.equal(CURRENT_VERSION,changelog.releases[0].version);
    assert.equal(compareVersions('1.10','1.9.9'),1);assert.equal(compareVersions('2.1','2.1.0'),0);
    assert.equal(releaseLabel('3.1','2.1'),'尚未安装');assert.equal(releaseLabel('2.1','2.1'),'当前运行版本');
    assert.throws(()=>compareVersions('unknown','2.1'),/无效/);
});

test('update fetch validates and sorts public data, omits credentials, and rejects HTTP failures', async () => {
    let options;
    const entries=await fetchChangelog(UPDATE_URL,async (url,opts)=>{options=opts;return {ok:true,json:async()=>log(['1.9','1.10'])};});
    assert.equal(entries[0].version,'1.10');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
    assert.equal(options.body,undefined);assert.equal(options.headers,undefined);
    await assert.rejects(fetchChangelog(UPDATE_URL,async()=>({ok:false,status:503})),/503/);
    await assert.rejects(fetchChangelog(UPDATE_URL,async()=>({ok:true,json:async()=>log(['1.1','1.1'])})),/无效/);
});

function uiLogic(installed, remoteFails=false, localFails=false) {
    const html=fs.readFileSync(new URL('../panel.html',import.meta.url),'utf8');
    const start=html.indexOf('const installedVersion=');const end=html.indexOf('$("beautify").onclick=',start);
    const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,showModal(){this.open=true;}});return nodes.get(id);};
    const sandbox={host:{version:installed},CURRENT_VERSION,UPDATE_URL,compareVersions,releaseLabel,$,esc:v=>v,URL,location:{href:'https://tavern.example/panel.html'},fetchChangelog:async url=>{if(String(url)===UPDATE_URL){if(remoteFails)throw Error('offline');return [release('3.1'),release('2.1')];}if(localFails)throw Error('broken');return [release('2.1')];}};
    vm.runInNewContext(html.slice(start,end)+'\nglobalThis.openLog=openChangelog;',sandbox);
    return {sandbox,nodes,$};
}

test('actual UI distinguishes installed and latest versions without pretending a check installed an update',async()=>{
    const ui=uiLogic('2.1');await ui.sandbox.openLog();
    assert.equal(ui.$('changelog-version').textContent,'当前运行 · v2.1');
    assert.equal(ui.$('changelog-latest').textContent,'最新发布 · v3.1');
    assert.match(ui.$('open-changelog').textContent,/v2.1 · 有更新/);
    assert.match(ui.$('changelog-content').innerHTML,/v3.1 · 尚未安装/);
    assert.match(ui.$('changelog-content').innerHTML,/v2.1 · 当前运行版本/);
    assert.equal(ui.$('update-help').hidden,false);
    const refreshed=uiLogic('3.1');await refreshed.sandbox.openLog();
    assert.equal(refreshed.$('changelog-version').textContent,'当前运行 · v3.1');
    assert.equal(refreshed.$('update-status').textContent,'你正在使用最新版本。');
});

test('actual UI preserves installed version/local logs on network failure and uses remote logs on local failure',async()=>{
    const offline=uiLogic('2.1',true);await offline.sandbox.openLog();
    assert.equal(offline.$('changelog-version').textContent,'当前运行 · v2.1');
    assert.match(offline.$('changelog-content').innerHTML,/新增功能/);
    assert.match(offline.$('update-status').textContent,/无法检查/);
    assert.equal(offline.$('check-updates').disabled,false);
    const remote=uiLogic('2.1',false,true);await remote.sandbox.openLog();
    assert.match(remote.$('changelog-content').innerHTML,/v3.1 · 尚未安装/);
    assert.equal(remote.$('retry-changelog').hidden,false);
});

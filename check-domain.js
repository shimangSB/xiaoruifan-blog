#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  域名检查器（升级版）
 * ---------------------------------------------------------------------
 *  双击「检查域名.bat」运行。
 *
 *  它会分四步告诉你现在的真实状况：
 *    1. 域名在全球生效了吗
 *    2. 你在阿里云到底配置了哪些记录（直接问阿里云官方服务器，最准）
 *    3. 全球各地的 DNS 缓存刷新了吗（抽查 5 个公共 DNS）
 *    4. 网站能不能打开
 *  最后告诉你下一步该做什么。
 * ===================================================================== */

const dns = require('dns');
const https = require('https');
const http = require('http');

const DOMAIN = 'xiaoruifan.xyz';
const WWW = 'www.' + DOMAIN;
const GITHUB_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const GITHUB_PAGES = 'shimangSB.github.io';

// 阿里云自己的权威 DNS 服务器（你的域名就托管在这上面）
const AUTHORITATIVE = ['dns25.hichina.com', 'dns26.hichina.com'];

// 用来抽查传播情况的公共 DNS
const PUBLIC_DNS = [
  { ip: '223.5.5.5', name: '阿里云 DNS' },
  { ip: '119.29.29.29', name: '腾讯 DNS' },
  { ip: '180.76.76.76', name: '百度 DNS' },
  { ip: '114.114.114.114', name: '114 DNS' },
  { ip: '8.8.8.8', name: 'Google DNS' },
];

const state = {
  delegated: false,
  authA: [],          // 阿里云上配置的 A 记录
  authCname: [],      // 阿里云上配置的 www CNAME
  propagated: 0,      // 多少个公共 DNS 已经看到 A 记录
  wrongIps: [],
  missingIps: [],
  httpOk: false,
  httpsOk: false,
};

function good(t) { console.log('  [ 好 ] ' + t); }
function bad(t) { console.log('  [ 差 ] ' + t); }
function warn(t) { console.log('  [注意] ' + t); }
function info(t) { console.log('         ' + t); }
function line() { console.log(''); }

/* 指定 DNS 服务器去查 */
function queryOn(server, name, type) {
  return new Promise(function (resolve) {
    const r = new dns.Resolver();
    try { r.setServers([server]); } catch (e) { return resolve([]); }
    const done = function (v) { resolve(v || []); };
    try {
      if (type === 'A') return void r.resolve4(name, function (e, v) { done(e ? [] : v); });
      if (type === 'CNAME') return void r.resolveCname(name, function (e, v) { done(e ? [] : v); });
      if (type === 'NS') return void r.resolveNs(name, function (e, v) { done(e ? [] : v); });
      return done([]);
    } catch (e) { return done([]); }
  });
}

/* Node 的 setServers 只接受 IP，所以先把权威服务器域名解析成 IP */
let authIpsCache = null;
async function getAuthoritativeIps() {
  if (authIpsCache) return authIpsCache;
  const ips = [];
  for (const host of AUTHORITATIVE) {
    let list = await queryOn('223.5.5.5', host, 'A');
    if (!list.length) list = await queryOn('8.8.8.8', host, 'A');
    list.forEach(function (ip) { if (ips.indexOf(ip) === -1) ips.push(ip); });
  }
  authIpsCache = ips;
  return ips;
}

/* ---------- 第 1 步：域名在全球生效了吗 ---------- */
async function stepDelegation() {
  line();
  console.log('  【第 1 步】域名在全球生效了吗？');
  const ns = await queryOn('223.5.5.5', DOMAIN, 'NS');
  if (ns.length) {
    state.delegated = true;
    good('已生效。DNS 服务器：' + ns.join('、'));
  } else {
    const ns2 = await queryOn('8.8.8.8', DOMAIN, 'NS');
    if (ns2.length) {
      state.delegated = true;
      good('已生效。DNS 服务器：' + ns2.join('、'));
    } else {
      bad('还没生效：全世界的 DNS 里暂时还查不到这个域名');
      info('域名刚注册时要等注册局发布，一般几小时，最长 24 小时。');
    }
  }
}

/* ---------- 第 2 步：问阿里云官方服务器 ---------- */
async function stepAuthoritative() {
  line();
  console.log('  【第 2 步】你在阿里云配置了哪些记录？（问阿里云官方服务器，最准）');

  const authIps = await getAuthoritativeIps();
  if (!authIps.length) {
    info('（网络原因，暂时连不上阿里云的权威 DNS，跳过这一步）');
    return;
  }

  const seen = new Set();
  for (const ip of authIps) {
    const list = await queryOn(ip, DOMAIN, 'A');
    list.forEach(function (x) { seen.add(x); });
  }
  state.authA = Array.from(seen);

  if (!state.authA.length) {
    warn('阿里云的权威服务器上暂时查不到 A 记录');
    info('可能是刚添加还在同步，也可能是真的没加成功。');
    info('往下看第 3 步：如果别的 DNS 能查到，说明其实已经配好了。');
    return;
  }

  info('A 记录（' + DOMAIN + '）：');
  state.authA.forEach(function (ip) {
    const ok = GITHUB_IPS.indexOf(ip) !== -1;
    info('    ' + ip + (ok ? '   ✔ 正确' : '   ✘ 不是 GitHub 的地址'));
  });

  state.wrongIps = state.authA.filter(function (ip) { return GITHUB_IPS.indexOf(ip) === -1; });
  state.missingIps = GITHUB_IPS.filter(function (ip) { return state.authA.indexOf(ip) === -1; });

  if (state.wrongIps.length) {
    bad('有 ' + state.wrongIps.length + ' 个地址不是 GitHub 的，要删掉或改掉');
  } else if (state.missingIps.length) {
    warn('还缺 ' + state.missingIps.length + ' 条 A 记录：' + state.missingIps.join('、'));
    info('不影响使用，但补齐 4 条访问更稳。');
  } else {
    good('4 条 A 记录全部正确');
  }

  const cnames = new Set();
  for (const ip of authIps) {
    const list = await queryOn(ip, WWW, 'CNAME');
    list.forEach(function (c) { cnames.add(String(c).replace(/\.$/, '')); });
  }
  state.authCname = Array.from(cnames);
  line();
  if (state.authCname.length) {
    const ok = state.authCname.map(function (c) { return c.toLowerCase(); }).indexOf(GITHUB_PAGES.toLowerCase()) !== -1;
    info('www 的 CNAME：' + state.authCname.join('、') + (ok ? '   ✔ 正确' : '   ✘ 应该是 ' + GITHUB_PAGES));
  } else {
    info('www 的 CNAME：没有配置（不影响 ' + DOMAIN + ' 本身）');
  }
}

/* ---------- 第 3 步：传播情况 ---------- */
async function stepPropagation() {
  line();
  console.log('  【第 3 步】全球各地的 DNS 刷新了吗？（抽查 5 个公共 DNS）');

  let ok = 0;
  for (const s of PUBLIC_DNS) {
    const list = await queryOn(s.ip, DOMAIN, 'A');
    if (list.length) {
      ok++;
      info('  ' + s.name.padEnd(12, ' ') + ' ' + list.join('、'));
    } else {
      info('  ' + s.name.padEnd(12, ' ') + ' 还没刷新（缓存中，等几分钟）');
    }
  }
  state.propagated = ok;

  line();
  if (ok === PUBLIC_DNS.length) {
    good('全部 ' + ok + ' 个 DNS 都已经刷新，传播完成');
  } else if (ok > 0) {
    warn(ok + ' / ' + PUBLIC_DNS.length + ' 个 DNS 已刷新，还在传播中');
    info('一般 10 分钟内全部刷新完（TTL 是 10 分钟）。');
  } else {
    warn('还没有任何一个 DNS 刷新（刚加完记录的话，等几分钟）');
  }
}

/* ---------- 第 4 步：网站能不能打开 ---------- */
function checkUrl(url, isHttps) {
  return new Promise(function (resolve) {
    const lib = isHttps ? https : http;
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };

    const req = lib.get(url, { timeout: 15000 }, function (res) {
      const code = res.statusCode;
      if (isHttps) { state.httpsOk = true; } else { state.httpOk = true; }
      if (code >= 200 && code < 400) {
        good(url + '  →  HTTP ' + code + '，能打开');
      } else {
        warn(url + '  →  HTTP ' + code);
        if (code === 404) info('404 一般是 GitHub Pages 还没部署好（设置里要选 main + /docs）');
      }
      res.resume();
      finish();
    });

    req.on('timeout', function () { req.destroy(); warn(url + '  →  连接超时'); finish(); });
    req.on('error', function (e) {
      const code = e.code || '';
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        info(url + '  →  你本机的 DNS 还没刷新，过几分钟再试');
      } else if (/CERT|certificate|ALTNAME|SELF_SIGNED|VERIFY/i.test(code + ' ' + e.message)) {
        info(url + '  →  网站已经通了，HTTPS 证书还在申请（GitHub 自动搞定，等几小时）');
      } else {
        info(url + '  →  ' + (code || e.message));
      }
      finish();
    });
  });
}

async function stepSite() {
  line();
  console.log('  【第 4 步】网站能打开吗？');
  await checkUrl('http://' + DOMAIN + '/', false);
  await checkUrl('https://' + DOMAIN + '/', true);
}

/* ---------- 结论 ---------- */
function summary() {
  line();
  console.log('  ══════════════ 结论 ══════════════');

  if (state.httpOk || state.httpsOk) {
    if (state.httpsOk) {
      console.log('  🎉 完全就绪！打开 https://' + DOMAIN + ' 就是你的博客。');
    } else {
      console.log('  🎉 网站已经能打开了：http://' + DOMAIN);
      console.log('  HTTPS 证书还在申请中，过几小时会自动升级成 https://');
    }
    line();
    return;
  }

  console.log('  网站暂时还打不开。你现在应该做的是：');
  line();

  if (!state.delegated) {
    console.log('  【等】域名还没在全球生效，只能等（几小时到 24 小时）。');
  } else if (!state.authA.length && state.propagated === 0) {
    console.log('  【做】还没有任何 DNS 能查到 A 记录，解析可能还没添加成功。');
    console.log('       去 https://dns.console.aliyun.com 加记录，');
    console.log('       内容直接从「解析记录-复制我.txt」里复制粘贴。');
  } else if (state.wrongIps.length) {
    console.log('  【改】A 记录填的不是 GitHub 的地址，要删掉重填。');
    console.log('       正确值：185.199.108.153 / 109.153 / 110.153 / 111.153');
  } else {
    console.log('  【等】阿里云上的记录是对的，正在向全球传播。');
    console.log('       当前 ' + state.propagated + '/' + PUBLIC_DNS.length + ' 个公共 DNS 已刷新。');
    console.log('       等 10 分钟再双击一次这个检查，多半就好了。');
  }
  line();
}

async function main() {
  line();
  console.log('  ══════════════ 检查域名状态 ══════════════');
  console.log('  域名：' + DOMAIN);
  console.log('  时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));

  await stepDelegation();
  await stepAuthoritative();
  await stepPropagation();
  await stepSite();
  summary();
}

main().catch(function (e) {
  console.log('');
  console.log('  检查过程中出错了：' + e.message);
  console.log('');
});

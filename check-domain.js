#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  域名检查器
 * ---------------------------------------------------------------------
 *  双击「检查域名.bat」运行。
 *  它会告诉你：域名生效了没有、解析填对了没有、网站能不能打开，
 *  并且明确告诉你下一步该做什么。
 * ===================================================================== */

const dns = require('dns');
const https = require('https');
const http = require('http');

const dnsP = dns.promises;
dns.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']);

const DOMAIN = 'xiaoruifan.xyz';
const WWW = 'www.' + DOMAIN;
const GITHUB_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const GITHUB_PAGES = 'shimangSB.github.io';

const state = {
  delegated: false,
  aRecords: [],
  wrongIps: [],
  missingIps: [],
  wwwOk: false,
  httpOk: false,
  httpsOk: false,
};

function good(t) { console.log('  [ 好 ] ' + t); }
function bad(t) { console.log('  [ 差 ] ' + t); }
function warn(t) { console.log('  [注意] ' + t); }
function info(t) { console.log('         ' + t); }
function line() { console.log(''); }

/* 第 1 步：域名有没有在全球生效 */
async function stepDelegation() {
  line();
  console.log('  【第 1 步】域名在全球生效了吗？');
  try {
    const ns = await dnsP.resolveNs(DOMAIN);
    state.delegated = true;
    good('已生效。DNS 服务器：' + ns.join('、'));
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      bad('还没生效：全世界的 DNS 里暂时还查不到这个域名');
      info('这是正常的——域名刚注册，注册局需要时间把它发布出去。');
      info('一般等几小时，最长 24 小时，你什么都不用做。');
    } else {
      bad('查询失败（' + e.code + '），可能是网络问题，过一会儿再试。');
    }
  }
}

/* 第 2 步：A 记录 */
async function stepApex() {
  line();
  console.log('  【第 2 步】' + DOMAIN + ' 的解析记录填对了吗？');

  try { state.aRecords = await dnsP.resolve4(DOMAIN); } catch (e) { state.aRecords = []; }

  if (!state.aRecords.length) {
    if (state.delegated) {
      warn('域名已生效，但还没有任何 A 记录');
      info('说明还没去阿里云添加解析（或者刚加完，等几分钟）。');
    } else {
      warn('还没有查到 A 记录（域名本身也还没生效，先等第 1 步）');
    }
    return;
  }

  info('现在指向：' + state.aRecords.join('、'));
  state.wrongIps = state.aRecords.filter(function (ip) { return GITHUB_IPS.indexOf(ip) === -1; });
  state.missingIps = GITHUB_IPS.filter(function (ip) { return state.aRecords.indexOf(ip) === -1; });

  if (state.wrongIps.length) {
    bad('有 ' + state.wrongIps.length + ' 个地址不是 GitHub 的：' + state.wrongIps.join('、'));
    info('这些记录要删掉或改掉，否则网站打不开。');
  }
  if (state.missingIps.length) {
    warn('还缺 ' + state.missingIps.length + ' 条 A 记录：' + state.missingIps.join('、'));
    info('不影响使用，但建议补齐 4 条，访问会更稳。');
  }
  if (!state.wrongIps.length && !state.missingIps.length) {
    good('4 条 A 记录全部正确');
  }
}

/* 第 3 步：www */
async function stepWww() {
  line();
  console.log('  【第 3 步】' + WWW + ' 的记录');

  let cname = [];
  try { cname = await dnsP.resolveCname(WWW); } catch (e) { cname = []; }

  if (cname.length) {
    const cleaned = cname.map(function (c) { return String(c).replace(/\.$/, '').toLowerCase(); });
    if (cleaned.indexOf(GITHUB_PAGES) !== -1) {
      state.wwwOk = true;
      good('www 指向 ' + cname.join('、') + '，正确');
    } else {
      bad('www 指向 ' + cname.join('、') + '，应该是 ' + GITHUB_PAGES);
    }
    return;
  }

  let wwwIps = [];
  try { wwwIps = await dnsP.resolve4(WWW); } catch (e) { wwwIps = []; }
  if (wwwIps.length) {
    state.wwwOk = true;
    info('www 直接指向 ' + wwwIps.join('、') + '（也能用）');
  } else {
    warn('www 还没有记录（只影响 www.' + DOMAIN + '，不影响 ' + DOMAIN + ' 本身）');
  }
}

/* 第 4 步：网站能不能打开 */
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
        warn(url + '  →  HTTP ' + code + '（能连上，但返回了错误码）');
        if (code === 404) {
          info('404 一般是 GitHub Pages 还没部署好，或者 Pages 设置里没选 main + /docs');
        }
      }
      res.resume();
      finish();
    });

    req.on('timeout', function () { req.destroy(); warn(url + '  →  连接超时'); finish(); });
    req.on('error', function (e) {
      const code = e.code || '';
      if (code === 'ENOTFOUND') {
        if (state.delegated && !state.aRecords.length) {
          info(url + '  →  域名已生效，但还没有解析记录，所以打不开');
        } else if (state.delegated) {
          info(url + '  →  解析记录还没生效，等几分钟再试');
        } else {
          info(url + '  →  域名还没生效，暂时打不开（正常，继续等）');
        }
      } else if (/CERT|certificate|ALTNAME|SELF_SIGNED|VERIFY/i.test(code + ' ' + e.message)) {
        info(url + '  →  网站已经通了，只是 HTTPS 证书还没弄好（GitHub 会自动申请，等一会儿）');
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

/* 结论 */
function summary() {
  line();
  console.log('  ══════════════ 结论 ══════════════');

  const reachable = state.httpOk || state.httpsOk;

  if (reachable) {
    if (state.httpsOk) {
      console.log('  🎉 全部就绪！打开 https://' + DOMAIN + ' 就是你的博客。');
    } else {
      console.log('  🎉 网站已经能打开了：http://' + DOMAIN);
      console.log('  HTTPS 证书还在申请中，过几小时会自动变成 https://');
    }
    if (!state.wwwOk) {
      line();
      console.log('  小提示：www.' + DOMAIN + ' 还打不开，不影响使用；');
      console.log('  想让它也能用，就去阿里云补一条 CNAME：主机记录 www，记录值 ' + GITHUB_PAGES);
    }
    line();
    return;
  }

  console.log('  网站暂时还打不开。你现在应该做的是：');
  line();

  if (!state.delegated) {
    console.log('  【等】域名还没在全球生效。这个只能等，一般几小时，最长 24 小时。什么都不用做。');
  } else if (!state.aRecords.length) {
    console.log('  【做】域名已生效，但还没添加解析记录。');
    console.log('       去阿里云加 5 条记录，步骤看「使用说明.md」第 5 步。');
  } else if (state.wrongIps.length) {
    console.log('  【改】A 记录填错了。');
    console.log('       ' + DOMAIN + ' 应该指向 185.199.108.153 ~ 185.199.111.153 这 4 个地址。');
  } else {
    console.log('  【查】解析没问题了，剩下的可能是 GitHub Pages 还没部署好：');
    console.log('       打开 https://github.com/shimangSB/xiaoruifan-blog/settings/pages');
    console.log('       确认 Source 是 Deploy from a branch，分支 main，文件夹 /docs，然后等 1~2 分钟。');
  }
  line();
}

async function main() {
  line();
  console.log('  ══════════════ 检查域名状态 ══════════════');
  console.log('  域名：' + DOMAIN);
  console.log('  时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));

  await stepDelegation();
  await stepApex();
  await stepWww();
  await stepSite();
  summary();
}

main().catch(function (e) {
  console.log('');
  console.log('  检查过程中出错了：' + e.message);
  console.log('');
});

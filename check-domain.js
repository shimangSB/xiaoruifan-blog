#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  域名检查器
 * ---------------------------------------------------------------------
 *  双击「检查域名.bat」运行。
 *  它会告诉你：域名生效了没有、解析填对了没有、网站能不能打开。
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

let blockers = 0;
let warnings = 0;

function good(t) { console.log('  [ 好 ] ' + t); }
function bad(t) { blockers++; console.log('  [ 差 ] ' + t); }
function warn(t) { warnings++; console.log('  [注意] ' + t); }
function info(t) { console.log('         ' + t); }

function line() { console.log(''); }

function checkUrl(url) {
  return new Promise(function (resolve) {
    const lib = url.indexOf('https') === 0 ? https : http;
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };

    const req = lib.get(url, { timeout: 15000 }, function (res) {
      const code = res.statusCode;
      if (code >= 200 && code < 400) {
        good(url + '  →  HTTP ' + code + '，能打开');
      } else {
        warn(url + '  →  HTTP ' + code + '（能连上，但返回了错误码）');
      }
      res.resume();
      finish();
    });

    req.on('timeout', function () { req.destroy(); warn(url + '  →  连接超时'); finish(); });
    req.on('error', function (e) {
      const code = e.code || '';
      if (code === 'ENOTFOUND') {
        info(url + '  →  域名还没生效，暂时打不开（正常，继续等）');
      } else if (/CERT|certificate|ALTNAME|SELF_SIGNED|VERIFY/i.test(code + ' ' + e.message)) {
        info(url + '  →  HTTPS 证书还没弄好（DNS 生效后 GitHub 会自动申请，等就行）');
      } else {
        info(url + '  →  ' + (code || e.message));
      }
      finish();
    });
  });
}

async function main() {
  line();
  console.log('  ══════════════ 检查域名状态 ══════════════');
  console.log('  域名：' + DOMAIN);
  console.log('  时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));

  /* ---------- 第 1 步 ---------- */
  line();
  console.log('  【第 1 步】域名在全球生效了吗？');
  try {
    const ns = await dnsP.resolveNs(DOMAIN);
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

  /* ---------- 第 2 步 ---------- */
  line();
  console.log('  【第 2 步】' + DOMAIN + ' 的解析记录填对了吗？');
  let aRecords = [];
  try { aRecords = await dnsP.resolve4(DOMAIN); } catch (e) { aRecords = []; }

  if (!aRecords.length) {
    warn('还没有查到 A 记录');
    info('如果你还没去阿里云添加解析，这是正常的；');
    info('如果已经添加了，说明还需要等一会儿才会生效。');
  } else {
    info('现在指向：' + aRecords.join('、'));
    const wrong = aRecords.filter(function (ip) { return GITHUB_IPS.indexOf(ip) === -1; });
    const missing = GITHUB_IPS.filter(function (ip) { return aRecords.indexOf(ip) === -1; });

    if (wrong.length) {
      bad('有 ' + wrong.length + ' 个地址不是 GitHub 的：' + wrong.join('、'));
      info('这些记录要删掉或改掉，否则网站打不开。');
    }
    if (missing.length) {
      warn('还缺 ' + missing.length + ' 条 A 记录：' + missing.join('、'));
      info('不影响使用，但建议补齐 4 条，访问会更稳。');
    }
    if (!wrong.length && !missing.length) {
      good('4 条 A 记录全部正确');
    }
  }

  /* ---------- 第 3 步 ---------- */
  line();
  console.log('  【第 3 步】' + WWW + ' 的记录');
  let cname = [];
  try { cname = await dnsP.resolveCname(WWW); } catch (e) { cname = []; }

  if (cname.length) {
    const cleaned = cname.map(function (c) { return String(c).replace(/\.$/, '').toLowerCase(); });
    if (cleaned.indexOf(GITHUB_PAGES) !== -1) {
      good('www 指向 ' + cname.join('、') + '，正确');
    } else {
      bad('www 指向 ' + cname.join('、') + '，应该是 ' + GITHUB_PAGES);
    }
  } else {
    let wwwIps = [];
    try { wwwIps = await dnsP.resolve4(WWW); } catch (e) { wwwIps = []; }
    if (wwwIps.length) {
      info('www 直接指向 ' + wwwIps.join('、') + '（也能用，不过标准做法是 CNAME 到 ' + GITHUB_PAGES + '）');
    } else {
      warn('www 还没有记录（不影响 xiaoruifan.xyz 本身，只是 www.xiaoruifan.xyz 打不开）');
    }
  }

  /* ---------- 第 4 步 ---------- */
  line();
  console.log('  【第 4 步】网站能打开吗？');
  await checkUrl('https://' + DOMAIN + '/');
  await checkUrl('https://' + WWW + '/');

  /* ---------- 总结 ---------- */
  line();
  console.log('  ══════════════ 结论 ══════════════');
  if (blockers === 0 && warnings === 0) {
    console.log('  🎉 全部就绪！打开 https://' + DOMAIN + ' 就能看到你的博客了。');
  } else if (blockers === 0) {
    console.log('  基本就绪，有 ' + warnings + ' 个小问题，看上面的「注意」。');
    console.log('  网站应该已经能打开了。');
  } else {
    console.log('  还有 ' + blockers + ' 个问题没解决，看上面的「差」。');
    console.log('');
    console.log('  最常见的情况是「域名还没生效」——这只需要等，不用操作。');
    console.log('  过几个小时再双击一次这个检查，就知道了。');
  }
  line();
}

main().catch(function (e) {
  console.log('');
  console.log('  检查过程中出错了：' + e.message);
  console.log('');
});

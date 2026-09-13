#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  一键发布
 * ---------------------------------------------------------------------
 *  做三件事：生成网站 → 把改动记录下来 → 上传到 GitHub。
 *  双击「发布到网上.bat」就会运行它。
 * ===================================================================== */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;

function step(n, text) {
  console.log('');
  console.log('  [' + n + '/3] ' + text);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) {
    console.log('      × 无法运行 ' + cmd + '：' + r.error.message);
    return false;
  }
  return r.status === 0;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout || '').trim() };
}

console.log('');
console.log('  ================= 发布到网上 =================');

// 先确认这是一个 git 仓库，并且已经设置好远程地址
const isRepo = capture('git', ['rev-parse', '--git-dir']).ok;
if (!isRepo) {
  console.log('');
  console.log('  [失败] 这个文件夹还不是 git 仓库。请把「使用说明.md」第 3 步重新做一遍。');
  console.log('');
  process.exit(1);
}

const remote = capture('git', ['remote', 'get-url', 'origin']);
if (!remote.ok) {
  console.log('');
  console.log('  [失败] 还没设置上传地址（origin）。请把「使用说明.md」第 3 步重新做一遍。');
  console.log('');
  process.exit(1);
}

// ---------- 1. 生成网站 ----------
step(1, '生成网站…');
if (!run(process.execPath, [path.join(ROOT, 'build.js')])) {
  console.log('');
  console.log('  [失败] 网站生成失败，请先解决上面的报错。');
  console.log('');
  process.exit(1);
}

// ---------- 2. 记录改动 ----------
step(2, '记录这次的改动…');
run('git', ['add', '-A']);

const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
const hasChanges = diff.status === 1;

if (hasChanges) {
  const msg = '更新博客 ' + new Date().toLocaleString('zh-CN', { hour12: false });
  if (!run('git', ['commit', '-m', msg])) {
    console.log('');
    console.log('  [失败] 记录改动失败。如果是第一次使用，可能需要先告诉 git 你的名字，见说明书。');
    console.log('');
    process.exit(1);
  }
} else {
  console.log('      内容没有变化，跳过这一步。');
}

// ---------- 3. 上传 ----------
step(3, '上传到 GitHub…');
console.log('      （第一次上传会弹出一个浏览器窗口要你登录 GitHub，登录一次以后就不用再登了）');
console.log('');

const upstream = capture('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
let pushed;
if (upstream.ok && upstream.out) {
  pushed = run('git', ['push']);
} else {
  pushed = run('git', ['push', '-u', 'origin', 'main']);
}

console.log('');
if (pushed) {
  console.log('  ================ 发布成功 ================');
  console.log('');
  console.log('  GitHub 需要一两分钟重新部署，等一会儿刷新你的网站就能看到新内容。');
  console.log('  网站地址：https://xiaoruifan.xyz');
  console.log('');
} else {
  console.log('  ================ 上传失败 ================');
  console.log('');
  console.log('  常见原因：');
  console.log('    1. GitHub 上还没有建仓库，或者仓库名字不是 blog');
  console.log('    2. 没有登录 GitHub，或者登录的账号不是 shimangSB');
  console.log('    3. 网络问题，过一会儿再试一次');
  console.log('');
  process.exit(1);
}

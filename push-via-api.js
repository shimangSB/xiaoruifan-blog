#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  备用上传通道（github.com 被墙时用这个）
 * ---------------------------------------------------------------------
 *  背景：国内经常连不上 github.com:443，git push 会直接失败。
 *        但 api.github.com 通常还能连上。
 *
 *  它怎么工作：
 *    1. 问 GitHub：远程现在有哪些文件、每个文件的内容编号是多少
 *    2. 问本地 git：本地现在有哪些文件、内容编号是多少
 *    3. 只把「不一样的文件」传上去，然后生成一个新提交
 *
 *  所以它不依赖提交历史，也不怕本地和远程的历史对不上，
 *  每次都是按文件内容精确同步，永远不会重复上传、也不会漏传。
 *
 *  正常你不需要直接运行它：
 *  双击「发布到网上.bat」时，如果 git push 失败会自动调用。
 * ===================================================================== */

const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const OWNER = 'shimangSB';
const REPO = 'xiaoruifan-blog';
const BRANCH = 'main';

/* ---------------------------- git 小工具 ---------------------------- */

function git(args, input) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false'].concat(args), {
    cwd: ROOT,
    encoding: 'utf8',
    input: input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

function gitOut(args) {
  return git(args).out.trim();
}

/* 从 git 数据库里读文件内容（不能读硬盘上的，因为 git 存的是转过换行符的版本） */
function readBlobFromHead(rev, file) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'cat-file', 'blob', rev + ':' + file], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) return null;
  return r.stdout;
}

function getToken() {
  const r = git(['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  const m = r.out.match(/^password=(.*)$/m);
  return m ? m[1].trim() : '';
}

/* ---------------------------- HTTP 请求 ---------------------------- */

function request(method, urlPath, body, token) {
  return new Promise(function (resolve, reject) {
    const data = body === undefined || body === null ? null : JSON.stringify(body);
    const headers = {
      'User-Agent': 'dsh-agent',
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request({ hostname: 'api.github.com', path: urlPath, method: method, headers: headers }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const msg = parsed && parsed.message ? parsed.message : String(raw).slice(0, 300);
          reject(new Error('HTTP ' + res.statusCode + ' — ' + msg));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, function () { req.destroy(new Error('请求超时')); });
    if (data) req.write(data);
    req.end();
  });
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  console.log('');
  console.log('  ---------- 备用通道：通过 GitHub 接口上传 ----------');

  const token = getToken();
  if (!token) throw new Error('拿不到 GitHub 登录令牌。请先双击「发布到网上.bat」登录一次 GitHub。');

  const api = '/repos/' + OWNER + '/' + REPO;

  /* ---- 1. 远程现在是什么样 ---- */
  let remoteSha = null;
  let remoteTreeSha = null;
  const remoteFiles = {};

  try {
    const ref = await request('GET', api + '/git/ref/heads/' + BRANCH, null, token);
    remoteSha = ref.object.sha;
    const rc = await request('GET', api + '/git/commits/' + remoteSha, null, token);
    remoteTreeSha = rc.tree.sha;
    const rt = await request('GET', api + '/git/trees/' + remoteTreeSha + '?recursive=1', null, token);
    (rt.tree || []).forEach(function (e) {
      if (e.type === 'blob') remoteFiles[e.path] = e.sha;
    });
    console.log('  远程 main：' + remoteSha.slice(0, 7) + '，共 ' + Object.keys(remoteFiles).length + ' 个文件');
  } catch (e) {
    console.log('  （远程还没有 ' + BRANCH + ' 分支，将全新创建）');
  }

  /* ---- 2. 本地现在是什么样 ---- */
  const localTreeSha = gitOut(['rev-parse', 'HEAD^{tree}']);
  if (remoteTreeSha && remoteTreeSha === localTreeSha) {
    console.log('  远程内容和本地完全一致，不需要上传 ✅');
    return;
  }

  const localFiles = {};
  gitOut(['ls-tree', '-r', 'HEAD']).split('\n').filter(Boolean).forEach(function (line) {
    const m = line.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t(.*)$/);
    if (m) localFiles[m[3]] = { mode: m[1], sha: m[2] };
  });
  console.log('  本地 HEAD：' + gitOut(['rev-parse', '--short', 'HEAD']) + '，共 ' + Object.keys(localFiles).length + ' 个文件');

  /* ---- 3. 找出差异 ---- */
  const entries = [];
  const toUpload = [];
  const toDelete = [];

  Object.keys(localFiles).forEach(function (p) {
    if (remoteFiles[p] !== localFiles[p].sha) toUpload.push(p);
  });
  Object.keys(remoteFiles).forEach(function (p) {
    if (!localFiles[p]) toDelete.push(p);
  });

  if (!toUpload.length && !toDelete.length) {
    console.log('  没有内容差异，不需要上传 ✅');
    return;
  }

  console.log('  需要更新 ' + toUpload.length + ' 个文件' +
    (toDelete.length ? '，删除 ' + toDelete.length + ' 个文件' : ''));

  for (const p of toUpload) {
    const buf = readBlobFromHead('HEAD', p);
    if (!buf) { console.log('    跳过（读不到内容）：' + p); continue; }
    const blob = await request('POST', api + '/git/blobs', {
      content: buf.toString('base64'),
      encoding: 'base64',
    }, token);
    entries.push({ path: p, mode: localFiles[p].mode, type: 'blob', sha: blob.sha });
    console.log('    ↑ ' + p);
  }

  toDelete.forEach(function (p) {
    entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
    console.log('    ✕ ' + p);
  });

  /* ---- 4. 生成新的文件树和提交 ---- */
  const treeBody = { tree: entries };
  if (remoteTreeSha) treeBody.base_tree = remoteTreeSha;
  const newTree = await request('POST', api + '/git/trees', treeBody, token);

  if (newTree.sha !== localTreeSha) {
    throw new Error('上传后的内容和本地对不上，已中止（没有改动远程）。请把「发布到网上.bat」的报错发给开发者。');
  }

  const message = gitOut(['log', '-1', '--pretty=%s']) ||
    ('更新博客 ' + new Date().toLocaleString('zh-CN', { hour12: false }));

  const newCommit = await request('POST', api + '/git/commits', {
    message: message,
    tree: newTree.sha,
    parents: remoteSha ? [remoteSha] : [],
  }, token);

  /* ---- 5. 移动分支指针 ---- */
  if (remoteSha) {
    await request('PATCH', api + '/git/refs/heads/' + BRANCH, { sha: newCommit.sha, force: false }, token);
  } else {
    await request('POST', api + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: newCommit.sha }, token);
  }

  console.log('');
  console.log('  [成功] 已通过接口上传，远程 main 现在是 ' + newCommit.sha.slice(0, 7));
  console.log('         内容已和本地完全一致 ✅');
  console.log('');
  console.log('  注意：因为走的是接口通道，远程的提交编号和本地不一样（内容完全相同）。');
  console.log('        这不影响使用，下次发布时会按文件内容自动比对，不会重复上传。');
}

if (require.main === module) {
  main().catch(function (e) {
    console.log('');
    console.log('  [失败] ' + e.message);
    console.log('');
    process.exit(1);
  });
}

module.exports = { main: main };

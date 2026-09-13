#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  新建文章的小助手
 * ---------------------------------------------------------------------
 *  双击「写新文章.bat」就会运行它：问你三个问题，
 *  然后自动在 posts 文件夹里建好一个写好的空文章，并用记事本打开。
 * ===================================================================== */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(function (resolve) {
    rl.question(q, function (a) { resolve(String(a == null ? '' : a).trim()); });
  });
}

function today() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

(async function () {
  console.log('');
  console.log('  ================= 写一篇新文章 =================');
  console.log('  直接输入内容，按回车确认。不想写了就按 Ctrl+C 退出。');
  console.log('');

  const title = await ask('  1/3  文章标题（必填）：');
  if (!title) {
    console.log('');
    console.log('  没填标题，这次先算了。');
    console.log('');
    rl.close();
    return;
  }

  const tags = await ask('  2/3  标签（可留空。多个标签用逗号隔开，例如：生活,随笔）：');
  const summary = await ask('  3/3  一句话摘要（可留空，系统会自动从正文里摘）：');

  const date = today();
  const safe = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/[. ]+$/, '')
    .trim() || '未命名';

  fs.mkdirSync(POSTS_DIR, { recursive: true });

  let file = path.join(POSTS_DIR, date + '-' + safe + '.md');
  let n = 2;
  while (fs.existsSync(file)) {
    file = path.join(POSTS_DIR, date + '-' + safe + '-' + n + '.md');
    n += 1;
  }

  const content = [
    '---',
    '标题: ' + title,
    '日期: ' + date,
    '标签: ' + tags,
    '摘要: ' + summary,
    '---',
    '',
    '从这里开始写正文。',
    '',
    '空一行表示另起一段。想加小标题，就在行首写两个井号加空格：',
    '',
    '## 这是小标题',
    '',
    '（上面这些说明文字，写的时候删掉就行。）',
    '',
  ].join('\n');

  fs.writeFileSync(file, content, 'utf8');

  console.log('');
  console.log('  [成功] 文章已建好： posts\\' + path.basename(file));
  console.log('');
  console.log('  现在正在用记事本打开它，写完按 Ctrl+S 保存，然后关掉记事本。');
  console.log('  回来双击「生成网站.bat」，网站就更新了。');
  console.log('');

  rl.close();

  try {
    spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    console.log('  （没能自动打开记事本，你可以自己到 posts 文件夹里打开刚才那个文件）');
    console.log('');
  }
})();

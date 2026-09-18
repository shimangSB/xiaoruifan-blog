#!/usr/bin/env node
'use strict';
/* =====================================================================
 *  博客生成器（你不需要看懂这个文件，也不用修改它）
 * ---------------------------------------------------------------------
 *  它做的事只有一件：
 *    把 posts 文件夹里的 .md 文章 + theme/style.css 的样式，
 *    生成一整套可以直接发布的网页，放进 docs 文件夹。
 *
 *  想改博客名字 / 副标题？请编辑旁边的「设置.txt」。
 *  想写新文章？请双击「写新文章.bat」。
 * ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const THEME_DIR = path.join(ROOT, 'theme');
const OUT_DIR = path.join(ROOT, 'docs');

/* ============================ 小工具 ============================ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeDate(input) {
  const m = String(input || '').match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (!m) return String(input || '').trim();
  return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
}

function isRealDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/* ==================== Markdown 转 HTML（简化版） ==================== */

function mdInline(text) {
  const codes = [];

  // 先保护行内代码 `xxx`，避免里面的符号被当成格式
  text = text.replace(/`([^`]+)`/g, function (m, c) {
    codes.push(c);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });

  // 图片 ![说明](地址)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (m, alt, src) {
    return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
  });

  // 链接 [文字](地址)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (m, t, href) {
    const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : '';
    return '<a href="' + href + '"' + ext + '>' + t + '</a>';
  });

  // 加粗、删除线、斜体
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // 还原行内代码
  text = text.replace(/\u0000C(\d+)\u0000/g, function (m, i) {
    return '<code>' + codes[+i] + '</code>';
  });

  return text;
}

function mdToHtml(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isBlank = (s) => /^\s*$/.test(s);
  const startBlock = (s) =>
    /^\s*```/.test(s) ||
    /^\s{0,3}#{1,6}\s+/.test(s) ||
    /^\s{0,3}>\s?/.test(s) ||
    /^\s*[-*+]\s+/.test(s) ||
    /^\s*\d+[.)]\s+/.test(s) ||
    /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(s);

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // ---- 代码块 ``` ----
    const fence = line.match(/^\s*```\s*([\w+#-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      i++;
      const buf = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' +
        esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // ---- 标题 # ## ### ----
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + mdInline(esc(h[2])) + '</h' + lv + '>');
      i++;
      continue;
    }

    // ---- 分割线 --- ----
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ---- 引用 > ----
    if (/^\s{0,3}>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // ---- 无序列表 - * + ----
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const parts = [lines[i].replace(/^\s*[-*+]\s+/, '')];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && !startBlock(lines[i])) {
          parts.push(lines[i].trim());
          i++;
        }
        items.push('<li>' + parts.map((t) => mdInline(esc(t))).join('<br>') + '</li>');
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }

    // ---- 有序列表 1. 2. ----
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const parts = [lines[i].replace(/^\s*\d+[.)]\s+/, '')];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && !startBlock(lines[i])) {
          parts.push(lines[i].trim());
          i++;
        }
        items.push('<li>' + parts.map((t) => mdInline(esc(t))).join('<br>') + '</li>');
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }

    // ---- 普通段落 ----
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !startBlock(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) {
      out.push('<p>' + buf.map((t) => mdInline(esc(t))).join('<br>') + '</p>');
    } else {
      i++; // 保险，避免卡死
    }
  }

  return out.join('\n');
}

/* 文章页在 posts 子文件夹里，所以正文里写的相对地址（比如 images/a.jpg）
   要补上 ../ 才能正确找到文件。 */
function fixRelative(html) {
  return String(html).replace(/(src|href)="(?!https?:|mailto:|tel:|#|\/|\.\.\/)([^"]*)"/g,
    function (m, attr, url) {
      return attr + '="../' + url + '"';
    });
}

/* ========================= 读取设置 ========================= */

function loadSettings() {
  const s = {
    博客名称: '我的博客',
    副标题: '',
    作者: '',
    域名: '',
    页脚: '',
  };
  const file = path.join(ROOT, '设置.txt');
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      const m = t.match(/^([^=＝]+)[=＝]([\s\S]*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (key in s) s[key] = m[2].trim();
    }
  }
  s.域名 = s.域名.replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/^www\./i, '');
  return s;
}

/* ========================= 读取文章 ========================= */

function parseMeta(block) {
  const meta = {};
  for (const raw of String(block).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^([^:：]+)[:：]([\s\S]*)$/);
    if (!m) continue;
    meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

function makeSummary(md) {
  const text = String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 90 ? text.slice(0, 90) + '……' : text;
}

function parsePost(file) {
  const full = path.join(POSTS_DIR, file);
  const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const slug = file.replace(/\.md$/i, '');

  let meta = {};
  let body = raw;
  const fm = raw.match(/^---\n([\s\S]*?)\n---[ \t]*\n?/);
  if (fm) {
    meta = parseMeta(fm[1]);
    body = raw.slice(fm[0].length);
  }

  // 日期：文章开头写的 > 文件名里的日期 > 文件最后修改时间
  let date = meta['日期'] || meta['date'] || '';
  if (!date) {
    const dm = slug.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (dm) date = dm[1] + '-' + dm[2] + '-' + dm[3];
  }
  if (!date) {
    date = new Date(fs.statSync(full).mtimeMs).toISOString().slice(0, 10);
  }
  date = normalizeDate(date);

  // 标题：文章开头写的 > 正文里的 # 标题 > 文件名
  let title = meta['标题'] || meta['title'] || '';
  const h1 = body.match(/^\s{0,3}#\s+(.+?)\s*$/m);
  if (!title) {
    title = h1 ? h1[1].trim() : slug.replace(/^\d{4}\D\d{1,2}\D\d{1,2}\D?/, '');
  }
  if (h1 && h1[1].trim() === title) {
    body = body.replace(h1[0], '');
  }

  const tags = String(meta['标签'] || meta['tags'] || '')
    .split(/[,，、;；\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const summary = (meta['摘要'] || meta['summary'] || '').trim() || makeSummary(body);

  return {
    slug,
    title,
    date,
    tags,
    summary,
    html: mdToHtml(body),
    url: 'posts/' + encodeURIComponent(slug) + '.html',
  };
}

function readPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const posts = fs.readdirSync(POSTS_DIR)
    .filter((f) => /\.md$/i.test(f) && !f.startsWith('.'))
    .map((f) => {
      try {
        return parsePost(f);
      } catch (e) {
        console.log('  [跳过] ' + f + ' 读取失败：' + e.message);
        return null;
      }
    })
    .filter(Boolean);

  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug, 'zh')));
  return posts;
}

/* ========================= 页面模板 ========================= */

function layout(settings, opt) {
  const base = opt.base || '';
  const siteTitle = esc(settings.博客名称);
  const pageTitle = opt.title ? esc(opt.title) + ' - ' + siteTitle : siteTitle;
  const desc = esc(opt.description || settings.副标题 || '');
  const canonical = settings.域名 && opt.path
    ? '<link rel="canonical" href="https://' + esc(settings.域名) + '/' + opt.path + '">\n'
    : '';
  const sub = settings.副标题 ? '<p class="site-sub">' + esc(settings.副标题) + '</p>' : '';
  const footerText = settings.页脚 ? '<p>' + esc(settings.页脚) + '</p>' : '';
  const year = new Date().getFullYear();
  const who = esc(settings.作者 || settings.博客名称);

  return '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + pageTitle + '</title>\n' +
    '<meta name="description" content="' + desc + '">\n' +
    canonical +
    '<link rel="stylesheet" href="' + base + 'style.css">\n' +
    '<link rel="alternate" type="application/rss+xml" title="' + siteTitle + '" href="' + base + 'feed.xml">\n' +
    '</head>\n<body>\n' +
    '<header class="site-header">\n  <div class="wrap">\n' +
    '    <a class="site-title" href="' + base + 'index.html">' + siteTitle + '</a>\n' +
    '    ' + sub + '\n' +
    '    <nav class="site-nav">' +
    '<a href="' + base + 'index.html">首页</a>' +
    '<a href="' + base + 'tags.html">标签</a>' +
    '<a href="' + base + 'about.html">关于</a>' +
    '<a href="' + base + 'feed.xml">订阅</a>' +
    '</nav>\n  </div>\n</header>\n' +
    '<main class="wrap">\n' + opt.content + '\n</main>\n' +
    '<footer class="site-footer">\n  <div class="wrap">\n' +
    '    <p>© ' + year + ' ' + who + '</p>\n' +
    '    ' + footerText + '\n' +
    '  </div>\n</footer>\n' +
    '</body>\n</html>\n';
}

function tagLinks(tags, base) {
  if (!tags || !tags.length) return '';
  return '<span class="tags">' + tags.map(function (t) {
    return '<a class="tag" href="' + base + 'tags.html#' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
  }).join('') + '</span>';
}

function renderIndex(settings, posts) {
  let content;
  if (!posts.length) {
    content = '<p class="empty">还没有文章。双击「写新文章.bat」开始写第一篇吧。</p>';
  } else {
    content = '<div class="post-list">\n' + posts.map(function (p) {
      return '  <article class="post-item">\n' +
        '    <time class="post-date" datetime="' + esc(p.date) + '">' + esc(p.date) + '</time>\n' +
        '    <h2 class="post-title"><a href="' + p.url + '">' + esc(p.title) + '</a></h2>\n' +
        (p.summary ? '    <p class="post-summary">' + esc(p.summary) + '</p>\n' : '') +
        (p.tags.length ? '    <p class="post-tags">' + tagLinks(p.tags, '') + '</p>\n' : '') +
        '  </article>';
    }).join('\n') + '\n</div>\n';
  }
  return layout(settings, { title: '', path: 'index.html', content: content });
}

function renderPost(settings, post, older, newer) {
  const base = '../';
  const head = '<article class="post">\n' +
    '  <header class="post-header">\n' +
    '    <h1 class="post-title">' + esc(post.title) + '</h1>\n' +
    '    <p class="post-meta"><time datetime="' + esc(post.date) + '">' + esc(post.date) + '</time>' +
    (post.tags.length ? ' · ' + tagLinks(post.tags, base) : '') + '</p>\n' +
    '  </header>\n' +
    '  <div class="post-body">\n' + fixRelative(post.html) + '\n  </div>\n' +
    '</article>\n';

  const navParts = [];
  if (newer) navParts.push('<a class="prev" href="' + encodeURIComponent(newer.slug) + '.html">← ' + esc(newer.title) + '</a>');
  if (older) navParts.push('<a class="next" href="' + encodeURIComponent(older.slug) + '.html">' + esc(older.title) + ' →</a>');
  const nav = navParts.length ? '<nav class="post-nav">' + navParts.join('') + '</nav>\n' : '';

  const back = '<p class="back-home"><a href="' + base + 'index.html">← 回到首页</a></p>\n';

  return layout(settings, {
    title: post.title,
    description: post.summary,
    base: base,
    path: post.url,
    content: head + nav + back,
  });
}

function renderTags(settings, posts) {
  const map = new Map();
  for (const p of posts) {
    for (const t of p.tags) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(p);
    }
  }
  const names = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'zh'));
  let content;
  if (!names.length) {
    content = '<h1>标签</h1>\n<p class="empty">还没有任何标签。在文章开头的「标签:」后面写上词，就会出现在这里。</p>';
  } else {
    content = '<h1>标签</h1>\n<p class="tag-cloud">' + names.map(function (t) {
      return '<a class="tag" href="#' + encodeURIComponent(t) + '">' + esc(t) + ' <span class="tag-count">' + map.get(t).length + '</span></a>';
    }).join('') + '</p>\n';
    content += names.map(function (t) {
      return '<section class="tag-section" id="' + esc(t) + '">\n  <h2>' + esc(t) + '</h2>\n  <ul class="plain-list">\n' +
        map.get(t).map(function (p) {
          return '    <li><time>' + esc(p.date) + '</time> <a href="' + p.url + '">' + esc(p.title) + '</a></li>';
        }).join('\n') + '\n  </ul>\n</section>';
    }).join('\n');
  }
  return layout(settings, { title: '标签', path: 'tags.html', content: content });
}

function renderAbout(settings, aboutHtml) {
  const content = '<article class="post">\n  <header class="post-header">\n    <h1 class="post-title">关于</h1>\n  </header>\n' +
    '  <div class="post-body">\n' + aboutHtml + '\n  </div>\n</article>\n';
  return layout(settings, { title: '关于', path: 'about.html', content: content });
}

function render404(settings) {
  const content = '<div class="not-found">\n  <h1>404</h1>\n  <p>这个页面不存在，可能是链接写错了。</p>\n' +
    '  <p><a href="/index.html">回到首页</a></p>\n</div>\n';
  return layout(settings, { title: '页面不存在', content: content });
}

/* ========================= 订阅与地图 ========================= */

function rssDate(date) {
  if (!isRealDate(date)) return new Date().toUTCString();
  const d = new Date(date + 'T08:00:00+08:00');
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function buildFeed(settings, posts) {
  const site = settings.域名 ? 'https://' + settings.域名 : '';
  const items = posts.slice(0, 20).map(function (p) {
    return '    <item>\n' +
      '      <title>' + esc(p.title) + '</title>\n' +
      '      <link>' + site + '/' + p.url + '</link>\n' +
      '      <guid isPermaLink="true">' + site + '/' + p.url + '</guid>\n' +
      '      <pubDate>' + rssDate(p.date) + '</pubDate>\n' +
      '      <description>' + esc(p.summary) + '</description>\n' +
      '    </item>';
  }).join('\n');

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n' +
    '    <title>' + esc(settings.博客名称) + '</title>\n' +
    '    <link>' + site + '/</link>\n' +
    '    <description>' + esc(settings.副标题) + '</description>\n' +
    '    <language>zh-CN</language>\n' +
    (site ? '    <atom:link href="' + site + '/feed.xml" rel="self" type="application/rss+xml"/>\n' : '') +
    items + '\n  </channel>\n</rss>\n';
}

function buildSitemap(settings, posts) {
  const site = settings.域名 ? 'https://' + settings.域名 : '';
  const urls = [
    { loc: site + '/index.html', lastmod: posts.length ? posts[0].date : '' },
    { loc: site + '/about.html', lastmod: '' },
    { loc: site + '/tags.html', lastmod: '' },
  ].concat(posts.map((p) => ({ loc: site + '/' + p.url, lastmod: p.date })));

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(function (u) {
      return '  <url>\n    <loc>' + esc(u.loc) + '</loc>\n' +
        (isRealDate(u.lastmod) ? '    <lastmod>' + u.lastmod + '</lastmod>\n' : '') +
        '  </url>';
    }).join('\n') + '\n</urlset>\n';
}

/* ============================ 主流程 ============================ */

function prepareOut() {
  if (path.resolve(OUT_DIR) === path.resolve(ROOT)) {
    throw new Error('输出目录不能和项目根目录相同');
  }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'posts'), { recursive: true });
}

function write(rel, content) {
  const full = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function main() {
  const settings = loadSettings();
  const posts = readPosts();

  prepareOut();

  const cssPath = path.join(THEME_DIR, 'style.css');
  write('style.css', fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '');

  // 把 images 文件夹里的图片一起复制过去
  const imgDir = path.join(ROOT, 'images');
  if (fs.existsSync(imgDir)) {
    fs.cpSync(imgDir, path.join(OUT_DIR, 'images'), { recursive: true });
  }

  write('index.html', renderIndex(settings, posts));

  posts.forEach(function (p, idx) {
    write('posts/' + p.slug + '.html', renderPost(settings, p, posts[idx + 1] || null, posts[idx - 1] || null));
  });

  write('tags.html', renderTags(settings, posts));

  const aboutFile = path.join(ROOT, 'about.md');
  const aboutHtml = fs.existsSync(aboutFile)
    ? mdToHtml(fs.readFileSync(aboutFile, 'utf8').replace(/^\uFEFF/, ''))
    : '<p>还没有写自我介绍。打开项目里的 about.md 就能写。</p>';
  write('about.html', renderAbout(settings, aboutHtml));

  write('404.html', render404(settings));
  write('feed.xml', buildFeed(settings, posts));
  write('sitemap.xml', buildSitemap(settings, posts));
  write('robots.txt', 'User-agent: *\nAllow: /\n' + (settings.域名 ? 'Sitemap: https://' + settings.域名 + '/sitemap.xml\n' : ''));
  write('.nojekyll', '');
  // 注意：CNAME 文件不要加末尾换行，否则和 GitHub 自己生成的不一致，每次发布都会冲突
  if (settings.域名) write('CNAME', settings.域名);

  console.log('');
  console.log('  博客名称：' + settings.博客名称);
  console.log('  域名    ：' + (settings.域名 || '（还没填，请在 设置.txt 里填上）'));
  console.log('  文章数量：' + posts.length + ' 篇');
  if (posts.length) {
    console.log('  最新文章：' + posts[0].title + '（' + posts[0].date + '）');
  }
  console.log('');
  console.log('  --------------------------------------------------');
  console.log('  [成功] 网站已生成到 docs 文件夹。');
  console.log('');
  console.log('  想在电脑上先看看效果 -> 双击「预览网站.bat」');
  console.log('  想发布到网上给别人看 -> 打开「使用说明.md」，看第 3 步');
  console.log('  --------------------------------------------------');
  console.log('');
}

try {
  main();
} catch (e) {
  console.log('');
  console.log('  [出错了] ' + e.message);
  console.log('');
  process.exit(1);
}

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-admin-key';
const SITE_NAME = process.env.SITE_NAME || 'Verns Safelink';
const DEFAULT_TIMER = Number(process.env.DEFAULT_TIMER || 10);
const MAX_TIMER = Number(process.env.MAX_TIMER || 180);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'links';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const DATA_FILE = path.join(__dirname, 'data', 'links.json');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readLocalLinks() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalLinks(links) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), 'utf8');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUrl(value = '') {
  const raw = String(value || '').trim();
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function makeSlug(text = '') {
  const cleaned = text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || crypto.randomBytes(4).toString('hex');
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function extractYoutubeVideoId(url = '') {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.replace('/', '').split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embedMatch) return embedMatch[1];
  } catch {}
  return '';
}

function getYoutubeThumbnail(videoUrl = '') {
  const videoId = extractYoutubeVideoId(videoUrl);
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';
}

function getCommentUrl(videoUrl = '') {
  const videoId = extractYoutubeVideoId(videoUrl);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=comments` : videoUrl;
}

function siteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function adminUrl(req) {
  return `${siteOrigin(req)}/admin?key=${encodeURIComponent(ADMIN_KEY)}`;
}

function toClient(row = {}) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url ?? row.videoUrl,
    channelUrl: row.channel_url ?? row.channelUrl,
    destinationUrl: row.destination_url ?? row.destinationUrl,
    theme: row.theme || 'violet',
    requiredSubscribe: Boolean(row.required_subscribe ?? row.requiredSubscribe),
    requiredLike: Boolean(row.required_like ?? row.requiredLike),
    requiredComment: Boolean(row.required_comment ?? row.requiredComment),
    timerSeconds: Number(row.timer_seconds ?? row.timerSeconds ?? DEFAULT_TIMER),
    clicks: Number(row.clicks || 0),
    unlocks: Number(row.unlocks || 0),
    active: Boolean(row.active),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    lastClickAt: row.last_click_at ?? row.lastClickAt,
    lastUnlockAt: row.last_unlock_at ?? row.lastUnlockAt
  };
}

function toDb(link = {}) {
  return {
    slug: link.slug,
    title: link.title,
    description: link.description,
    video_url: link.videoUrl,
    channel_url: link.channelUrl,
    destination_url: link.destinationUrl,
    theme: link.theme,
    required_subscribe: link.requiredSubscribe,
    required_like: link.requiredLike,
    required_comment: link.requiredComment,
    timer_seconds: link.timerSeconds,
    clicks: Number(link.clicks || 0),
    unlocks: Number(link.unlocks || 0),
    active: Boolean(link.active)
  };
}

async function supabaseFetch(pathname, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function listLinks() {
  if (!USE_SUPABASE) return readLocalLinks().map(toClient);
  const rows = await supabaseFetch(`${SUPABASE_TABLE}?select=*&order=created_at.desc`);
  return (rows || []).map(toClient);
}

async function findLinkBySlug(slug) {
  if (!USE_SUPABASE) return readLocalLinks().map(toClient).find((item) => item.slug === slug) || null;
  const rows = await supabaseFetch(`${SUPABASE_TABLE}?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  return rows && rows[0] ? toClient(rows[0]) : null;
}

async function createLink(link) {
  if (!USE_SUPABASE) {
    const links = readLocalLinks();
    links.push({
      id: crypto.randomUUID(),
      ...link,
      video_url: undefined,
      channel_url: undefined,
      destination_url: undefined,
      required_subscribe: undefined,
      required_like: undefined,
      required_comment: undefined,
      timer_seconds: undefined,
      active: true,
      clicks: 0,
      unlocks: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    saveLocalLinks(links);
    return link;
  }
  const rows = await supabaseFetch(SUPABASE_TABLE, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(toDb({ ...link, active: true, clicks: 0, unlocks: 0 }))
  });
  return toClient(rows[0]);
}

async function updateLink(slug, patch) {
  if (!USE_SUPABASE) {
    const links = readLocalLinks();
    const idx = links.findIndex((item) => item.slug === slug);
    if (idx === -1) return null;
    links[idx] = { ...links[idx], ...patch, updatedAt: new Date().toISOString() };
    saveLocalLinks(links);
    return toClient(links[idx]);
  }
  const dbPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    const map = {
      videoUrl: 'video_url', channelUrl: 'channel_url', destinationUrl: 'destination_url',
      requiredSubscribe: 'required_subscribe', requiredLike: 'required_like', requiredComment: 'required_comment',
      timerSeconds: 'timer_seconds', lastClickAt: 'last_click_at', lastUnlockAt: 'last_unlock_at'
    };
    dbPatch[map[key] || key] = value;
  }
  const rows = await supabaseFetch(`${SUPABASE_TABLE}?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(dbPatch)
  });
  return rows && rows[0] ? toClient(rows[0]) : null;
}

async function deleteLink(slug) {
  if (!USE_SUPABASE) {
    const links = readLocalLinks().filter((item) => item.slug !== slug);
    saveLocalLinks(links);
    return true;
  }
  await supabaseFetch(`${SUPABASE_TABLE}?slug=eq.${encodeURIComponent(slug)}`, { method: 'DELETE' });
  return true;
}

async function uniqueSlug(base) {
  let slug = makeSlug(base);
  const originalSlug = slug;
  let counter = 2;
  while (await findLinkBySlug(slug)) {
    slug = `${originalSlug}-${counter++}`;
  }
  return slug;
}

function pageShell(title, body, extraScript = '') {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}</title>
  <meta name="description" content="Premium animated YouTube safelink with Supabase database." />
  <link rel="preconnect" href="https://img.youtube.com" />
  <link rel="stylesheet" href="/public/style.css" />
</head>
<body>
  <div class="noise-layer"></div>
  <div class="grid-layer"></div>
  <div class="bg-orb orb-one"></div>
  <div class="bg-orb orb-two"></div>
  <div class="bg-orb orb-three"></div>
  <main class="app-shell">
    ${body}
  </main>
  <footer class="site-footer">Copyright by Verns. All rights reserved © 2026.</footer>
  <script src="/public/common.js"></script>
  ${extraScript}
</body>
</html>`;
}

function statCards(links) {
  const totalLinks = links.length;
  const activeLinks = links.filter((item) => item.active).length;
  const totalClicks = links.reduce((sum, item) => sum + Number(item.clicks || 0), 0);
  const totalUnlocks = links.reduce((sum, item) => sum + Number(item.unlocks || 0), 0);

  return `
    <div class="stats-grid">
      <div class="stat-card"><span>Total Links</span><strong>${totalLinks}</strong></div>
      <div class="stat-card"><span>Active</span><strong>${activeLinks}</strong></div>
      <div class="stat-card"><span>Clicks</span><strong>${totalClicks}</strong></div>
      <div class="stat-card"><span>Unlocks</span><strong>${totalUnlocks}</strong></div>
    </div>
  `;
}

function themeOptions(selected = 'violet') {
  const options = [
    ['violet', 'Violet / Cyber'],
    ['emerald', 'Emerald / Hacker'],
    ['crimson', 'Crimson / Dark'],
    ['gold', 'Gold / Premium'],
    ['ice', 'Ice / Blue'],
    ['mono', 'Mono / Clean']
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

app.get('/', async (req, res) => {
  try {
    const links = (await listLinks()).filter((item) => item.active).slice(0, 6);
    const cards = links.map((link) => `
      <a class="mini-card click-anim" href="/go/${encodeURIComponent(link.slug)}">
        <span>${escapeHtml(link.title)}</span>
        <small>/go/${escapeHtml(link.slug)}</small>
      </a>
    `).join('');

    res.send(pageShell('Home', `
      <section class="hero-card reveal-card">
        <p class="eyebrow">YouTube Link Locker v3</p>
        <h1>${escapeHtml(SITE_NAME)}</h1>
        <p class="muted">Safelink dengan database Supabase, checkpoint subscribe/like/comment, timer, animasi klik, dan dashboard admin.</p>
        <div class="hero-actions">
          <a class="btn primary click-anim" href="${escapeHtml(adminUrl(req))}">Open Admin</a>
          <a class="btn ghost click-anim" href="/go/demo">Try Demo</a>
        </div>
        <div class="feature-row">
          <span>${USE_SUPABASE ? 'Supabase DB' : 'Local JSON Mode'}</span>
          <span>Animated UI</span>
          <span>Hosting Ready</span>
          <span>Click Stats</span>
        </div>
        <div class="recent-grid">${cards || '<p class="muted">Belum ada link aktif.</p>'}</div>
      </section>
    `));
  } catch (error) {
    res.status(500).send(pageShell('Error', errorBox(error)));
  }
});

app.get('/admin', async (req, res) => {
  try {
    const adminKey = String(req.query.key || '');
    const allowed = adminKey === ADMIN_KEY;
    const created = String(req.query.created || '');
    const links = (await listLinks()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const origin = siteOrigin(req);

    const rows = links.map((link) => {
      const publicUrl = `${origin}/go/${encodeURIComponent(link.slug)}`;
      return `
        <tr>
          <td>
            <strong>${escapeHtml(link.title)}</strong><br>
            <small>${escapeHtml(publicUrl)}</small>
          </td>
          <td>${Number(link.clicks || 0)}</td>
          <td>${Number(link.unlocks || 0)}</td>
          <td><span class="status ${link.active ? 'on' : 'off'}">${link.active ? 'Active' : 'Off'}</span></td>
          <td>
            <div class="table-actions">
              <a class="mini-btn click-anim" href="/go/${encodeURIComponent(link.slug)}" target="_blank" rel="noopener">Open</a>
              <button class="mini-btn copy-btn click-anim" type="button" data-copy="${escapeHtml(publicUrl)}">Copy</button>
              ${allowed ? `
                <form method="post" action="/api/links/${encodeURIComponent(link.slug)}/toggle" class="inline-form">
                  <input type="hidden" name="adminKey" value="${escapeHtml(adminKey)}" />
                  <button class="mini-btn click-anim" type="submit">${link.active ? 'Disable' : 'Enable'}</button>
                </form>
                <form method="post" action="/api/links/${encodeURIComponent(link.slug)}/delete" class="inline-form" onsubmit="return confirm('Hapus link ini?')">
                  <input type="hidden" name="adminKey" value="${escapeHtml(adminKey)}" />
                  <button class="mini-btn danger click-anim" type="submit">Delete</button>
                </form>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    res.send(pageShell('Admin', `
      <section class="admin-layout reveal-card">
        <div class="admin-head">
          <div>
            <p class="eyebrow">Admin Dashboard</p>
            <h1>Create Safelink</h1>
            <p class="muted">Mode database: <b>${USE_SUPABASE ? 'Supabase Online' : 'Local JSON fallback'}</b></p>
          </div>
          <a class="btn ghost click-anim" href="/">Home</a>
        </div>

        ${statCards(links)}

        ${created ? `<div class="notice success">Link berhasil dibuat: <a href="/go/${encodeURIComponent(created)}" target="_blank" rel="noopener">/go/${escapeHtml(created)}</a></div>` : ''}
        ${!USE_SUPABASE ? `<div class="notice warning">Supabase belum diisi di .env. Sekarang masih local fallback. Untuk hosting, isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.</div>` : ''}

        <div class="admin-grid">
          <div class="panel">
            <h2>New Link</h2>
            ${allowed ? `
              <form class="form" method="post" action="/api/links">
                <input type="hidden" name="adminKey" value="${escapeHtml(adminKey)}" />

                <label>Judul video / title</label>
                <input name="title" placeholder="Contoh: Subscribe dulu biar link kebuka" required />

                <label>Deskripsi kecil</label>
                <input name="description" placeholder="Contoh: Complete all steps to unlock" />

                <label>Custom slug</label>
                <input name="slug" placeholder="contoh: script-v1" />

                <label>Link video YouTube</label>
                <input name="videoUrl" placeholder="https://www.youtube.com/watch?v=..." required />

                <label>Link channel / subscribe</label>
                <input name="channelUrl" placeholder="https://www.youtube.com/@channel" required />

                <label>Link tujuan akhir</label>
                <input name="destinationUrl" placeholder="https://example.com/file" required />

                <div class="form-row">
                  <div>
                    <label>Timer detik</label>
                    <input name="timerSeconds" type="number" min="0" max="${MAX_TIMER}" value="${DEFAULT_TIMER}" />
                  </div>
                  <div>
                    <label>Theme</label>
                    <select name="theme">${themeOptions('violet')}</select>
                  </div>
                </div>

                <div class="check-grid">
                  <label><input type="checkbox" name="requiredSubscribe" checked /> Subscribe</label>
                  <label><input type="checkbox" name="requiredLike" checked /> Like</label>
                  <label><input type="checkbox" name="requiredComment" checked /> Comment</label>
                </div>

                <button class="btn primary full click-anim" type="submit">Create Link</button>
              </form>
            ` : `<div class="notice danger">Admin key belum benar. Edit URL jadi <code>/admin?key=ISI_ADMIN_KEY</code>.</div>`}
          </div>

          <div class="panel wide-table">
            <div class="panel-top">
              <div>
                <p class="eyebrow">Links</p>
                <h2>Created Links</h2>
              </div>
            </div>
            <table>
              <thead><tr><th>Link</th><th>Clicks</th><th>Unlocks</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">Belum ada link.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </section>
    `, `<script src="/public/admin.js"></script>`));
  } catch (error) {
    res.status(500).send(pageShell('Error', errorBox(error)));
  }
});

app.post('/api/links', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.adminKey !== ADMIN_KEY) return res.status(403).send('Admin key salah.');

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim() || 'Complete the steps below to unlock your link.';
    const videoUrl = safeUrl(body.videoUrl);
    const channelUrl = safeUrl(body.channelUrl);
    const destinationUrl = safeUrl(body.destinationUrl);
    const theme = ['violet', 'emerald', 'crimson', 'gold', 'ice', 'mono'].includes(body.theme) ? body.theme : 'violet';

    if (!title || !videoUrl || !channelUrl || !destinationUrl) {
      return res.status(400).send('Title, videoUrl, channelUrl, dan destinationUrl wajib diisi dengan URL valid.');
    }

    const slug = await uniqueSlug(body.slug || title);
    const timerSeconds = clampNumber(body.timerSeconds, 0, MAX_TIMER, DEFAULT_TIMER);

    await createLink({
      slug,
      title,
      description,
      videoUrl,
      channelUrl,
      destinationUrl,
      theme,
      requiredSubscribe: body.requiredSubscribe === 'on',
      requiredLike: body.requiredLike === 'on',
      requiredComment: body.requiredComment === 'on',
      timerSeconds
    });

    res.redirect(`/admin?key=${encodeURIComponent(ADMIN_KEY)}&created=${encodeURIComponent(slug)}`);
  } catch (error) {
    res.status(500).send(`Gagal bikin link: ${escapeHtml(error.message)}`);
  }
});

app.post('/api/links/:slug/toggle', async (req, res) => {
  try {
    if ((req.body || {}).adminKey !== ADMIN_KEY) return res.status(403).send('Admin key salah.');
    const link = await findLinkBySlug(req.params.slug);
    if (!link) return res.status(404).send('Link tidak ditemukan.');
    await updateLink(req.params.slug, { active: !link.active });
    res.redirect(`/admin?key=${encodeURIComponent(ADMIN_KEY)}`);
  } catch (error) {
    res.status(500).send(`Gagal update link: ${escapeHtml(error.message)}`);
  }
});

app.post('/api/links/:slug/delete', async (req, res) => {
  try {
    if ((req.body || {}).adminKey !== ADMIN_KEY) return res.status(403).send('Admin key salah.');
    await deleteLink(req.params.slug);
    res.redirect(`/admin?key=${encodeURIComponent(ADMIN_KEY)}`);
  } catch (error) {
    res.status(500).send(`Gagal hapus link: ${escapeHtml(error.message)}`);
  }
});

app.get('/go/:slug', async (req, res) => {
  try {
    const link = await findLinkBySlug(req.params.slug);

    if (!link || !link.active) {
      return res.status(404).send(pageShell('Not Found', `
        <section class="hero-card small reveal-card">
          <p class="eyebrow">404</p>
          <h1>Link tidak ditemukan</h1>
          <p class="muted">Slug ini tidak ada atau sudah dinonaktifkan.</p>
          <a class="btn primary click-anim" href="/">Back Home</a>
        </section>
      `));
    }

    await updateLink(link.slug, {
      clicks: Number(link.clicks || 0) + 1,
      lastClickAt: new Date().toISOString()
    });

    const thumbnail = getYoutubeThumbnail(link.videoUrl);
    const tasks = [
      link.requiredSubscribe ? `<button class="task-btn click-anim" data-task="subscribe" data-url="${escapeHtml(link.channelUrl)}"><span class="task-icon">▶</span><span><strong>Subscribe Channel</strong><small>Open channel and subscribe</small></span></button>` : '',
      link.requiredLike ? `<button class="task-btn click-anim" data-task="like" data-url="${escapeHtml(link.videoUrl)}"><span class="task-icon">♥</span><span><strong>Like Video</strong><small>Open video and hit like</small></span></button>` : '',
      link.requiredComment ? `<button class="task-btn click-anim" data-task="comment" data-url="${escapeHtml(getCommentUrl(link.videoUrl))}"><span class="task-icon">✦</span><span><strong>Comment Video</strong><small>Leave a quick comment</small></span></button>` : ''
    ].filter(Boolean).join('');

    res.send(pageShell(link.title, `
      <section class="gate-card reveal-card theme-${escapeHtml(link.theme || 'violet')}" data-slug="${escapeHtml(link.slug)}" data-timer="${Number(link.timerSeconds || 0)}">
        <div class="top-line">
          <span class="pill pulse-dot">Unlock Link</span>
          <span class="pill ghost-pill">${Number(link.timerSeconds || 0)}s timer</span>
        </div>

        <div class="thumb-wrap shine-card">
          ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="Video thumbnail" onerror="this.src='/public/fallback.svg'" />` : `<img src="/public/fallback.svg" alt="Video thumbnail" />`}
          <a class="play-link click-anim" href="${escapeHtml(link.videoUrl)}" target="_blank" rel="noopener">▶ Watch</a>
        </div>

        <h1>${escapeHtml(link.title)}</h1>
        <p class="muted">${escapeHtml(link.description || 'Selesaikan step di bawah. Setelah semua selesai, tombol unlock akan aktif.')}</p>

        <div class="progress-area">
          <div class="progress-text"><span id="progressText">0 task completed</span><span id="timerText">Timer ready</span></div>
          <div class="progress-bar"><div id="progressFill"></div></div>
        </div>

        <div class="task-list">
          ${tasks || '<p class="muted">Tidak ada task, tinggal tunggu timer.</p>'}
        </div>

        <button id="unlockBtn" class="btn primary full locked click-anim" disabled>Complete Steps First</button>
        <button id="copyPageBtn" class="btn ghost full soft-gap click-anim" type="button">Copy This Page Link</button>
        <p class="tiny-note">Note: versi simpel hanya mengecek klik tombol, bukan validasi subscribe/like asli.</p>
      </section>

      <div id="toast" class="toast" role="status"></div>
      <canvas id="confettiCanvas" class="confetti-canvas"></canvas>
      <div id="redirectOverlay" class="redirect-overlay hidden">
        <div class="redirect-box">
          <div class="loader-ring"></div>
          <h2>Redirecting...</h2>
          <p class="muted">Link terbuka sebentar lagi.</p>
        </div>
      </div>
    `, `<script src="/public/gate.js"></script>`));
  } catch (error) {
    res.status(500).send(pageShell('Error', errorBox(error)));
  }
});

app.post('/api/unlock/:slug', async (req, res) => {
  try {
    const link = await findLinkBySlug(req.params.slug);
    if (!link || !link.active) return res.status(404).json({ error: 'Link not found.' });

    await updateLink(link.slug, {
      unlocks: Number(link.unlocks || 0) + 1,
      lastUnlockAt: new Date().toISOString()
    });

    res.json({ destinationUrl: link.destinationUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    site: SITE_NAME,
    dbMode: USE_SUPABASE ? 'supabase' : 'local-json',
    time: new Date().toISOString()
  });
});

function errorBox(error) {
  return `
    <section class="hero-card small reveal-card">
      <p class="eyebrow">Server Error</p>
      <h1>Ada error</h1>
      <p class="muted">${escapeHtml(error.message || 'Unknown error')}</p>
      <a class="btn primary click-anim" href="/">Back Home</a>
    </section>
  `;
}

app.listen(PORT, () => {
  console.log(`✅ ${SITE_NAME} v3 running on http://localhost:${PORT}`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
  console.log(`🗄️ Database mode: ${USE_SUPABASE ? 'Supabase' : 'Local JSON fallback'}`);
});

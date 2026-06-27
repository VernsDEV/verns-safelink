# Safelink YouTube Locker v3

Project ini versi **hosting-ready** dari safelink YouTube locker.

Stack:
- Node.js
- Express.js
- Supabase Database
- HTML / CSS / JavaScript frontend

Fitur:
- Admin dashboard
- Create shortlink `/go/slug`
- Database Supabase online
- Local JSON fallback untuk testing
- Thumbnail YouTube otomatis
- Subscribe / Like / Comment gate
- Timer unlock
- Copy link
- Click counter dan unlock counter
- Animasi klik ripple
- Confetti saat unlock
- Footer: `Copyright by Verns. All rights reserved © 2026.`

## 1. Local test cepat

```bat
npm install
copy .env.example .env
npm start
```

Buka:

```txt
http://localhost:3000
```

Admin:

```txt
http://localhost:3000/admin?key=change-this-admin-key
```

Kalau `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` masih kosong, project otomatis pakai database lokal:

```txt
data/links.json
```

## 2. Setup Supabase

1. Buka Supabase.
2. Buat project baru.
3. Buka SQL Editor.
4. Paste isi file:

```txt
supabase-schema.sql
```

5. Run SQL.
6. Ambil:

```txt
Project URL
Service Role Key
```

7. Masukkan ke `.env`:

```env
SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ISI_SERVICE_ROLE_KEY_KAMU
SUPABASE_TABLE=links
```

PENTING: jangan pernah taruh `SUPABASE_SERVICE_ROLE_KEY` di frontend/public file.

## 3. Yang harus kamu edit

File utama yang aman diedit:

```txt
.env
```

Isi yang perlu diubah:

```env
ADMIN_KEY=isi-password-admin-kamu
SITE_NAME=Verns Safelink
DEFAULT_TIMER=10
MAX_TIMER=180
SUPABASE_URL=isi-url-supabase
SUPABASE_SERVICE_ROLE_KEY=isi-service-role-key
```

Untuk edit tampilan:

```txt
public/style.css
```

Footer ada di:

```txt
server.js
```

Cari teks:

```txt
Copyright by Verns. All rights reserved © 2026.
```

Logic gate ada di:

```txt
public/gate.js
```

Animasi klik ripple ada di:

```txt
public/common.js
```

## 4. Hosting

Cocok deploy ke Render atau Railway karena project ini Express server biasa.

Build command:

```txt
npm install
```

Start command:

```txt
npm start
```

Environment variables di hosting:

```env
PORT=3000
ADMIN_KEY=isi-password-admin-kamu
SITE_NAME=Verns Safelink
DEFAULT_TIMER=10
MAX_TIMER=180
SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=isi-service-role-key
SUPABASE_TABLE=links
```

## 5. Catatan

Versi simpel ini hanya mengecek user sudah klik tombol, bukan validasi asli subscribe/like/comment dari YouTube.
Untuk validasi asli, harus pakai Google OAuth + YouTube API.

// RAZZ FETCH RELAY — chhota sa download relay (2026-11-07).
// Kaam: /fetch?v=<youtubeId>&k=<key> par gaane ki .m4a file lautana.
// BotFather ka apna server (Render) YouTube ke paas IP-band hai — ye relay
// DUSRE region se chalta hai, isliye iska rasta saaf milta hai.
// /health bina key ke; /fetch ke liye RELAY_KEY env lazmi hai.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ffmpegStatic from 'ffmpeg-static';

const run = promisify(execFile);
const KEY = process.env.RELAY_KEY || '';
const PORT = process.env.PORT || 10000;
const FFMPEG = ffmpegStatic || 'ffmpeg';
const BIN = path.join(os.tmpdir(), 'yt-dlp');
let binReady = null;

async function ensureBin() {
  if (!binReady) {
    binReady = (async () => {
      if (!fs.existsSync(BIN)) {
        const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', { redirect: 'follow' });
        if (!res.ok) throw new Error('bin_fetch_' + res.status);
        fs.writeFileSync(BIN, Buffer.from(await res.arrayBuffer()));
        fs.chmodSync(BIN, 0o755);
      }
      const v = await run(BIN, ['--version'], { timeout: 15_000 });
      console.log('[relay] yt-dlp', v.stdout.trim());
    })().catch((e) => { binReady = null; throw e; });
  }
  return binReady;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"service":"razz-fetch-relay"}');
    return;
  }
  if (u.pathname !== '/fetch') { res.writeHead(404); res.end(); return; }
  if (!KEY || u.searchParams.get('k') !== KEY) { res.writeHead(403); res.end(); return; }
  const vid = (u.searchParams.get('v') || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(vid)) { res.writeHead(400); res.end(); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
  try {
    await ensureBin();
    const src = path.join(dir, 'src.mp4');
    const out = path.join(dir, 'out.m4a');
    await run(BIN, ['--no-warnings', '-4', '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=android',
      '-f', '18/best[height<=360]/best', '-o', src,
      `https://www.youtube.com/watch?v=${vid}`],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    await run(FFMPEG, ['-y', '-i', src, '-vn', '-c:a', 'copy', out],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const data = fs.readFileSync(out);
    if (data.length > 16 * 1024 * 1024) { res.writeHead(413); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': data.length });
    res.end(data);
    console.log('[relay] served', vid, data.length);
  } catch (e) {
    console.error('[relay] fail', vid, String(e?.stderr || e?.message || '').slice(0, 300));
    if (!res.headersSent) res.writeHead(502);
    res.end();
  } finally {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
  }
});
server.listen(PORT, () => console.log('[relay] listening on', PORT));
ensureBin().catch(() => {});

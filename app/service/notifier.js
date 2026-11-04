// Background service: shows Claude/Codex pop-ups as the TV's own notification banner, over
// whatever app is in front (YouTube etc.). The Mac relay POSTs here when SamSUCKED isn't on screen.
//   POST :8099/notify  {"title": "...", "message": "...", "timeout": 8}
//   GET  :8099/health
// Text only (the TV's banner can't show images). ponytail: no auth, LAN-only like the TV's own :8001 API.
var http = require('http');
var server = null;

function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

function start() {
  if (server) return;
  server = http.createServer(function (req, res) {
    if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
    if (req.method !== 'POST' || req.url !== '/notify') { res.statusCode = 404; res.end(); return; }
    var body = '';
    req.on('data', function (c) { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', function () {
      try {
        var d = JSON.parse(body);
        var t = Math.max(3, Math.min(30, Number(d.timeout) || 8));
        webapis.postPlainNotification(clip(d.title, 60) || 'SamSUCKED', clip(d.message, 160), t);
        res.end('{"ok":true}');
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });
  server.listen(8099, '0.0.0.0');
}

module.exports.onStart = start;
module.exports.onRequest = start;
module.exports.onExit = function () { if (server) server.close(); server = null; };

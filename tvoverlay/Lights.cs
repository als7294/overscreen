// Home hub, part 1: local control of Aaron's Tuya bulbs over the LAN (TCP 6668), no cloud.
// Port of tinytuya / HomeCam's Tuya.swift, protocol 3.5 only.
// shortcut: 3.5 only (every bulb on the LAN is 3.5 today); add 3.3/3.4 framing if a plug on an older protocol joins.
//
// HTTP API (port 18111, LAN):
//   GET  /lights                          -> [{name, room, on, mode, brightness, temp, error?}]
//   POST /lights?target=bedroom&on=1&b=30&t=0&c=ff0000   (target: all | room | part of a name)
//   POST /scene/all-off|bright|movie|night
//   GET  /health                          -> "ok"
// Keys come from res/lights.json (copied from ~/.config/homecam/lights.json at build time).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace SmittyOverlay
{
    public sealed class Bulb
    {
        public string name { get; set; } = "";
        public string room { get; set; } = "";
        public string id { get; set; } = "";
        public string ip { get; set; } = "";
        public string key { get; set; } = "";
        public double version { get; set; } = 3.5;
    }

    /// One short-lived 3.5 session: connect, negotiate a session key, send, read, close.
    public sealed class Tuya35 : IDisposable
    {
        const int NegStart = 3, NegResp = 4, NegFinish = 5, ControlNew = 13, QueryNew = 16;
        readonly TcpClient tcp = new TcpClient();
        NetworkStream s = null!;
        byte[] key; readonly byte[] realKey; uint seq = 1;

        public Tuya35(Bulb b) { realKey = key = Encoding.ASCII.GetBytes(b.key); host = b.ip; }
        readonly string host;

        public async Task<JsonElement> Query() { await Open(); await Send(QueryNew, Encoding.UTF8.GetBytes("{}")); return await ReadDps(); }

        public async Task<JsonElement?> Set(Dictionary<string, object> dps)
        {
            await Open();
            var body = JsonSerializer.Serialize(new { protocol = 5, t = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), data = new { dps } });
            await Send(ControlNew, Encoding.UTF8.GetBytes(body));
            try { return await ReadDps(); } catch { return null; }  // some bulbs ack without a status frame
        }

        async Task Open()
        {
            var c = tcp.ConnectAsync(host, 6668);
            if (await Task.WhenAny(c, Task.Delay(3000)) != c) throw new IOException("bulb did not answer");
            await c; s = tcp.GetStream(); s.ReadTimeout = 4000;
            var local = RandomNumberGenerator.GetBytes(16);
            await Write(Frame(NegStart, local));
            var (cmd, resp) = await Receive();
            if (cmd != NegResp || resp.Length < 48) throw new IOException("session key refused (wrong key?)");
            var remote = resp[..16];
            if (!resp[16..48].SequenceEqual(HMACSHA256.HashData(realKey, local))) throw new IOException("bulb failed key check");
            await Write(Frame(NegFinish, HMACSHA256.HashData(realKey, remote)));
            var mixed = local.Zip(remote, (a, b) => (byte)(a ^ b)).ToArray();
            var ct = new byte[16]; var tag = new byte[16];
            using (var g = new AesGcm(realKey)) g.Encrypt(local[..12], mixed, ct, tag);
            key = ct;
        }

        static byte[] Be(uint v) => new[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v };
        static uint U32(byte[] d, int at) => (uint)(d[at] << 24 | d[at + 1] << 16 | d[at + 2] << 8 | d[at + 3]);

        public byte[] Frame(int cmd, byte[] raw)
        {
            bool noHeader = cmd is QueryNew or NegStart or NegFinish;
            var plain = noHeader ? raw : Encoding.ASCII.GetBytes("3.5").Concat(new byte[12]).Concat(raw).ToArray();
            var head = new byte[] { 0, 0, 0x66, 0x99, 0, 0 }.Concat(Be(seq++)).Concat(Be((uint)cmd)).Concat(Be((uint)(12 + plain.Length + 16))).ToArray();
            var iv = RandomNumberGenerator.GetBytes(12); var ct = new byte[plain.Length]; var tag = new byte[16];
            using (var g = new AesGcm(key)) g.Encrypt(iv, plain, ct, tag, head[4..]);
            return head.Concat(iv).Concat(ct).Concat(tag).Concat(new byte[] { 0, 0, 0x99, 0x66 }).ToArray();
        }

        Task Write(byte[] d) => s.WriteAsync(d, 0, d.Length);
        Task Send(int cmd, byte[] raw) => Write(Frame(cmd, raw));

        async Task<byte[]> Read(int n)
        {
            var b = new byte[n]; int got = 0;
            while (got < n)
            {
                var r = s.ReadAsync(b, got, n - got);
                if (await Task.WhenAny(r, Task.Delay(4000)) != r) throw new IOException("bulb went quiet");
                var k = await r; if (k == 0) throw new IOException("bulb closed the connection"); got += k;
            }
            return b;
        }

        async Task<(int, byte[])> Receive()
        {
            var prefix = await Read(4);
            if (!prefix.SequenceEqual(new byte[] { 0, 0, 0x66, 0x99 })) throw new IOException("unexpected frame (not protocol 3.5?)");
            var head = await Read(14);
            int cmd = (int)U32(head, 6), len = (int)U32(head, 10);
            var body = await Read(len + 4);
            if (len < 28) throw new IOException("short frame");
            var pt = new byte[len - 28];
            using (var g = new AesGcm(key)) g.Decrypt(body[..12], body[12..(len - 16)], body[(len - 16)..len], pt, head);
            pt = pt[4..];  // return code
            if (cmd != NegResp && pt.Length >= 15 && pt[0] == '3' && pt[1] == '.') pt = pt[15..];
            return (cmd, pt);
        }

        async Task<JsonElement> ReadDps()
        {
            for (int i = 0; i < 4; i++)
            {
                var (_, pt) = await Receive();
                if (pt.Length == 0) continue;
                try
                {
                    var o = JsonDocument.Parse(pt).RootElement;
                    if (o.TryGetProperty("dps", out var d)) return d;
                    if (o.TryGetProperty("data", out var x) && x.TryGetProperty("dps", out d)) return d;
                }
                catch (JsonException) { }
            }
            throw new IOException("no status from bulb");
        }

        public void Dispose() => tcp.Dispose();
    }

    /// Bulb data points (Tuya category "dj", v2): 20 power, 21 mode, 22 brightness 10..1000, 23 temp 0..1000, 24 colour HHHHSSSSVVVV.
    public static class Lights
    {
        public static List<Bulb> All = new();
        static readonly Dictionary<string, (string target, Dictionary<string, object> st)[]> Scenes = new()
        {
            ["all-off"] = new[] { ("all", St(on: false)) },
            ["bright"] = new[] { ("all", St(on: true, b: 100, t: 60)) },
            ["movie"] = new[] { ("all", St(on: false)), ("living room", St(on: true, b: 10, t: 0)) },
            ["night"] = new[] { ("all", St(on: false)), ("bedroom overhead 1", St(on: true, b: 1, t: 0)) },
        };

        static Dictionary<string, object> St(bool? on = null, int? b = null, int? t = null, string? c = null)
        {
            var d = new Dictionary<string, object>();
            if (on != null) d["on"] = on; if (b != null) d["b"] = b; if (t != null) d["t"] = t; if (c != null) d["c"] = c;
            return d;
        }

        public static void Load(string path) =>
            All = JsonSerializer.Deserialize<List<Bulb>>(File.ReadAllText(path)) ?? new();

        public static List<Bulb> Match(string target)
        {
            var t = target.ToLowerInvariant();
            return All.Where(l => t == "all" || t == l.room || l.name.ToLowerInvariant().Contains(t)).ToList();
        }

        /// st keys: on (bool), b (0-100), t (0-100 warm..cool), c ("RRGGBB").
        public static Dictionary<string, object> Dps(Dictionary<string, object> st)
        {
            var d = new Dictionary<string, object>();
            if (st.TryGetValue("on", out var on) && !(bool)on) { d["20"] = false; return d; }
            d["20"] = true;
            int? b = st.TryGetValue("b", out var bv) ? Convert.ToInt32(bv) : null;
            if (st.TryGetValue("c", out var cv))
            {
                var rgb = Convert.FromHexString(((string)cv).TrimStart('#'));
                var (h, s, v) = Hsv(rgb[0], rgb[1], rgb[2]);
                if (b != null) v = b.Value / 100.0;
                d["21"] = "colour"; d["24"] = $"{(int)Math.Round(h):x4}{(int)Math.Round(s * 1000):x4}{(int)Math.Round(Math.Max(v, 0.01) * 1000):x4}";
                return d;
            }
            if (b != null || st.ContainsKey("t")) d["21"] = "white";
            if (b != null) d["22"] = 10 + (int)Math.Round(Math.Clamp(b.Value, 0, 100) * 9.9);
            if (st.TryGetValue("t", out var tv)) d["23"] = (int)Math.Round(Math.Clamp(Convert.ToInt32(tv), 0, 100) * 10.0);
            return d;
        }

        static (double h, double s, double v) Hsv(byte r8, byte g8, byte b8)
        {
            double r = r8 / 255.0, g = g8 / 255.0, b = b8 / 255.0, max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), dl = max - min;
            double h = dl == 0 ? 0 : max == r ? 60 * (((g - b) / dl) % 6) : max == g ? 60 * ((b - r) / dl + 2) : 60 * ((r - g) / dl + 4);
            return (h < 0 ? h + 360 : h, max == 0 ? 0 : dl / max, max);
        }

        public static object Status(Bulb l, JsonElement dps)
        {
            bool colour = dps.TryGetProperty("21", out var m) && m.GetString() == "colour";
            int? bri = null;
            if (colour && dps.TryGetProperty("24", out var c) && c.GetString()?.Length == 12) bri = (int)Math.Round(Convert.ToInt32(c.GetString()![8..], 16) / 10.0);
            else if (dps.TryGetProperty("22", out var b)) bri = (int)Math.Round((b.GetInt32() - 10) / 9.9);
            int? temp = dps.TryGetProperty("23", out var t) ? (int)Math.Round(t.GetInt32() / 10.0) : null;
            return new { l.name, l.room, l.ip, on = dps.TryGetProperty("20", out var p) && p.GetBoolean(), mode = colour ? "colour" : "white", brightness = bri, temp };
        }

        static async Task<T> Retry<T>(Func<Task<T>> f)
        {
            try { return await f(); } catch { await Task.Delay(300); return await f(); }  // a bulb switched a moment ago can drop the next connection
        }

        public static Task<object[]> StatusAll(string target) => Task.WhenAll(Match(target).Select(async l =>
        {
            try { return Status(l, await Retry(async () => { using var c = new Tuya35(l); return await c.Query(); })); }
            catch (Exception e) { return (object)new { l.name, l.room, l.ip, error = e.Message }; }
        }));

        public static Task<object[]> Apply(IEnumerable<(Bulb l, Dictionary<string, object> st)> jobs) => Task.WhenAll(jobs.Select(async j =>
        {
            try { await Retry(async () => { using var c = new Tuya35(j.l); return await c.Set(Dps(j.st)); }); return (object)new { j.l.name, ok = true }; }
            catch (Exception e) { return new { j.l.name, error = e.Message }; }
        }));

        public static Task<object[]> Set(string target, Dictionary<string, object> st) => Apply(Match(target).Select(l => (l, st)));

        public static Task<object[]> Scene(string name)
        {
            var plan = new Dictionary<string, (Bulb, Dictionary<string, object>)>();
            foreach (var (target, st) in Scenes[name]) foreach (var l in Match(target)) plan[l.id] = (l, st);
            return Apply(plan.Values);
        }

        public static bool HasScene(string name) => Scenes.ContainsKey(name);
    }

    /// Tiny HTTP server (raw TCP: HttpListener isn't reliable on Tizen).
    public static class HubServer
    {
        public const int Port = 18111;

        public static async Task Run()
        {
            var srv = new TcpListener(IPAddress.Any, Port); srv.Start();
            while (true) { var c = await srv.AcceptTcpClientAsync(); _ = Task.Run(() => Handle(c)); }
        }

        static async Task Handle(TcpClient c)
        {
            using (c)
            {
                try
                {
                    var st = c.GetStream(); var buf = new byte[8192]; var n = await st.ReadAsync(buf);
                    var line = Encoding.ASCII.GetString(buf, 0, n).Split("\r\n")[0].Split(' ');
                    if (line.Length < 2) return;
                    var (code, body) = await Route(line[0], line[1]);
                    var json = Encoding.UTF8.GetBytes(body);
                    var head = $"HTTP/1.1 {code}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {json.Length}\r\nConnection: close\r\n\r\n";
                    await st.WriteAsync(Encoding.ASCII.GetBytes(head)); await st.WriteAsync(json);
                }
                catch (Exception) { }
            }
        }

        public static async Task<(string, string)> Route(string method, string url)
        {
            var path = url.Split('?')[0];
            var q = (url.Contains('?') ? url[(url.IndexOf('?') + 1)..] : "").Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => Uri.UnescapeDataString(p.Length > 1 ? p[1].Replace('+', ' ') : ""));
            string J(object o) => JsonSerializer.Serialize(o);
            if (path == "/health") return ("200 OK", "\"ok\"");
            if (path == "/status") return ("200 OK", J(new { lights = Lights.All.Count, relay = Relay.State }));
            if (await Tv.Route(method, path, q) is { } tv) return tv;
            if (path == "/lights" && method == "GET") return ("200 OK", J(await Lights.StatusAll(q.GetValueOrDefault("target", "all"))));
            if (path == "/lights" && method == "POST")
            {
                var target = q.GetValueOrDefault("target", "all");
                if (Lights.Match(target).Count == 0) return ("404 Not Found", J(new { error = $"no light matches {target}" }));
                var st = new Dictionary<string, object>();
                if (q.TryGetValue("on", out var on)) st["on"] = on is "1" or "true" or "on";
                if (q.TryGetValue("b", out var b) && int.TryParse(b, out var bi) && bi is >= 0 and <= 100) st["b"] = bi;
                if (q.TryGetValue("t", out var t) && int.TryParse(t, out var ti) && ti is >= 0 and <= 100) st["t"] = ti;
                if (q.TryGetValue("c", out var col) && col.TrimStart('#').Length == 6 && col.TrimStart('#').All(Uri.IsHexDigit)) st["c"] = col;
                return ("200 OK", J(await Lights.Set(target, st)));
            }
            if (path.StartsWith("/scene/") && method == "POST")
            {
                var name = path[7..];
                return Lights.HasScene(name) ? ("200 OK", J(await Lights.Scene(name))) : ("404 Not Found", J(new { error = "unknown scene" }));
            }
            return ("404 Not Found", J(new { error = "not found" }));
        }
    }
}

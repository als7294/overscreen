// Home hub, part 2: control the TV itself, and reach the hub from outside the house through a relay.
//   GET  /tv                 -> {"front": "<app id or null>", "apps": {id: {"running", "visible"}}}
//   POST /tv/app/<id>        -> launch an app (native AppControl; the REST API refuses launches from the TV itself)
//   POST /tv/youtube?v=<id>  -> play a video in the YouTube app (AppControl PAYLOAD "#play=<id>")
// Relay (optional, res/relay.json = {"url": "https://host", "token": "..."}): long-polls <url>/hub/poll with
// "Authorization: Bearer <token>", runs the job against HubServer.Route, posts the answer to <url>/hub/reply/<id>.
// Protocol and self-test: HomeCam app/ipad/relay/relay.py.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace SmittyOverlay
{
    public static class Tv
    {
        // The TV answers app launches on its LAN address but refuses them from 127.0.0.1 (401).
        static readonly string Host = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses).Select(u => u.Address)
            .FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !IPAddress.IsLoopback(a))?.ToString() ?? "127.0.0.1";
        static readonly string Self = $"http://{Host}:8001/api/v2/applications/";
        // shortcut: fixed list of apps to report in GET /tv; add an id here to track another app.
        public static readonly string[] Apps = { "111299001912" /* YouTube */, "3201907018807" /* Netflix */, "LBUAQX1exg.Hulu" /* Hulu */, "9Ur5IzDKqV.TizenYouTube" /* YouTube (no ads) */, "SamSucks01.samsucks" /* Plex */ };
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };

        public static bool ValidId(string id) => id.Length is > 0 and < 64 && id.All(c => char.IsLetterOrDigit(c) || c == '.' || c == '_');

        public static async Task<(string, string)?> Route(string method, string path, Dictionary<string, string> q)
        {
            string J(object o) => JsonSerializer.Serialize(o);
            if (path == "/tv" && method == "GET")
            {
                var apps = new Dictionary<string, object>(); string? front = null;
                foreach (var id in Apps)
                {
                    try
                    {
                        var a = JsonDocument.Parse(await http.GetStringAsync(Self + id)).RootElement;
                        bool running = a.GetProperty("running").GetBoolean(), visible = a.GetProperty("visible").GetBoolean();
                        apps[id] = new { running, visible }; if (visible) front ??= id;
                    }
                    catch (Exception) { }  // app not installed on this TV
                }
                return ("200 OK", J(new { front, apps }));
            }
            if (path.StartsWith("/tv/app/") && method == "POST")
            {
                var id = path[8..];
                if (!ValidId(id)) return ("400 Bad Request", J(new { error = "bad app id" }));
                try
                {   // native launcher: the TV's REST API refuses launches that come from the TV itself (401)
                    Tizen.Applications.AppControl.SendLaunchRequest(new Tizen.Applications.AppControl { ApplicationId = id });
                    return ("200 OK", J(new { launched = id }));
                }
                catch (Exception e) { return ("502 Bad Gateway", J(new { error = e.Message })); }
            }
            if (path == "/tv/youtube" && method == "POST")
            {
                var v = q.GetValueOrDefault("v", "");
                if (v.Length is 0 or > 20 || !v.All(c => char.IsLetterOrDigit(c) || c is '-' or '_')) return ("400 Bad Request", J(new { error = "bad video id" }));
                try
                {   // DIAL (:8080) refuses requests from the TV itself (401), so deep-link through the native launcher
                    var ac = new Tizen.Applications.AppControl { ApplicationId = "111299001912" };
                    ac.ExtraData.Add("PAYLOAD", "#play=" + v);
                    Tizen.Applications.AppControl.SendLaunchRequest(ac);
                    return ("200 OK", J(new { playing = v }));
                }
                catch (Exception e) { return ("502 Bad Gateway", J(new { error = e.Message })); }
            }
            return null;
        }
    }

    public static class Relay
    {
        public static string State = "off (no res/relay.json)";  // shown at GET /status

        public static async Task Run(string url, string token)
        {
            url = url.TrimEnd('/');
            var http = new HttpClient { Timeout = TimeSpan.FromSeconds(40) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            while (true)
            {
                try
                {
                    var r = await http.GetAsync(url + "/hub/poll");
                    State = $"polling ({(int)r.StatusCode} at {DateTime.UtcNow:HH:mm:ss}Z)";
                    if (r.StatusCode == HttpStatusCode.NoContent) continue;
                    if (!r.IsSuccessStatusCode) { await Task.Delay(10000); continue; }  // auth or relay error: back off
                    var job = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
                    var (code, body) = await HubServer.Route(job.GetProperty("method").GetString() ?? "GET", job.GetProperty("path").GetString() ?? "/");
                    var reply = JsonSerializer.Serialize(new { status = int.Parse(code.Split(' ')[0]), type = "application/json", body });
                    await http.PostAsync(url + "/hub/reply/" + job.GetProperty("id").GetString(), new StringContent(reply, Encoding.UTF8, "application/json"));
                }
                catch (Exception e) { State = "error: " + e.Message; await Task.Delay(10000); }
            }
        }
    }
}

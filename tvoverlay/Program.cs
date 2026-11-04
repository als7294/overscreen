// SmittyBox overlay presenter: draws pop-ups ON TOP OF OTHER APPS (Hulu, the YouTube app, ...).
// A native NUI window of type Notification, non-focusable (the remote keeps driving the app
// underneath). The pills themselves are rendered on the Mac from the TV app's own HTML/CSS and
// arrive as transparent PNGs, so they look exactly like the pills inside SamSUCKED.
//
// Protocol (LAN, UDP 18110): {"id":"..","url":"http://<relay>:8795/media/x.png","x":..,"y":..,"w":..,"h":..,"ms":..}
// The image must come from the sender's own address. Reply: "ack <id>" once the image is downloaded.
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;
using Timer = Tizen.NUI.Timer;

namespace SmittyOverlay
{
    internal sealed class Overlay : NUIApplication
    {
        private sealed class Req { public string Path; public int X, Y, W, H, Ms; }

        private readonly ConcurrentQueue<Req> inbox = new ConcurrentQueue<Req>();
        private readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };
        private Timer pump;
        private bool busy;

        private void Listen()
        {
            using (var udp = new UdpClient(18110))
            {
                var from = new IPEndPoint(IPAddress.Any, 0);
                while (true)
                {
                    try
                    {
                        var data = udp.Receive(ref from);
                        var j = JsonDocument.Parse(data).RootElement;
                        string url = j.GetProperty("url").GetString() ?? "";
                        if (!url.StartsWith("http://" + from.Address + ":")) continue; // only the sender's own images
                        int I(string k, int d) => j.TryGetProperty(k, out var v) && v.TryGetInt32(out var n) ? n : d;
                        var req = new Req { X = I("x", 0), Y = I("y", 0), W = Math.Clamp(I("w", 1000), 10, 1920), H = Math.Clamp(I("h", 200), 10, 1080), Ms = Math.Clamp(I("ms", 7000), 1000, 60000) };
                        req.Path = System.IO.Path.Combine(Tizen.Applications.Application.Current.DirectoryInfo.Data, "pill-" + DateTime.Now.Ticks + ".png");
                        File.WriteAllBytes(req.Path, http.GetByteArrayAsync(url).Result);
                        inbox.Enqueue(req);
                        var ack = Encoding.UTF8.GetBytes("ack " + (j.TryGetProperty("id", out var id) ? id.GetString() : ""));
                        udp.Send(ack, ack.Length, from);
                    }
                    catch (Exception) { /* bad packet or download failed: the relay falls back to the TV's banner */ }
                }
            }
        }

        private void Show(Req r)
        {
            busy = true;
            var win = new Window("SmittyOverlay", new Rectangle(r.X, r.Y, r.W, r.H), true);
            win.Type = WindowType.Notification;
            win.BackgroundColor = Color.Transparent;
            win.SetTransparency(true);
            win.SetOpaqueState(false);
            win.SetAcceptFocus(false);                        // the remote keeps controlling the app underneath
            win.SetNotificationLevel(NotificationLevel.Base);
            var root = new View { Size = new Size(r.W, r.H), BackgroundColor = Color.Transparent, Opacity = 0.0f, PositionY = -22 };
            var image = new ImageView { Size = new Size(r.W, r.H), BackgroundColor = Color.Transparent, SynchronousLoading = true };
            image.SetImage(r.Path);
            root.Add(image);
            win.Add(root);
            win.Show();
            // slide down + fade in, hold, slide up + fade out
            var enter = new Animation(420);
            enter.AnimateTo(root, "Opacity", 1.0f);
            enter.AnimateTo(root, "PositionY", 0.0f, new AlphaFunction(AlphaFunction.BuiltinFunctions.EaseOut));
            enter.Play();
            var hold = new Timer((uint)r.Ms);
            hold.Tick += (s, e) =>
            {
                var exit = new Animation(320);
                exit.AnimateTo(root, "Opacity", 0.0f);
                exit.AnimateTo(root, "PositionY", -16.0f, new AlphaFunction(AlphaFunction.BuiltinFunctions.EaseIn));
                exit.Finished += (s2, e2) =>
                {
                    win.Hide(); win.Dispose();
                    try { File.Delete(r.Path); } catch (Exception) { }
                    busy = false;
                };
                exit.Play();
                return false;
            };
            hold.Start();
        }

        protected override void OnCreate()
        {
            base.OnCreate();
            // No screen of its own: the main window stays (hiding it gets the app closed) but is
            // fully transparent, click-through and sent behind everything.
            var main = GetDefaultWindow();
            main.BackgroundColor = Color.Transparent;
            main.SetTransparency(true);
            main.SetOpaqueState(false);
            main.SetAcceptFocus(false);
            main.Lower();
            new Thread(Listen) { IsBackground = true }.Start();
            pump = new Timer(80);
            pump.Tick += (s, e) => { if (!busy && inbox.TryDequeue(out var r)) Show(r); return true; };
            pump.Start();
        }

        private static void Main(string[] args) => new Overlay().Run(args);
    }
}

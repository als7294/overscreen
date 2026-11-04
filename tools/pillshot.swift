// pillshot: renders a SamSUCKED pop-up to a transparent PNG with the TV app's own pill code + CSS
// (tools/overlay/dist/overlay.js), for the native overlay that draws over other apps on the TV.
// Runs as a child of tools/notify.mjs. One JSON request per stdin line:
//   {"ev": {...pop-up event...}, "out": "/path/pill.png"}
// One JSON reply per line: {"ok":true,"x":..,"y":..,"w":..,"h":..} (TV screen coordinates) or {"ok":false}.
// Build: swiftc -O tools/pillshot.swift -o ~/Library/Application\ Support/SamSUCKS/bin/pillshot
import AppKit
import WebKit

setvbuf(stdout, nil, _IOLBF, 0)
let overlayPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let overlay = (try? String(contentsOfFile: overlayPath, encoding: .utf8)) ?? ""

final class Shot: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let window: NSWindow
  var queue: [(ev: String, out: String)] = []
  var busy = false
  var current: (ev: String, out: String)?

  override init() {
    let cfg = WKWebViewConfiguration()
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1920, height: 1080), configuration: cfg)
    web.setValue(false, forKey: "drawsBackground")          // transparent around the pill
    // macOS only paints web views in windows that are on screen, so the window sits on screen but
    // fully transparent, click-through and out of the way (never visible, never takes focus).
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1920, height: 1080), styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = web
    window.isOpaque = false
    window.backgroundColor = .clear
    window.alphaValue = 0.0
    window.ignoresMouseEvents = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .transient]
    window.orderFrontRegardless()
    super.init()
    web.navigationDelegate = self
  }

  func next() {
    guard !busy, !queue.isEmpty else { return }
    busy = true
    current = queue.removeFirst()
    // No sound on the Mac: the pill code's chime needs Web Audio, so take it away.
    let page = "<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;background:transparent;width:1920px;height:1080px;overflow:hidden}.pp-text strong,.pp-text{animation:none!important;color:#fff}</style>" +
      "<script>window.AudioContext=undefined;window.webkitAudioContext=undefined;</script><script>\(overlay)</script></head><body></body></html>"
    web.loadHTMLString(page, baseURL: nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let job = current else { return }
    web.evaluateJavaScript("ssPills.show(\(job.ev)); 1") { _, _ in
      // Let the entrance animation settle, then measure the pill (plus room for its shadow).
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) {
        let js = "(()=>{const b=document.querySelector('body > .pp .pp-box');if(!b)return null;const r=b.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()"
        self.web.evaluateJavaScript(js) { v, _ in
          guard let a = v as? [Double], a.count == 4 else { return self.done(nil) }
          let pad = (side: 70.0, top: 30.0, bottom: 120.0)
          let x = max(0, a[0] - pad.side), y = max(0, a[1] - pad.top)
          let w = min(1920 - x, a[2] + pad.side * 2), h = min(1080 - y, a[3] + pad.top + pad.bottom)
          let conf = WKSnapshotConfiguration()
          conf.rect = CGRect(x: x, y: y, width: w, height: h)
          conf.snapshotWidth = NSNumber(value: w)                  // 1 CSS px = 1 TV px
          self.web.takeSnapshot(with: conf) { img, _ in
            guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]), (try? png.write(to: URL(fileURLWithPath: job.out))) != nil
            else { return self.done(nil) }
            self.done([Int(x), Int(y), Int(w), Int(h)])
          }
        }
      }
    }
  }

  func done(_ r: [Int]?) {
    if let r = r { print("{\"ok\":true,\"x\":\(r[0]),\"y\":\(r[1]),\"w\":\(r[2]),\"h\":\(r[3])}") } else { print("{\"ok\":false}") }
    busy = false
    current = nil
    next()
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let shot = Shot()
DispatchQueue.global().async {
  while let line = readLine() {
    guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let ev = o["ev"], let out = o["out"] as? String,
          let evJSON = try? JSONSerialization.data(withJSONObject: ev), let evStr = String(data: evJSON, encoding: .utf8) else { print("{\"ok\":false}"); continue }
    DispatchQueue.main.async { shot.queue.append((evStr, out)); shot.next() }
  }
  exit(0)
}
app.run()

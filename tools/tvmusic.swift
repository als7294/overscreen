// tvmusic: a menu-bar remote for the TV's music (SamSUCKED's own radio). Shows a ♪ in the menu
// bar only while the TV is reporting in (home Wi-Fi, TV on), with what's playing, the stations
// to switch between, and play/pause. Talks to tools/notify.mjs on this Mac; no audio involved.
// Build: swiftc -O tools/tvmusic.swift -o ~/Library/Application\ Support/SamSUCKS/bin/tvmusic
import AppKit

let relay = URL(string: "http://127.0.0.1:8795")!

struct Station: Decodable { let id: String; let name: String; let genre: String? }
// YouTube mixes (same as the TV's music picker): open in the TV's YouTube app, ad-free with Premium.
let mixes: [(name: String, video: String, live: Bool)] = [
  ("Mac Miller", "SsKT0s5J8ko", false), ("Ken Carson", "CSMiPngo4uE", false), ("Tape B", "sEI-6g7Gsp4", false),
  ("Fallout Radio", "n9D6GNzpmkM", false), ("Tyler, The Creator", "TGgcC5xg9YI", false), ("Lofi Girl (live)", "rFZHOHl-L8A", true),
]
struct MusicState: Decodable {
  let title: String?; let artist: String?; let station: String?; let paused: Bool?
  let current: String?; let stations: [Station]?; let live: Bool?
}

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var state: MusicState?

  func applicationDidFinishLaunching(_ n: Notification) {
    item.isVisible = false
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    refresh()
    Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
  }

  func refresh() {
    URLSession.shared.dataTask(with: relay.appendingPathComponent("music/state")) { data, _, _ in
      let s = data.flatMap { try? JSONDecoder().decode(MusicState.self, from: $0) }
      DispatchQueue.main.async {
        self.state = s
        let live = s?.live == true
        self.item.isVisible = live                       // hidden when the TV isn't reachable
        if live, let button = self.item.button {
          // A proper music-note symbol, larger than the text glyph was.
          let cfg = NSImage.SymbolConfiguration(pointSize: 17, weight: .semibold)
          button.image = NSImage(systemSymbolName: s?.paused == true ? "pause.circle" : "music.note", accessibilityDescription: "TV music")?.withSymbolConfiguration(cfg)
          button.title = ""
          button.toolTip = [s?.title, s?.artist, s?.station].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
      }
    }.resume()
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let s = state
    let now = [s?.title, s?.artist].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " — ")
    let head = NSMenuItem(title: now.isEmpty ? "Tuning in…" : now, action: nil, keyEquivalent: "")
    head.isEnabled = false
    menu.addItem(head)
    if let st = s?.station, !st.isEmpty { let i = NSMenuItem(title: "On the TV: " + st, action: nil, keyEquivalent: ""); i.isEnabled = false; menu.addItem(i) }
    menu.addItem(.separator())
    let toggle = NSMenuItem(title: s?.paused == true ? "Play" : "Pause", action: #selector(togglePlay), keyEquivalent: "p")
    toggle.target = self
    menu.addItem(toggle)
    menu.addItem(.separator())
    for st in s?.stations ?? [] {
      let i = NSMenuItem(title: st.name + (st.genre.map { "  ·  " + $0 } ?? ""), action: #selector(pick(_:)), keyEquivalent: "")
      i.target = self
      i.representedObject = st.id
      i.state = st.id == s?.current ? .on : .off
      menu.addItem(i)
    }
    menu.addItem(.separator())
    let ytHead = NSMenuItem(title: "YouTube mixes (play on the TV through this Mac)", action: nil, keyEquivalent: "")
    ytHead.isEnabled = false
    menu.addItem(ytHead)
    for (i, m) in mixes.enumerated() {
      let it = NSMenuItem(title: m.name, action: #selector(pickMix(_:)), keyEquivalent: "")
      it.target = self
      it.tag = i
      menu.addItem(it)
    }
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit TV Music", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.addItem(quit)
  }

  func send(_ body: [String: String]) {
    var r = URLRequest(url: relay.appendingPathComponent("music/cmd"))
    r.httpMethod = "POST"
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: r) { _, _, _ in DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.refresh() } }.resume()
  }
  @objc func togglePlay() { send(["cmd": "toggle"]) }
  @objc func pickMix(_ sender: NSMenuItem) {
    let m = mixes[sender.tag]
    var r = URLRequest(url: relay.appendingPathComponent("music/cmd"))
    r.httpMethod = "POST"
    r.httpBody = try? JSONSerialization.data(withJSONObject: ["cmd": "mix", "id": m.video, "live": m.live, "name": m.name])
    URLSession.shared.dataTask(with: r).resume()
  }
  @objc func pick(_ sender: NSMenuItem) { if let id = sender.representedObject as? String { send(["cmd": "station", "id": id]) } }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // menu bar only: no Dock icon, no window
let delegate = App()
app.delegate = delegate
app.run()

// tvmessages: shows new iMessages/texts on the TV. Watches ~/Library/Messages/chat.db (read-only)
// for incoming messages, looks the sender up in Contacts (name + photo), and posts each one to
// the relay (tools/notify.mjs), which shows it on the TV under the usual rules.
// Needs (System Settings → Privacy & Security): Full Disk Access (to read Messages) and Contacts.
// Build: swiftc -O tools/tvmessages.swift -o ~/Library/Application\ Support/SamSUCKS/bin/tvmessages
import Foundation
import SQLite3
import Contacts
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)
let dbPath = NSHomeDirectory() + "/Library/Messages/chat.db"
let relay = URL(string: "http://127.0.0.1:8795/notify")!
let store = CNContactStore()
var contactsOK = false
let sem = DispatchSemaphore(value: 0)
store.requestAccess(for: .contacts) { ok, _ in contactsOK = ok; sem.signal() }
sem.wait()

var db: OpaquePointer?
guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
  FileHandle.standardError.write("can't open chat.db: grant Full Disk Access to tvmessages\n".data(using: .utf8)!); exit(1)
}

func query(_ sql: String, _ bind: Int64? = nil, on conn: OpaquePointer? = nil) -> [[Any?]] {
  var st: OpaquePointer?
  guard sqlite3_prepare_v2(conn ?? db, sql, -1, &st, nil) == SQLITE_OK else { return [] }
  defer { sqlite3_finalize(st) }
  if let b = bind { sqlite3_bind_int64(st, 1, b) }
  var rows: [[Any?]] = []
  while sqlite3_step(st) == SQLITE_ROW {
    var r: [Any?] = []
    for i in 0..<sqlite3_column_count(st) {
      switch sqlite3_column_type(st, i) {
      case SQLITE_INTEGER: r.append(sqlite3_column_int64(st, i))
      case SQLITE_TEXT: r.append(String(cString: sqlite3_column_text(st, i)))
      case SQLITE_BLOB: r.append(Data(bytes: sqlite3_column_blob(st, i), count: Int(sqlite3_column_bytes(st, i))))
      default: r.append(nil)
      }
    }
    rows.append(r)
  }
  return rows
}

// Newer macOS keeps the text only in attributedBody (an archived NSAttributedString).
func bodyText(_ d: Data) -> String? {
  if let a = (try? NSUnarchiver.unarchiveObject(with: d)) as? NSAttributedString { return a.string }
  return nil
}

struct Who { let name: String; let avatar: String? }
var cache: [String: Who] = [:]
func who(_ handle: String) -> Who {
  if let w = cache[handle] { return w }
  var w = Who(name: handle, avatar: nil)
  if contactsOK {
    let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactThumbnailImageDataKey] as [CNKeyDescriptor]
    let pred = handle.contains("@") ? CNContact.predicateForContacts(matchingEmailAddress: handle) : CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: handle))
    if let c = try? store.unifiedContacts(matching: pred, keysToFetch: keys).first {
      let name = c.nickname.isEmpty ? [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ") : c.nickname
      let photo = c.thumbnailImageData.map { "data:image/jpeg;base64," + $0.base64EncodedString() }
      w = Who(name: name.isEmpty ? handle : name, avatar: photo)
    }
  }
  cache[handle] = w
  return w
}

func post(_ body: [String: Any]) {
  var r = URLRequest(url: relay); r.httpMethod = "POST"; r.timeoutInterval = 10
  r.httpBody = try? JSONSerialization.data(withJSONObject: body)
  URLSession.shared.dataTask(with: r).resume()
}

var last = (query("SELECT IFNULL(MAX(ROWID), 0) FROM message").first?.first as? Int64) ?? 0
let sql = """
SELECT m.ROWID, m.text, m.attributedBody, h.id, c.display_name, m.cache_has_attachments
FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
LEFT JOIN chat_message_join j ON j.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = j.chat_id
WHERE m.ROWID > ? AND m.is_from_me = 0 AND IFNULL(m.associated_message_type, 0) = 0 AND IFNULL(m.item_type, 0) = 0
ORDER BY m.ROWID
"""
print("tvmessages: watching from message \(last), contacts \(contactsOK ? "on" : "off")")

// ---------- FaceTime calls and Discord, from the Mac's own notification log ----------
// macOS records every notification it shows in usernoted's database (readable with Full Disk Access).
let WATCH: [String: String] = ["com.apple.FaceTime": "facetime", "com.hnc.Discord": "discord"]
let notifPath = NSHomeDirectory() + "/Library/Group Containers/group.com.apple.usernoted/db2/db"
var ndb: OpaquePointer?
var nlast: Int64 = 0
if sqlite3_open_v2(notifPath, &ndb, SQLITE_OPEN_READONLY, nil) == SQLITE_OK {
  nlast = (query("SELECT IFNULL(MAX(rec_id), 0) FROM record", on: ndb).first?.first as? Int64) ?? 0
  print("tvmessages: notifications from \(nlast)")
} else { print("tvmessages: can't open the notification log at \(notifPath)") }

func photoByName(_ name: String) -> String? {
  guard contactsOK, !name.isEmpty else { return nil }
  let keys = [CNContactThumbnailImageDataKey] as [CNKeyDescriptor]
  return (try? store.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: name), keysToFetch: keys).first)?
    .flatMap { $0.thumbnailImageData }.map { "data:image/jpeg;base64," + $0.base64EncodedString() }
}

func pollNotifications() {
  guard ndb != nil else { return }
  let rows = query("SELECT r.rec_id, a.identifier, r.data FROM record r JOIN app a ON a.app_id = r.app_id WHERE r.rec_id > ? ORDER BY r.rec_id", nlast, on: ndb)
  for r in rows {
    guard let id = r[0] as? Int64 else { continue }
    nlast = max(nlast, id)
    guard let bundle = r[1] as? String, let app = WATCH[bundle], let data = r[2] as? Data,
          let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          let req = plist["req"] as? [String: Any] else { continue }
    let title = (req["titl"] as? String) ?? (app == "facetime" ? "FaceTime" : "Discord")
    let sub = (req["subt"] as? String) ?? ""
    let body = (req["body"] as? String) ?? ""
    var ev: [String: Any] = ["alert": true, "kind": "message", "source": app, "app": app, "title": String(title.prefix(80)),
                             "text": String((body.isEmpty ? sub : body).prefix(300))]
    if app == "discord", !sub.isEmpty, !body.isEmpty { ev["group"] = sub }           // server / channel
    if app == "facetime" { ev["important"] = true; if let p = photoByName(title) { ev["avatar"] = p } } // a ringing call gets through
    print("tvmessages: \(app) notification")
    post(ev)
  }
}
Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in pollNotifications() }
Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
  for r in query(sql, last) {
    guard let id = r[0] as? Int64 else { continue }
    last = max(last, id)
    var text = (r[1] as? String) ?? ((r[2] as? Data).flatMap(bodyText) ?? "")
    text = text.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { text = ((r[5] as? Int64) ?? 0) != 0 ? "Sent a photo" : "" }
    if text.isEmpty { continue }
    let w = who((r[3] as? String) ?? "Someone")
    var ev: [String: Any] = ["alert": true, "kind": "message", "source": "imessage", "app": "imessage", "title": w.name, "text": String(text.prefix(300))]
    if let g = r[4] as? String, !g.isEmpty { ev["group"] = g }
    if let a = w.avatar { ev["avatar"] = a }
    post(ev)
  }
}
RunLoop.main.run()

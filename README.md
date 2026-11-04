# Overscreen

**Your Mac and iPhone notifications on top of whatever's on your Samsung TV.**
iMessages, FaceTime calls, Discord, and your Claude Code / Codex agents, as custom pop-ups drawn
right over Hulu, the YouTube app, your console, live TV. No root, no jailbreak, no extra box.

> Samsung's own developer FAQ says *"overlay applications are not supported"* on its TVs. This
> project shows a way to do it anyway with public Tizen APIs on a stock 2025 TV in Developer Mode.

---

## The trick

Tizen TV web apps can't draw over another app. The only thing they get is Samsung's plain grey
text banner. But a small **native Tizen .NET (NUI) app** can open a second window of type
`WindowType.Notification`, make it transparent and **non-focusable**, and set its notification
level. The TV's compositor then draws that window **above the app that's playing**, while the
remote keeps controlling the app underneath.

```csharp
var win = new Window("overlay", new Rectangle(x, y, w, h), true);
win.Type = WindowType.Notification;          // drawn above other apps
win.SetTransparency(true);
win.SetOpaqueState(false);
win.SetAcceptFocus(false);                   // the remote keeps driving Hulu/YouTube
win.SetNotificationLevel(NotificationLevel.Base);
```

Tested on a Samsung UN50U8000F (2025, Tizen 9.0): over **Hulu** and the **native YouTube app**,
video keeps playing, audio keeps playing, the remote still pauses and seeks, and there's no flash.
(WebView inside that window flashes a white rectangle on show; plain native views don't.)

Not yet tested: Netflix, Disney+, Prime Video. Reports welcome.

## How the pieces fit

```
 Mac ────────────────────────────────────────────────┐        TV ─────────────────────────────────┐
 Claude Code / Codex hooks ─┐                         │        Overscreen (web app)                 │
 iMessage / FaceTime /      ├─► tools/notify.mjs ─────┼──────► lockscreen, home, YouTube mode,    │
 Discord (tvmessages)  ─────┘    (the relay)          │        HDMI / live TV: pills drawn in-app  │
                                   │  other app in front?      │
                                   ▼                  │        tvoverlay/ (native NUI presenter)   │
                         tools/pillshot (WebKit) ─────┼──────► draws the same pill OVER Hulu,      │
                         renders the pill to a PNG    │        YouTube, anything                   │
                         from the TV's own HTML/CSS   │        (Samsung banner as a fallback)      │
 ─────────────────────────────────────────────────────┘        ────────────────────────────────────┘
```

- The pills are designed once, in HTML/CSS (`app/css/popups.css`, `app/js/ui/pill.js`).
- Inside Overscreen they render live.
- Over other apps, the Mac renders the same pill to a transparent PNG (`tools/pillshot.swift`, WebKit) and the native presenter shows it. That way the design stays pixel-identical without rewriting it in C#.

## What else is in the box

- **Agent pop-ups.**
  - Claude Code and Codex hooks show *working → finished* pills, with live task titles from Apple's on-device model.
  - Questions and approvals get their own pills. Corrections and additions get their own tags.
  - Task icons dock in the corner, and spoken wrap-ups pause the video and resume it after.
- **Phone notifications via the Mac:** iMessage (sender photo from Contacts), FaceTime calls (they ring through even on "quiet" apps), Discord.
- **A launcher:**
  - Lockscreen: a starfield with a drifting nebula, a clock, and rotating news with real key points. The news filters clickbait and repeats and gets fresher late at night.
  - Google TV-style home and radio. YouTube mixes play behind the lockscreen through the Mac, or open in the YouTube app.
- **YouTube mode:** YouTube's own TV site inside Overscreen, so pills can sit on top. It uses Developer Mode's debug launch, the same trick as TizenBrew.
- **HDMI / live TV inside Overscreen** via the `tvwindow` API, with real overlays on consoles and cable boxes.
- **Rules that respect what you're doing:**
  - Only on your home Wi-Fi with the TV on.
  - Only "important" alerts during Netflix and Hulu.
  - No voice when you're sitting at your Mac.

## Notifications that can show

| | Source | What pops up |
|---|---|---|
| <img src="https://www.google.com/s2/favicons?sz=32&domain=claude.ai" width="16" height="16" alt=""> | **Claude Code** | Working (with a live task title), finished (says what finished), questions, approvals, corrections and additions, image previews, rich wrap-ups, spoken voice updates |
| <img src="https://www.google.com/s2/favicons?sz=32&domain=chatgpt.com" width="16" height="16" alt=""> | **Codex** | The same set: starts, finishes and approvals come straight from Codex's hooks, and Codex can send the rest with `tv-alert` |
| <img src="https://www.google.com/s2/favicons?sz=32&domain=apple.com" width="16" height="16" alt=""> | **iMessage / texts** | Sender's contact photo, name, group name, the message ("Sent a photo" for pictures) |
| <img src="https://www.google.com/s2/favicons?sz=32&domain=apple.com" width="16" height="16" alt=""> | **FaceTime** | Incoming calls, with the caller's photo; these get through even while you're watching "quiet" apps |
| <img src="https://www.google.com/s2/favicons?sz=32&domain=discord.com" width="16" height="16" alt=""> | **Discord** | Sender, server/channel, message (from the Discord app on your Mac) |

Pill types: **QUESTION** · **WORKING** · **CORRECTION** · **ADDITION** · **DONE** · **PREVIEW** (image) · **WRAP-UP** · **VOICE** · **iMESSAGE** · **FACETIME** · **DISCORD**. Several agents at once dock as small task icons in the corner, each with a short task label.

Where they appear:

- **Inside Overscreen** (lockscreen, home, YouTube mode, HDMI / live TV): the full pill, with sound.
- **Over other apps** (Hulu, the YouTube app, …): the same pill through the native overlay. If the overlay isn't running, Samsung's text banner instead.
- **Netflix / Hulu "quiet" rule:** only important ones (questions, approvals, calls) get through.

## News sources

The lockscreen and Home pull from these feeds (topics can be switched on and off in Settings). Every story needs a photo; clickbait, deals, listicles, first-person takes and repeats are filtered out, and stories on the same event from several outlets are merged.

**Tech**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=theverge.com" width="16" height="16" alt=""> The Verge · <img src="https://www.google.com/s2/favicons?sz=32&domain=arstechnica.com" width="16" height="16" alt=""> Ars Technica · <img src="https://www.google.com/s2/favicons?sz=32&domain=engadget.com" width="16" height="16" alt=""> Engadget · <img src="https://www.google.com/s2/favicons?sz=32&domain=techcrunch.com" width="16" height="16" alt=""> TechCrunch · <img src="https://www.google.com/s2/favicons?sz=32&domain=wired.com" width="16" height="16" alt=""> Wired · <img src="https://www.google.com/s2/favicons?sz=32&domain=9to5mac.com" width="16" height="16" alt=""> 9to5Mac · <img src="https://www.google.com/s2/favicons?sz=32&domain=macrumors.com" width="16" height="16" alt=""> MacRumors

**AI**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=theverge.com" width="16" height="16" alt=""> The Verge · <img src="https://www.google.com/s2/favicons?sz=32&domain=arstechnica.com" width="16" height="16" alt=""> Ars Technica · <img src="https://www.google.com/s2/favicons?sz=32&domain=techcrunch.com" width="16" height="16" alt=""> TechCrunch · <img src="https://www.google.com/s2/favicons?sz=32&domain=technologyreview.com" width="16" height="16" alt=""> MIT Tech Review

**Gaming**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=rockpapershotgun.com" width="16" height="16" alt=""> Rock Paper Shotgun · <img src="https://www.google.com/s2/favicons?sz=32&domain=theverge.com" width="16" height="16" alt=""> The Verge · <img src="https://www.google.com/s2/favicons?sz=32&domain=pcgamer.com" width="16" height="16" alt=""> PC Gamer · <img src="https://www.google.com/s2/favicons?sz=32&domain=gamespot.com" width="16" height="16" alt=""> GameSpot · <img src="https://www.google.com/s2/favicons?sz=32&domain=eurogamer.net" width="16" height="16" alt=""> Eurogamer · <img src="https://www.google.com/s2/favicons?sz=32&domain=polygon.com" width="16" height="16" alt=""> Polygon · <img src="https://www.google.com/s2/favicons?sz=32&domain=ign.com" width="16" height="16" alt=""> IGN

**Politics (several outlets per story, Left/Center/Right coverage bar)**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=nbcnews.com" width="16" height="16" alt=""> NBC News · <img src="https://www.google.com/s2/favicons?sz=32&domain=washingtontimes.com" width="16" height="16" alt=""> Washington Times · <img src="https://www.google.com/s2/favicons?sz=32&domain=npr.org" width="16" height="16" alt=""> NPR · <img src="https://www.google.com/s2/favicons?sz=32&domain=thehill.com" width="16" height="16" alt=""> The Hill · <img src="https://www.google.com/s2/favicons?sz=32&domain=axios.com" width="16" height="16" alt=""> Axios · <img src="https://www.google.com/s2/favicons?sz=32&domain=bbc.com" width="16" height="16" alt=""> BBC · <img src="https://www.google.com/s2/favicons?sz=32&domain=nypost.com" width="16" height="16" alt=""> NY Post · <img src="https://www.google.com/s2/favicons?sz=32&domain=politico.com" width="16" height="16" alt=""> Politico · <img src="https://www.google.com/s2/favicons?sz=32&domain=cbsnews.com" width="16" height="16" alt=""> CBS · <img src="https://www.google.com/s2/favicons?sz=32&domain=nationalreview.com" width="16" height="16" alt=""> National Review · <img src="https://www.google.com/s2/favicons?sz=32&domain=vox.com" width="16" height="16" alt=""> Vox · <img src="https://www.google.com/s2/favicons?sz=32&domain=breitbart.com" width="16" height="16" alt=""> Breitbart · <img src="https://www.google.com/s2/favicons?sz=32&domain=thedispatch.com" width="16" height="16" alt=""> The Dispatch

**World (off by default)**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=bbc.com" width="16" height="16" alt=""> BBC · <img src="https://www.google.com/s2/favicons?sz=32&domain=npr.org" width="16" height="16" alt=""> NPR · <img src="https://www.google.com/s2/favicons?sz=32&domain=cbsnews.com" width="16" height="16" alt=""> CBS · <img src="https://www.google.com/s2/favicons?sz=32&domain=nbcnews.com" width="16" height="16" alt=""> NBC News

**Business (off by default)**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=bbc.com" width="16" height="16" alt=""> BBC · <img src="https://www.google.com/s2/favicons?sz=32&domain=npr.org" width="16" height="16" alt=""> NPR · <img src="https://www.google.com/s2/favicons?sz=32&domain=cnbc.com" width="16" height="16" alt=""> CNBC

**Science (off by default)**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=bbc.com" width="16" height="16" alt=""> BBC · <img src="https://www.google.com/s2/favicons?sz=32&domain=npr.org" width="16" height="16" alt=""> NPR

**Culture**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=variety.com" width="16" height="16" alt=""> Variety · <img src="https://www.google.com/s2/favicons?sz=32&domain=rollingstone.com" width="16" height="16" alt=""> Rolling Stone

**Offbeat**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=upi.com" width="16" height="16" alt=""> UPI Odd News · <img src="https://www.google.com/s2/favicons?sz=32&domain=news.sky.com" width="16" height="16" alt=""> Sky News · <img src="https://www.google.com/s2/favicons?sz=32&domain=goodnewsnetwork.org" width="16" height="16" alt=""> Good News Network

**Bass & EDM**  
<img src="https://www.google.com/s2/favicons?sz=32&domain=edmsauce.com" width="16" height="16" alt=""> EDM Sauce · <img src="https://www.google.com/s2/favicons?sz=32&domain=ukf.com" width="16" height="16" alt=""> UKF · <img src="https://www.google.com/s2/favicons?sz=32&domain=edmidentity.com" width="16" height="16" alt=""> EDM Identity · <img src="https://www.google.com/s2/favicons?sz=32&domain=edmtunes.com" width="16" height="16" alt=""> EDMTunes · <img src="https://www.google.com/s2/favicons?sz=32&domain=dancingastronaut.com" width="16" height="16" alt=""> Dancing Astronaut

If the feeds are unreachable, it falls back to Hacker News.

## Requirements

- A Samsung Tizen TV in **Developer Mode** with your Mac as the host. Tested: Tizen 9.0 (2025).
- **Tizen Studio** with a Samsung certificate profile. The native presenter needs `window.priority.set`, which this certificate accepted on the test TV.
- A **Mac**: Node 20+, Xcode command-line tools (Swift), and the .NET 6 Tizen workload for `tvoverlay/`.
- For iMessage, FaceTime and Discord: give `tvmessages` **Full Disk Access** and **Contacts** in System Settings.

## Setup (short version)

1. **Configure:** `cp .env.example .env` and fill in your TV's IP, your Mac's LAN IP (`MAC_LAN_IP`), the TV's DUID (`TV_DUID`) and your signing profile.
2. **TV app:** run `./scripts/deploy.sh` to build, sign, install and launch Overscreen.
3. **Overlay presenter:** in `tvoverlay/`, run `dotnet build -c Release`, then sign with `tizen package -t tpk -s <profile>` and install with `sdb install`.
4. **Mac side:** run `tools/notify.mjs` as a LaunchAgent. Build `tools/pillshot.swift`, `tools/tvmessages.swift` and `tools/tasktitle.swift` with `swiftc -O`, and run `tools/overlay/build.mjs` for the in-page pill bundle.
5. **Hooks:** point Claude Code's `UserPromptSubmit`, `Stop` and `Notification` hooks (and Codex's) at `POST http://127.0.0.1:8795/notify`. Agents can also call `tools/tv-alert`.

Brand icons for Claude, ChatGPT, Messages, FaceTime and Discord aren't included. Generic glyphs ship instead; drop your own into `app/img/brand/`. The display font (Grift) is commercial and not included either; it falls back to Barlow and Inter.

## What it won't do

- **No root or exploits,** and no circumventing YouTube's bot checks. YouTube mixes through the Mac use stock `yt-dlp`, and the YouTube app is opened over DIAL.
- **Other apps' content is never read.** The overlay only draws on top.

## Credits

- **Origin:** forked from [rfaile313/samsucks](https://github.com/rfaile313/samsucks), a Plex client for Samsung TVs.
- **Debug-launch trick:** inspired by [TizenBrew](https://github.com/reisxd/TizenBrew) / [TizenTube](https://github.com/reisxd/TizenTube).
- **Lockscreen nebula images:** ESA/Hubble, CC BY 4.0. See `app/media/space/CREDITS.txt`.
- **Overlay investigation:** done with OpenAI Codex. Integration and the rest with Claude.

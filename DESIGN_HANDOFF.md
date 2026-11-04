# SamSUCKS frontend redesign: handoff

SamSUCKS started as a Plex client for Samsung TVs. It is now a custom launcher on a
2025 Samsung Crystal UHD TV (Tizen 9, Chromium 120). It boots into an
idle screen with music and news, then opens a Google TV-style home with every installed
app. Your job is to **redo the look and feel of the frontend**. The plumbing (radio, news,
phone remote, Agent pop-ups, app launching) works and should stay as it is.

## What the owner asked for (keep all of it)

- **Accent:** an animated Tiffany-blue gradient, never orange. Token `--tiff` in `app/css/app.css`
  (`#0ABAB5 → #81D8D0 → #2FD4C8`). Solid fallback `--coral: #0ABAB5`. The token's name is historical.
- **Display font:** `--display` (see `app/css/app.css`). The author's commercial display font is not included; the CSS falls back to Barlow Condensed. To use your own, add the file to `app/fonts/` and an `@font-face` for `'MyDisplay'`. Body text is Inter.
- **Logo:** "SAMSUCKS" styled like Samsung's wordmark: wide, heavy caps, and the **A has no crossbar**
  (an SVG Λ). Source of truth: `app/js/ui/logo.js` (`LOGO_HTML`), plus a copy in `app/index.html` for the boot screen.
- **Boot animation:** in the spirit of the Xbox 360 boot (glowing orb, swirling ribbons, a flash, then the wordmark)
  but **original**, with no Xbox or Microsoft marks or sounds. About 3.4 s, plus a synthesized chime (`app/js/ui/chime.js`).
- **Idle / boot screen** (`app/js/screens/idle.js`), what the TV shows at power-on:
  - blurred background photos that change (pre-blurred by picsum, crossfaded every 45 s)
  - a big clock and the date
  - cover art, track and artist for the radio (SomaFM Fluid, ad-free; art from iTunes search)
  - a **vertical tech-news ticker**: one headline highlighted at a time, the others greyed, fading out at top and bottom
  - a **QR code** for the phone remote
  - any arrow or OK opens Home; Play/Pause pauses the music; Back exits
- **Home** (`app/js/screens/launcher.js`): should **feel exactly like Google TV**. Tabs (For you, Apps) and the clock on top,
  a rotating featured banner, rows of 16:9 app cards with a white focus outline that scales up.
  Back, or 3 minutes without input, returns to idle.
- **Agent pop-ups** (`app/js/ui/pill.js`): Apple-style pills that drop in at the top centre when Claude Code on the
  Mac asks a question or finishes. They have an animated icon (bobbing "?" or a drawn check). Restyle freely; keep the API.
- **Never ask the user to sign in to Plex.** The Plex screens still exist (`home.js`, `detail.js`, `player.js`…) but
  are only reachable if a Plex session already exists. Leave them unless you're restyling the shared tokens.

## Hard constraints (the TV, not taste)

- **Fixed 1920×1080 canvas, driven by a D-pad remote.** No mouse or hover. Every interactive element needs an
  obvious focus state, and focus must never get lost. Navigation is arrows, OK, Back and Play/Pause.
- **Performance:** the TV GPU is weak. Measured on this TV, the first lofi design ran at **6 fps**, and the current
  idle screen runs at **53 fps**. The rules that got it there (also at the top of `app.css`):
  - animate only `transform` and `opacity`, on elements with `will-change`
  - **no** `filter: blur()`, `backdrop-filter` or animated `box-shadow`. Blur comes pre-baked in images
  - **no animated gradients on large areas or big text.** `background-position` animation repaints every frame.
    That alone took the old title from 18 fps to 7. Keep the animated `--tiff` to small elements (bars, pills, the focused tab)
  - avoid dozens of separately animated layers, and keep big masked or blended layers few and static
- **Remote focus visuals:** Google TV uses a white outline plus a small scale-up. Changing `box-shadow` on focus is fine
  (one element repaints); animating it is not.
- Plain ES modules, no framework, no npm, no build step. `scripts/deploy.sh` copies `app/` and signs it.

## Where things live

| Area | Files |
| --- | --- |
| Tokens, every style | `app/css/app.css` (sections: boot, idle, home "Google TV style", pills, plus the original Plex screens) |
| Boot markup | `app/index.html` (`#splash`) |
| Idle screen | `app/js/screens/idle.js` |
| Home | `app/js/screens/launcher.js` |
| Wordmark | `app/js/ui/logo.js` |
| Radio state (subscribe with `onTrack`) | `app/js/ui/radio.js`: don't change the stream (the previous one played ads) |
| Headlines | `app/js/ui/news.js` (The Verge RSS, Hacker News fallback) |
| Installed apps, launching | `app/js/platform/tizen.js` (`listApps`, `launchApp`, filtering out Samsung system apps) |
| Phone remote | `app/js/ui/remote.js` (TV side), `tools/remote-relay.py` and `tools/remote.html` (VPS side, the phone page) |
| Agent pop-ups | `app/js/ui/pill.js` (TV), `tools/notify.mjs` (Mac relay) |
| Screen stack, keys | `app/js/router.js`, `app/js/input.js` |

The phone remote page (`tools/remote.html`) is part of the frontend too, so feel free to redesign it. After changing
it, copy it to the VPS (see below).

## Preview, measure, deploy

- **Desktop preview:** `python3 -m http.server 8796 -d app`, then open http://127.0.0.1:8796. The page scales the
  1920×1080 layout to fit the window, and arrow keys, Enter and Esc act as the remote. In a desktop browser The Verge
  is blocked by CORS (it falls back to Hacker News) and there are no app icons. Both work on the TV.
- **On the TV:** the Mac must be at the IP you entered in the TV's Developer Mode (`MAC_LAN_IP` in `.env`); the TV only trusts that address.
  - `node tools/devserver.mjs &` and `./scripts/deploy.sh --dev` give a dev build with an fps overlay and remote JS eval.
  - `tools/tveval.sh "__bench(['right','right','left','left'], 300)"` measures fps. **Keep the idle screen and Home at about 50 fps or more.**
  - `tools/tveval.sh "__css('.x{...}')"` tries CSS live on the TV.
  - `./scripts/deploy.sh` deploys the release build when you're done (always finish with this).
- Signing uses the Samsung certificate profile named in `.env` → `TIZEN_SIGN_PROFILE`.
- **Phone remote page to the VPS:** `scp tools/remote.html $REMOTE_SSH:samsucks-remote/`, then
  `ssh $REMOTE_SSH systemctl --user restart samsucks-remote` (`REMOTE_SSH` is in `.env.example`).
- **Pop-up test:** `curl -X POST localhost:8795/notify -d '{"kind":"question","title":"Claude has a question","text":"Test"}'`.

## Known gaps worth designing for

- Cover art is missing for tracks iTunes can't match. The art box is then empty, so it needs a good placeholder.
- The featured banner uses random picsum photos for news slides. A better image source would help.
- Agent pop-ups only show while SamSUCKS is on screen, not over Netflix and other apps (a Tizen limit).
- Plain-HTTP remote relay (`REMOTE_HOST`). Moving it to HTTPS behind the VPS's existing proxy is a separate job.

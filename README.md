# Fruit Bazaar 🐵🍎

A charming **supermarket sim with legs**: stock your shelves, ring up animal
customers, expand stand by stand into a bustling market empire — and yes, you
are the monkey running it all. Farm, fetch and juggle your way to the next
upgrade. Fully **offline**: no ads, no accounts, no network calls — everything
runs from local files.

Built from the Defold original "MonkeyMart 6.9" (TinyDobbins) with its
platform SDK and analytics replaced by neutral offline stubs.

## Controls

| Device | Action |
|---|---|
| Desktop | WASD / Arrow keys to move & interact |
| Smartphone / tablet | On-screen touch joystick + buttons |

## Offline modifications

- Replaced the Poki SDK with a neutral `game-driver.js` (ad breaks resolve
  instantly, rewarded ads auto-grant the reward, banner containers hidden).
- Stubbed the GameAnalytics bridge (`gameanalytics.GameAnalytics.*`) with
  no-op functions that keep the game's config checks working offline.
- Removed the analytics script tag + all Poki metadata (dns-prefetch links,
  SDK script tags); added an in-driver application firewall so any stray
  external request (e.g. the IAP store lookup) gets an empty local answer.
- Retitled to **Fruit Bazaar**: page title, Defold project title, and the
  loading-splash artwork (byte-exact archive patch + repainted splash).
- All engine files + the Defold game archive are served locally.

## Run

Any static file server from this folder works, e.g.:

```sh
sh serve.sh          # http://localhost:8000
```

(or `python3 -m http.server`, `npx serve`, ...)

Open the printed URL in a modern browser. WebGL required.

## Structure

```
index.html              page + boot code + custom loader UI
game-driver.js          neutral offline Poki-SDK replacement
dmloader.js             Defold engine loader (unmodified)
MonkeyMart_wasm.js/.wasm  compiled engine
archive/                game data (archive_files.json + split pieces)
```

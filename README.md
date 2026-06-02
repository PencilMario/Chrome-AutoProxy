# Chrome AutoProxy

Chrome AutoProxy is a Manifest V3 proxy controller extension. It uses a generated PAC script to route traffic through proxy profiles or `DIRECT` based on master switch state, direct whitelist rules, proxy blacklist rules, profile selection, and local GeoIP host-country cache data.

## Features

- Master on/off switch in the popup.
- Multiple proxy profiles with HTTP, HTTPS, SOCKS4, and SOCKS5 endpoint formats.
- Direct whitelist rules and proxy blacklist rules.
- Per-rule proxy profile selection with `pattern => proxyId` syntax.
- PAC-based proxy takeover through `chrome.proxy.settings`.
- Local GeoIP cache backed by IndexedDB.
- Dynamic China CIDR updates from Hackl0us GeoIP2-CN plus JSON import from the options page.
- Built-in `DIRECT` handling for local/private networks and common browser security software helper hosts.
- Optional debug logging from the options page for diagnosing slow or hanging requests.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose `Load unpacked`.
4. Select this folder.

## Rule Syntax

- Exact host: `example.com`
- Wildcard suffix: `*.example.com`
- Wildcard IP: `203.0.113.*`
- Proxy rule using a specific profile: `*.video.example => jp-proxy`

Direct whitelist rules win over proxy blacklist rules. Private and local IP ranges are always routed `DIRECT`.

## Built-in Direct Hosts

Some antivirus and browser security products inject helper scripts or make reputation lookups from pages. Those requests can stall local development pages if they are sent through a proxy. Chrome AutoProxy always routes the following safety-service hosts with `DIRECT`, even when a broad proxy rule such as `*` is configured:

- `*.kis.v2.scr.kaspersky-labs.com`
- `trafficlight.bitdefender.com`
- `*.trafficlight.bitdefender.com`
- `safeweb.norton.com`
- `search.norton.com`
- `siteadvisor.com`
- `*.siteadvisor.com`
- `*.trustedsource.org`

## GeoIP2-CN Routing

GeoIP-assisted routing uses the `CN-ip-cidr.txt` feed from [Hackl0us/GeoIP2-CN](https://github.com/Hackl0us/GeoIP2-CN). That project is a China mainland IP range database, not a full country lookup database. Chrome AutoProxy stores those ranges as `CIDR: "CN"` records:

- A resolved IP that matches the CN CIDR list is treated as local and routed `DIRECT`.
- A public host that does not match the CN CIDR list remains unknown and follows the GeoIP mode fallback, which is proxy by default.
- The background service worker refreshes the CN CIDR list daily. The options page also has an `立即更新` button for manual refresh.
- Packaged seed data can be regenerated with `npm run update:geoip`.

## Debugging Slow Requests

1. Open the extension options page.
2. Enable `Debug` and save the configuration.
3. Use `Test log` to confirm the background service worker receives messages.
4. Reproduce the slow page load.
5. Use `Refresh` in the debug log panel and inspect `request-start`, `request-complete`, `geoip-*`, and `proxy-apply` entries.

Debug logs are kept in session storage and are intended for short-term diagnosis. Disable `Debug` after troubleshooting.

## Development

```powershell
npm test
npm run verify
```

<H2 div align="center"> Qashy </H2>

<div align="center">
  
private and fully open source budgeting app

### Update
I am archiving this repository as it was mostly a fun little experiment, but actually publishing or doing anything with the app carries large risks due to the nature of not properly reviewed AI generated code, and as it produced too many files for me to read I'm also unable to properly review it, you may do whatever you want with the code but I'm gonna be focusing efforts on just creating my own app

### Description
cool app, THANK YOU FOR YOUR ATTENTION TO THIS MATTER

</div>

<div align="left">

<H3 div align="center"> Architecture </H3>
Qashy is an Expo app backed by a local `FinanceRepository`. Native builds persist records in SQLite, while the PWA uses Dexie and IndexedDB. Open web tabs observe local database changes and reconcile their repository snapshots without sending finance data to a server.

<H3 div align="center"> Design </H3>

- **Type:** the app bundles [Rubik](https://fonts.google.com/specimen/Rubik) (OFL, via `@expo-google-fonts/rubik`). It covers both of the app's languages, English and Hebrew, and has tabular figures. The font files ship with the app and are precached for offline use, so it never fetches fonts from the network. The type scale and tokens are in `src/theme/tokens.ts`.
- **Surfaces:** sections are borderless tonal planes rather than bordered cards. Each screen's hero figure sits directly on the page (`PageHero`), and shadows are kept for things that genuinely float.
- **Onboarding** has five screens: welcome and language, base currency, first account, look, and review. Choosing **I already use Qashy** lets a new install pair with another device or restore a `.qashyvault` backup before anything is created.
- **Transactions** shows one calendar month at a time, with that month's totals in the header. The month is in the URL (`/transactions?month=YYYY-MM`), so it can be deep-linked. Search stays within the month unless you choose **Search all months**.

<H3 div align="center"> Sync </H3>
Qashy can sync between your own devices. It is **off until you turn it on**, there is no account, and it is
end-to-end encrypted with keys that never leave your devices.

- Devices are paired in person by scanning a QR code and confirming a 6-word code shown on both screens.
- On the same network, devices connect directly and contact no server at all.
- When they can't, sealed and padded ciphertext is left in a blind drop-box for the other device to collect.
  The server sees an opaque identifier, ciphertext, and an IP address — never who you are, what changed, or
  how much of it there is. The app ships pointed at the project's own relay; swap or blank it under
  **More → Sync → Advanced**.
- Conflicting edits merge automatically without losing either side; deletions and rejected updates are
  recorded in a visible activity log rather than applied silently.

Read [docs/sync-threat-model.md](docs/sync-threat-model.md) for the full model, including a plain list of
what sync deliberately does **not** protect against.

Sync uses WebRTC through a native module, so **Expo Go cannot run it** — use a development build.

<H3 div align="center"> Exchange rates </H3>
Accounts in another currency can convert automatically. It is the app's second deliberate network
exception, and it is **off until you turn it on**, per device.

- When enabled, Qashy asks [frankfurter.dev](https://frankfurter.dev) for the day's rates, pivoted through
  EUR for precision. Only currency codes and a date ever leave the device — never an amount, an account name,
  or anything else. Frankfurter has no key and needs no account, but it can see the device's IP address.
- The opt-in flag lives in local sync metadata, not in the settings that sync replicates to your other
  devices — turning it on is a per-device choice, not a vault-wide one.
- Turned off, or for a currency Frankfurter doesn't cover, exchange rates fall back to the manual rate you
  enter yourself under **More → Exchange rates**.

The exported web build ships a strict `Content-Security-Policy` (`src/utils/csp.ts`): `default-src 'none'`,
`script-src 'self'` plus a hash for Expo Router's one inline script, and no `'unsafe-inline'` or
`'unsafe-eval'` for script. The web keystore wraps the vault key in a non-extractable `CryptoKey`, which
stops the bytes being read but not an attacker already running script in the origin — so keeping foreign
script out is the actual defence, and `e2e/qashy.spec.ts` fails the build on any violation. `frame-ancestors`
is deliberately absent because a `<meta>` policy cannot deliver it; if you host Qashy yourself, send
`X-Frame-Options: DENY` (or `frame-ancestors 'none'`) as a real response header.

<H3 div align="center"> App Store export compliance </H3>
`app.json` declares `ITSAppUsesNonExemptEncryption: false`. That predates sync, so it has been re-reviewed
rather than inherited:

- Qashy uses only standard, published algorithms — XChaCha20-Poly1305, X25519, Ed25519, HKDF-SHA256, scrypt,
  BIP39 — through the audited `@noble`/`@scure` libraries. Nothing is proprietary and nothing is hand-rolled.
- The encryption exists solely to protect the user's own data on the user's own devices. There is no account,
  no server-side identity, and no third party whose data is being protected.

That is the standard exemption, so `false` still reads as correct. **It is a compliance declaration with your
name on it, not a code decision** — confirm it against current App Store guidance at submission time, since
the criteria change independently of this repository.

<H3 div align="center"> Roadmap </H3>
TBD

<H3 div align="center"> Installation </H3>
TBD
</div>

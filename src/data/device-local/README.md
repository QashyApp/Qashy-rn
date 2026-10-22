# Device-local stores

These modules hold per-device settings (background sync, custom themes, app language,
Overview layout, widget settings). They are stored in the `sync_meta` table, never in
`AppSettings`, and are never synced to peers. Do not move them into a synced field group.

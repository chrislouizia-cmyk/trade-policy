# Strategy UI update v7.1

This update adds:

- Compact searchable instrument selector instead of the large symbol grid.
- Custom symbols and catalog symbols update the selected list immediately.
- Maximum stop rows synchronize automatically with selected instruments.
- Removing a symbol removes it from the visible stop-limit list.
- Trading sessions display both native market time and the user's local time.
- User timezone can be detected or selected manually and is saved in localStorage.
- IANA timezones and browser Intl conversion handle daylight-saving changes.

No new Supabase migration is required for this UI update.

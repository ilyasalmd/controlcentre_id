# Privacy

Cockpit runs entirely inside Claude Code on your own computer. It collects nothing, sends nothing to its author or anyone else, and contains no analytics or telemetry.

## What it reads

To draw its tiles, Cockpit reads what Claude Code already shows you:

- how full the current chat is
- your 5-hour and weekly usage limits
- when the prompt cache was last used
- which subagents are running, and what they are doing
- your `autoCompactWindow` setting
- the names of your slash commands

It doesn't read your files, and it doesn't keep or forward your messages.

## What it stores

Three small values, kept on your machine in Claude Code's own storage for plugins:

- your glass colour and opacity
- your pinned and recent launcher commands
- whether your account uses a subscription plan or an API key, which sets how long the cache lasts

## What it sends

Cockpit makes no network requests of its own. Some buttons ask Claude Code to talk to Claude for you, exactly as if you had typed the request:

- **Compact** runs `/compact`.
- **Handoff** sends a fixed prompt asking Claude to write a handoff note.
- **Keep warm**, while it is on, sends a one-line request ("Reply with the single word: warm") shortly before the cache would expire.

These go to Anthropic through Claude Code, under your account, and Anthropic's privacy policy covers them. The full text of each is listed in the [README](README.md#what-it-does-on-your-behalf).

## Contact

Questions or concerns: [open an issue](https://github.com/ilyasalmd/controlcentre_id/issues).

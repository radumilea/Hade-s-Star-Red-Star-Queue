# Hade's Star Red Star Queue

Discord bot that organises Red Star runs for Hade's Star: a player opens a queue, others join with a
button, and the channel is notified when the squad is complete.

## Commands

| Command             | Effect                               |
| ------------------- | ------------------------------------ |
| `/rs level:<3-12>`  | Red Star matchmaking, 4 players      |
| `/drs level:<7-12>` | Dark Red Star matchmaking, 3 players |
| `/help`             | Help                                 |

The old text commands (`!rs7`, `!rsd7`, `!curcubeu …`) are retired. With `LEGACY_TEXT_COMMANDS=true`
using one gets a public reply listing the slash commands, which disappears after five minutes (at
most one such reply per channel while the previous one is visible); this needs the privileged
Message Content intent. The default is `false`: the old commands are then simply ignored and the
bot logs in without the intent.

### How a queue works

- The queue message has four buttons: **Join** (green), **Leave** (grey), **Start** (blue) and
  **Cancel Matchmaking** (red). They disappear once the queue is closed.
- Slots are a numbered list; a closed card keeps every slot and says under its title why it
  closed (full squad, started early, cancelled, expired). The
  matchmaking owner is marked with an italic "(owner)" in the slot list and gets a private
  confirmation as the reply to `/rs`.
- Anyone can press Join or Leave. Pressing them in the wrong state (already in, not in) only
  produces a private message that disappears after a minute.
- Start and Cancel work for the owner only; others get a private message naming the owner.
- If the owner leaves, the next player in join order becomes the owner. If the last player leaves,
  the queue closes as if cancelled.
- Opening a queue posts a short `@everyone` announcement ("RM Test wants to play Dark RS 9! Press
  Join to team up."), whose text is what a phone's push shows,
  and right under it the card, sent silently (Discord's component layout cannot carry plain text,
  so a push for it would be empty).
- Notices are plain text with a status dot (🟢 joined, 🟡 left, ✅ ready, 🔴 closed or expired), so
  a phone's push shows them in full. Joined / left notices end with a "See matchmaking" link.
  Players are pinged only when it matters: when the squad is ready, when ownership moves to them,
  and when the queue is closed or expires. The card shows players by name (an unpinged mention
  renders as a raw id on mobile).
- `QUEUE_REMINDER_MINUTES` before expiry (default 10, `0` disables it) the bot posts a public
  reminder with `@everyone` if the queue is still open (it says when a single slot is left). A
  queue expires after `QUEUE_TIMEOUT_MINUTES` (default 60). Times in the card are Discord
  timestamps, so every reader sees them in their own timezone.
- There is at most one open queue per channel for a given level and type: running `/rs 7` while an
  RS 7 queue is open in that channel joins it instead. One player can own at most three open queues
  per channel.
- Button presses from the same player are rate limited to one every three seconds.
- Queues live in memory. Buttons on a queue that closed in the last ten minutes answer "already
  closed"; after a restart, buttons on older queue messages are removed and the user is told to
  start a new queue. If someone deletes the queue message, the queue is dropped.

## Setup

1. Node.js 22 (see `.node-version`), then `npm ci`.
2. In the [Discord developer portal](https://discord.com/developers/applications):
   - **Bot > Privileged Gateway Intents**: enable **Message Content** only if you set
     `LEGACY_TEXT_COMMANDS=true`; without the intent that setting makes the login fail (the error
     says so). The slash commands never need it.
   - Invite the bot with the `bot` and `applications.commands` scopes and the permissions
     _View Channels_, _Send Messages_, _Send Messages in Threads_, _Read Message History_ and
     _Mention Everyone_. The bot checks these in the channel before posting a queue and names any
     that are missing.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` (the old
   variable name `DISCORDJS_BOT_TOKEN` is still accepted). Leaving an optional variable empty means
   "use the default".
4. Register the slash commands: `npm run deploy-commands`. Set `DISCORD_GUILD_ID` in `.env` to
   register them instantly in one server while developing; leave it empty for a global deployment
   (Discord can take up to an hour to show global commands). Each run replaces the whole command
   set of its scope, so removed commands disappear too. Guild and global sets are independent: a
   server that received a guild deployment shows both copies once the global one is live, until
   you run `npm run deploy-commands -- --clear-guild` with that `DISCORD_GUILD_ID`.
5. Run the bot: `npm run dev` (watch mode) or `npm run build && npm start`.

## Development

| Script                         | What it does                                           |
| ------------------------------ | ------------------------------------------------------ |
| `npm test`                     | Run the test suite (vitest)                            |
| `npm run test:coverage`        | Tests with coverage; thresholds fail the build         |
| `npm run lint`                 | ESLint with type-aware rules                           |
| `npm run typecheck`            | `tsc` over sources and tests, including port contracts |
| `npm run format`               | Prettier (`format:check` only verifies)                |
| `npm run build`                | Compile to `dist/`                                     |
| `npm run deploy-commands`      | Register slash commands from the sources               |
| `npm run deploy-commands:prod` | Same, from the compiled `dist/` (no dev dependencies)  |

The same checks run in GitHub Actions on every push and pull request, plus `npm audit` for
production dependencies. Dependabot opens update pull requests weekly.

Queues live in memory, so restart the bot gracefully: open queues are then closed on their cards
with a "the bot restarted" line and their players are told to open a new one in a few minutes
(Heroku does this with SIGTERM on every deploy). On Windows a background process cannot be
signalled, so set `DEV_SHUTDOWN_PORT=48771` in `.env` and stop the bot with
`curl -X POST http://127.0.0.1:48771/shutdown`; the endpoint only listens on loopback and is
refused when `NODE_ENV=production`.

### Layout

- `src/red-star/queue.ts`: pure matchmaking rules (join, leave, start, cancel, expire). No Discord.
- `src/red-star/render.ts`: turns a queue into the card and buttons (Discord's component layout),
  the announcement and the plain-text notices. No Discord I/O.
- `src/red-star/queue-registry.ts`: in-memory store of open queues, their timers and the
  tombstones of recently closed ones.
- `src/red-star/service.ts`: orchestrates the flow, owns timers, does all Discord I/O for queues
  through the small interfaces in `src/red-star/ports.ts`.
- `src/commands/`: slash commands and the legacy prefix parser; both call the same use-case.
- `src/discord/`: client creation, event wiring, error boundary, replies, permission checks, API
  error helpers and the command deployment logic.
- `src/app.ts`: wires everything together; `src/index.ts` only loads the environment and starts it.
- `src/config.ts`, `src/logger.ts`, `src/lifecycle.ts`, `src/scheduler.ts`: environment validation,
  pino logging (token redacted), graceful shutdown, injectable timers.

### Life of a button press

1. `events.ts` parses the button id and hands the press to the service inside the error boundary.
2. The service acknowledges the press within Discord's three-second window (`deferUpdate`), then
   applies the pure rule from `queue.ts`.
3. A rejected action (full, not owner, cooldown, closed) becomes a private, temporary message.
4. An accepted action updates the registry first, then edits the queue message, then posts the
   channel notification. A failed notification is logged but does not undo the action; a deleted
   queue message closes the queue.

## Deployment

The `Procfile` starts `node --enable-source-maps dist/index.js` as a worker; `heroku-postbuild`
compiles the sources, so the dev dependencies must be installed during the build (Heroku's
default; do not set `NPM_CONFIG_PRODUCTION=true`). `NODE_ENV=production` must be set (Heroku's Node
buildpack does it): it switches the logs to JSON and refuses `DEV_SHUTDOWN_PORT`. Set the other
variables from `.env.example`; leave `DISCORD_GUILD_ID` unset so commands are global.

First deployment of this version over the old bot, in order:

1. Enable the Message Content intent in the portal or leave `LEGACY_TEXT_COMMANDS` unset.
2. Deploy the slash commands globally (`npm run deploy-commands` from a machine whose `.env` has no
   `DISCORD_GUILD_ID`, or `heroku run npm run deploy-commands:prod`); they can take up to an hour
   to appear. Repeat only when a command definition changes.
3. Push to master; Heroku builds and restarts the worker. On a deploy the old process receives
   SIGTERM and closes its open queues on their cards before exiting.

On a shard disconnect that will not reconnect, the bot exits with code 1 so the platform restarts
it.

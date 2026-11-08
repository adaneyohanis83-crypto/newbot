# Telegram Stars Bots

A two-bot Telegram system where **Bot 1** lets users browse and select packages, and **Bot 2** delivers the correct Telegram Stars paid-channel invite link so the user can pay and join.

No database. No external payment gateway. Payment happens entirely inside Telegram via its native Stars paid-channel invite links.

---

## How it works

```
User → Bot 1 (browse packages) → deep-link → Bot 2 (Stars invite button) → Telegram Stars payment → Private channel access
```

1. User opens **Bot 1** and taps Start.
2. Bot 1 shows the available packages.
3. User picks a package and taps **Continue to payment**.
4. Bot 1 redirects to **Bot 2** via a deep link: `https://t.me/BOT2_USERNAME?start=PACKAGE_ID`
5. Bot 2 identifies the package and shows a **⭐ Pay with Telegram Stars** button.
6. The button opens the Telegram Stars paid-channel invite for that exact package.
7. Telegram handles the Stars charge and grants access to the private channel.
8. Inside that channel the user finds the links to the destination channels in their package.

> **Billing note:** Telegram paid-channel subscriptions are recurring, typically 30 days. This is not lifetime access.

---

## Project structure

```
api/
  webhook/
    bot1.js        ← Vercel serverless endpoint for Bot 1
    bot2.js        ← Vercel serverless endpoint for Bot 2

src/
  bots/
    bot1.js        ← Bot 1 update handler (welcome, menu, package details)
    bot2.js        ← Bot 2 update handler (Stars invite button)
    admin.js       ← /admin commands for Bot 1
    context.js     ← Shared bot context factory
    present.js     ← Message presentation helper (send/edit/photo)
    text.js        ← All user-facing message text
  config/
    packages.js    ← Package repository, validation, resolution
    check.js       ← Configuration inspector (used by scripts)
  http/
    process-webhook.js  ← Webhook request handler, secret check, dedupe
  services/
    telegram.js    ← Minimal Telegram Bot API client
    dedupe.js      ← In-memory update deduplication
  utils/
    validation.js  ← Package IDs, invite links, usernames, env keys
    html.js        ← HTML escaping for Telegram messages
    secrets.js     ← Timing-safe webhook secret comparison
    env-file.js    ← .env file loader for local scripts

config/
  packages.json    ← Default package catalog (no invite links here)

scripts/
  set-webhooks.js  ← Registers webhooks with Telegram
  check-config.js  ← Checks your .env against requirements

tests/
  packages.test.js ← Unit tests for package config logic
  bots.test.js     ← Integration tests for both bot handlers
  webhook.test.js  ← Unit tests for webhook processing

.env.example       ← Environment variable template
vercel.json        ← Vercel deployment config
```

---

## Quick start

### 1. Create two Telegram bots

Talk to [@BotFather](https://t.me/BotFather) on Telegram:

```
/newbot
```

Do this twice — once for Bot 1, once for Bot 2. Save both tokens.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | What to put |
|---|---|
| `BOT1_TOKEN` | Token from BotFather for Bot 1 |
| `BOT2_TOKEN` | Token from BotFather for Bot 2 |
| `BOT1_USERNAME` | Bot 1 username without @ (e.g. `MyStoreBot`) |
| `BOT2_USERNAME` | Bot 2 username without @ (e.g. `MyPaymentBot`) |
| `BOT1_WEBHOOK_SECRET` | Any random string 1–256 chars (letters, numbers, `-`, `_`) |
| `BOT2_WEBHOOK_SECRET` | A different random secret |
| `ADMIN_TELEGRAM_ID` | Your numeric Telegram user ID |
| `APP_URL` | Your Vercel deployment URL, e.g. `https://my-app.vercel.app` |
| `PACKAGE_BASIC_INVITE_LINK` | Stars paid-channel invite link for the Basic package |
| `PACKAGE_PREMIUM_INVITE_LINK` | Stars paid-channel invite link for the Premium package |
| `PACKAGE_VIP_INVITE_LINK` | Stars paid-channel invite link for the VIP package |

> **How to get your Telegram user ID:** message [@userinfobot](https://t.me/userinfobot) on Telegram.

> **How to get a Stars paid-channel invite link:** in your private Telegram channel → Manage → Subscribers → Add Subscriber → set Stars price → copy the invite link.

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Add all the environment variables from step 3 in the Vercel dashboard:  
**Project → Settings → Environment Variables**

### 5. Register webhooks

After deployment, run this once to tell Telegram where to send updates:

```bash
node scripts/set-webhooks.js
```

This script:
- Reads your `.env`
- Calls Telegram's `setWebhook` for both bots
- Verifies the webhook URLs were accepted

### 6. Check your configuration

```bash
node scripts/check-config.js
```

This reports any missing or misconfigured variables.

---

## Packages

### Editing packages

The package catalog is at `config/packages.json`. Edit it and redeploy to change the catalog.

```json
{
  "packages": [
    {
      "id": "basic",
      "name": "Basic Package",
      "description": "Basic channel access.",
      "priceLabel": "100 Stars / 30 days",
      "active": true,
      "imageUrl": "",
      "inviteLinkEnv": "PACKAGE_BASIC_INVITE_LINK"
    }
  ]
}
```

| Field | Description |
|---|---|
| `id` | Lowercase letters, numbers, `-`, `_`. Must be unique. |
| `name` | Displayed name in the bot |
| `description` | Short description shown to users |
| `priceLabel` | Display price (e.g. `"100 Stars / 30 days"`) — Telegram shows the real price when they open the invite |
| `active` | `true` to show the package, `false` to hide it |
| `imageUrl` | Optional `https://` image URL to show with the package (leave `""` for none) |
| `inviteLinkEnv` | Name of the environment variable that holds this package's invite link |

**Never put the invite link URL directly in this JSON.** Keep it in an environment variable.

### Adding a new package

1. Add an entry to `config/packages.json` with a unique `id` and set `"active": false`.
2. The `inviteLinkEnv` will automatically be `PACKAGE_<ID>_INVITE_LINK` (e.g. `PACKAGE_GOLD_INVITE_LINK` for id `gold`).
3. Add that environment variable in your `.env` file and in Vercel.
4. Set `"active": true` when ready.
5. Redeploy: `vercel --prod`

### Admin commands (via Bot 1 in Telegram)

The configured admin can manage packages by messaging Bot 1 directly:

```
/admin list                                  — List all packages
/admin show <id>                             — Show full details of a package
/admin enable <id>                           — Make a package visible
/admin disable <id>                          — Hide a package
/admin add <id> | <name> | <desc> | <price>  — Add a new package (inactive by default)
/admin set-name <id> | <new name>
/admin set-description <id> | <new description>
/admin set-price <id> | <price label>
/admin set-image <id> | <https://image-url or - to clear>
```

> Invite links are never set through chat commands. Use environment variables. `/admin show <id>` tells you which variable that package uses.

> On Vercel, file changes made through admin commands do not persist between deployments. Use them for quick adjustments, then update `config/packages.json` for permanent changes.

---

## Testing

Run the test suite (requires Node.js 20+):

```bash
npm test
```

Tests cover:
- Package ID validation
- Package sanitization and deduplication
- Invite link resolution and payability checks
- Bot 1: welcome, menu, package selection, continue-to-payment button, back/home navigation
- Bot 2: valid deep link, correct Stars invite per package, invalid/inactive/missing-link rejection
- Admin: authorization, list, show, add, enable/disable
- Webhook: method gating, secret validation, update deduplication, body parsing

### Manual testing checklist

Before going live, test each step in a real Telegram session:

- [ ] Open Bot 1 → welcome message appears
- [ ] Tap Start → package list appears
- [ ] Select a package → details and price appear
- [ ] Tap Continue to payment → opens Bot 2
- [ ] Bot 2 shows the correct package name
- [ ] Tap ⭐ Pay with Telegram Stars → correct Stars channel invite opens
- [ ] Different packages open different channel invites
- [ ] Invalid deep link to Bot 2 (e.g. `/start invalid`) → friendly error + return link
- [ ] Inactive package → not shown in menu
- [ ] Admin commands work for the configured admin ID
- [ ] Non-admin is rejected from /admin commands

> Actual Stars payment can only be tested in a real Telegram environment with a live paid-channel invite. The bots do not simulate or confirm payment — that is handled entirely by Telegram.

---

## Security notes

- Webhook requests are validated using `X-Telegram-Bot-Api-Secret-Token` via timing-safe comparison.
- Package IDs from deep links are validated server-side against the catalog. Arbitrary user input is rejected.
- Invite links are stored only in environment variables, never in source code or config JSON.
- Bot tokens and secrets are never logged.
- Admin commands are restricted to the numeric Telegram user IDs in `ADMIN_TELEGRAM_ID`.
- The in-memory deduplicator prevents double-processing of re-delivered Telegram updates.

---

## Environment variables reference

```env
# Bot tokens from BotFather
BOT1_TOKEN=
BOT2_TOKEN=

# Public usernames without @
BOT1_USERNAME=
BOT2_USERNAME=

# Webhook secrets (1–256 chars: A–Z a–z 0–9 _ -)
BOT1_WEBHOOK_SECRET=
BOT2_WEBHOOK_SECRET=

# Your Telegram user ID (numeric). Comma-separate for multiple admins.
ADMIN_TELEGRAM_ID=

# Your Vercel URL, no trailing slash
APP_URL=https://your-app.vercel.app

# Stars paid-channel invite links (one per package)
PACKAGE_BASIC_INVITE_LINK=https://t.me/+...
PACKAGE_PREMIUM_INVITE_LINK=https://t.me/+...
PACKAGE_VIP_INVITE_LINK=https://t.me/+...

# Optional: override config/packages.json entirely with inline JSON.
# Do not include invite URLs in this JSON.
# PACKAGES_JSON=
```

---

## Vercel re-deployment

```bash
vercel --prod
```

After each redeployment, webhooks stay registered — you do not need to run `set-webhooks.js` again unless the URL changes.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Bot does not respond | Webhook registered? Run `set-webhooks.js`. Check Vercel function logs. |
| "not available" on Bot 2 | Is the package `active: true`? Is the invite link env var set and a valid `https://t.me/...` URL? |
| No packages in Bot 1 menu | All packages `active: false`, or none configured. |
| Admin commands ignored | `ADMIN_TELEGRAM_ID` matches your numeric user ID? |
| Webhook returns 401 | `BOT1_WEBHOOK_SECRET` / `BOT2_WEBHOOK_SECRET` mismatch between `.env` and Vercel env vars. |
| Image not showing | `imageUrl` must be an `https://` URL, not a `t.me` URL. |
#   n e w b o t  
 
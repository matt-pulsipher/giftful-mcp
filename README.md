# Giftful MCP

A local Model Context Protocol server for logging in to Giftful and managing lists and wishes programmatically.

## What it supports

- Persistent login with automatic access-token refresh
- Native credential-vault storage on macOS, Windows, and Linux
- Browser-based authentication for the sign-in methods offered by Giftful
- List, inspect, create, patch, and soft-delete lists
- Navigate accessible lists from followed friends, followers, and following
- List, add, patch, and delete wishes
- Claim and unclaim wishes on friends' lists
- Add a product URL and let Giftful retrieve its title, price, image, and description
- Create and delete list categories
- Multiple accounts through named profiles

The password is used only for the login request and is never persisted. Only Giftful's refresh token and basic user metadata are stored. Short-lived access tokens remain in memory.

Authentication is CLI-only. The MCP server never accepts a Giftful password as a tool argument, so passwords do not enter model context or tool transcripts. When login is required, `giftful_auth_status` returns the appropriate terminal commands.

## Requirements

- Node.js 20 or newer
- A Giftful account
- Chrome, Edge, Brave, or Chromium for browser-based authentication

## Install and build

```bash
npm install
npm run check
```

Everything required to build the server is in this project directory. Authentication data is stored separately and is never committed to the repository.

## Log in securely

The recommended flow works with whichever sign-in method Giftful presents in the browser:

```bash
npm run auth -- login-browser
```

This opens Giftful in a temporary browser profile. Complete the normal login there using Apple or another available provider. The CLI reads only the resulting Giftful refresh credential, validates it with Giftful, saves it in your system credential vault, closes the browser, and deletes the temporary profile. It never receives your identity-provider password or verification codes. `login-apple` remains available as a compatibility alias.

The browser is discovered automatically. If needed, point to it explicitly with `GIFTFUL_BROWSER_EXECUTABLE=/absolute/path/to/browser`; the default login timeout is ten minutes and can be changed with `GIFTFUL_BROWSER_LOGIN_TIMEOUT_MS`.

For an email/password account, the recommended flow prompts for the password without echoing it:

```bash
npm run auth -- login YOUR_GIFTFUL_EMAIL
```

Confirm the saved session and exercise token refresh:

```bash
npm run auth -- status --validate
```

Log out and remove the persisted session:

```bash
npm run auth -- logout
```

For non-interactive automation, provide the password for that process only. It is removed from the process environment before login and is not saved:

```bash
GIFTFUL_PASSWORD='...' npm run auth -- login YOUR_GIFTFUL_EMAIL
```

Avoid putting `GIFTFUL_PASSWORD` in a long-lived shell profile or MCP configuration.

## Connect it to Codex

Build first, then register the local stdio server using an absolute path:

```bash
codex mcp add giftful -- node /ABSOLUTE/PATH/TO/giftful-mcp/dist/index.js
```

Restart Codex or begin a new thread after adding it. Check registration with:

```bash
codex mcp get giftful
```

To use a named account profile:

```bash
codex mcp add giftful-personal \
  --env GIFTFUL_PROFILE=personal \
  -- node /ABSOLUTE/PATH/TO/giftful-mcp/dist/index.js
```

Run the login command with the same profile:

```bash
GIFTFUL_PROFILE=personal npm run auth -- login-browser
# or, for a password account:
GIFTFUL_PROFILE=personal npm run auth -- login YOUR_GIFTFUL_EMAIL
```

The equivalent generic MCP client configuration is:

```json
{
  "mcpServers": {
    "giftful": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/giftful-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool                        | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `giftful_auth_status`       | Check or validate persistent authentication            |
| `giftful_logout`            | Revoke and remove the persistent session               |
| `giftful_list_lists`        | List the authenticated user's lists                    |
| `giftful_list_friend_lists` | List accessible lists from followed friends            |
| `giftful_list_followers`    | List followers without changing relationships          |
| `giftful_list_following`    | List actively followed accounts                        |
| `giftful_get_list`          | Inspect a list and its settings/categories             |
| `giftful_create_list`       | Create a wishlist, registry, or personal list          |
| `giftful_update_list`       | Patch list settings without overwriting omitted values |
| `giftful_delete_list`       | Soft-delete a list; requires `confirm=true`            |
| `giftful_list_wishes`       | List wishes and retrieve their IDs                     |
| `giftful_add_wish`          | Add manually or from a scraped product URL             |
| `giftful_update_wish`       | Patch one wish                                         |
| `giftful_delete_wish`       | Permanently delete one wish; requires confirmation     |
| `giftful_claim_wish`        | Reserve a wish in Giftful; requires confirmation       |
| `giftful_unclaim_wish`      | Release a Giftful reservation; requires confirmation   |
| `giftful_create_category`   | Add a list category                                    |
| `giftful_delete_category`   | Remove a category while keeping its wishes             |

Examples of natural requests after connecting:

- “Show my Giftful lists.”
- “Show the lists belonging to people I follow.”
- “List the people I follow, then show Alice's available wishes.”
- “Reserve wish 12345 for me.”
- “Add this URL to my Christmas list and mark it most desired.”
- “Rename my `christmas-2026` list and make link viewing private.”
- “Change wish 12345 to quantity 2.”

Claiming is Giftful's reservation mechanism: it tells other Giftful users that the
item is being handled. It does not place an order, charge a payment method, or buy
anything from the linked retailer. Claim and unclaim both require `confirm=true`.
The social tools are intentionally read-only; this MCP cannot find, follow,
unfollow, accept, decline, remove, or otherwise modify social relationships.

## Authentication storage

The default `GIFTFUL_AUTH_STORAGE=auto` uses the operating system's protected credential vault:

- macOS: Keychain item under service `com.giftful-mcp.session`
- Windows: Credential Manager
- Linux: Secret Service (normally backed by GNOME Keyring or KDE Wallet)

Overrides:

```bash
GIFTFUL_AUTH_STORAGE=system
GIFTFUL_AUTH_STORAGE=file
GIFTFUL_AUTH_FILE=/safe/absolute/path/session.json
GIFTFUL_PROFILE=work
```

System storage is the recommended cross-platform choice. On a headless Linux machine without Secret Service, opt into file storage explicitly. Its live refresh token is plaintext protected by filesystem permissions; the directory is mode `0700` and the file mode `0600`. Keep it outside repositories and untrusted backups.

## Development

```bash
npm run dev        # start stdio server from TypeScript
npm run typecheck
npm test
npm run build
npm run check:live-schema  # validates operations against Giftful; does not log in or write data
npm run check      # all of the above verification except dev
```

Tests mock Giftful login, refresh, social, and claim responses; they never require or mutate a real account. A live account smoke test is intentionally left to the owner because create/edit/delete and claim operations affect real lists.

## Compatibility

This is an independent community project and is not affiliated with or endorsed by Giftful. Changes to Giftful may occasionally require a corresponding update here.

If Giftful changes its schema or authentication flow, errors are surfaced without deleting a valid saved session for ordinary network failures; sessions are cleared only when Giftful explicitly rejects the refresh credential.

## License

[MIT](LICENSE) © 2026 Matthew Pulsipher.

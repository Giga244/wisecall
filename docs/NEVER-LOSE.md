# Nothing typed is lost, and failures reach the owner first

## Drafts

Every long text field keeps a draft while the person types:

| Field | Page | Draft key |
| --- | --- | --- |
| The question | a mentor's profile (`public/js/profile.js`) | `question:<mentor id>` |
| The answer | Dashboard → Questions for me (`public/js/dashboard.js`) | `answer:<booking id>` |
| ჩემი გზა, შენ შესახებ, the sample answer | Settings → My details (`public/js/settings-details.js`) | `story` |
| The same form on the application, step 2 | `/apply.html` (`public/js/apply.js`) | `apply-story` |
| About me | Settings → Profile (`public/js/settings-profile.js`) | `bio` |

- **Where.** In the browser (`localStorage`, `public/js/drafts.js`), and for a signed-in person on the server too (`/api/me/drafts/<key>`, `server/drafts.js`, table `user_drafts`).
- **Restored** after a failed save, a reload, a redraw of the page, coming back from a later step, or on another device. A draft goes back only over what the server still has from when it was typed: something saved since is newer and wins.
- **Cleared** only after a successful save.
- **On the server** a draft is exactly what was typed (never checked or changed), encrypted, private to its owner, deleted with the account, and deleted by itself after 60 days.

## A refused save

The reason is shown next to the field, in Georgian and English, and the field is never cleared. A request that gets no answer at all (no connection) says so plainly.

## Alerts to the owner

When a signed-in user's save is refused or fails on the server (any 4xx or 5xx answer to a request that changes something), an email goes out with the user, the page, the field and the error (`server/saveAlerts.js`).

- **To:** the `ALERT_EMAIL` setting (comma-separated). Left empty, the admins (`ADMIN_EMAILS`) get it.
- **At most** once an hour for the same user and error, and 30 an hour in all.
- **Never included:** what the user typed, passwords, or the page's query string.
- **Skipped:** admins' own requests, visitors who are not signed in, sign-in and code checks, and the drafts themselves.

## The flow tests, and the push guard

`e2e/user-flows.spec.js` runs the flows a user must never get stuck in, in a real browser:

1. Sign-up, then About me.
2. A mentor application from the first step to "sent".
3. An approved mentor's ჩემი გზა from the profile-update email and the dashboard card, then new directions sent for a check.
4. Editing My details.
5. Password reset from the email link.
6. A student asks a question and the mentor answers.

Each checks that the saved data appears on the profile or the admin page, and that typed text survives a reload.

```bash
npm run test:flows
```

`.githooks/pre-push` runs these before every push and blocks the push if one fails (`npm install` installs the hook). It needs the test database running, like every other test.

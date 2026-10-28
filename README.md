# LiveLib

## Email registration

Copy `.env.example` to `.env` and set your SMTP provider's host, port, username, password, and sender address. Set `SESSION_SECRET` to a private random value of at least 8 characters. For stronger security, use a longer value; this command generates a 64-character secret:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep `.env` private; it is excluded from Git. Restart the server after changing environment settings:

```sh
npm install
npm start
```

Open `/auth.html` to sign up or sign in. New accounts receive a six-digit code to verify their email; sign-ins also require a one-time code after the password is confirmed. Enter the code on `/request.html`. Codes expire after 10 minutes and can be requested again after the resend cooldown. Passwords are stored as scrypt hashes.

SMTP must be configured for signup, sign-in codes, and code resends. The authentication session uses an HTTP-only cookie; set `NODE_ENV=production` when serving the site over HTTPS.

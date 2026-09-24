# Publishing Wisecall

The full, up-to-date launch guide is in **[DEPLOY.md](DEPLOY.md)**: database, environment variables, email domain, custom domain, Stripe live mode, backups, and a launch checklist.

Short version of the order to do things in:

1. Try everything locally, including Stripe test mode ([DEPLOY.md, sections 1 and 2](DEPLOY.md#1-try-it-locally-first)).
2. Put the code on GitHub, create a PostgreSQL database and a web service on Render.
3. Verify your email domain and connect your own domain.
4. Switch Stripe to live mode, and test with a small real payment.
5. Have a lawyer review the Terms and Privacy pages ([LEGAL-REVIEW.md](LEGAL-REVIEW.md)).

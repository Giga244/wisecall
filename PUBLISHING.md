# Publishing Wisecall

The full, up-to-date launch guide is in **[DEPLOY.md](DEPLOY.md)**: bank account and keys, database, environment variables, callback URL, email domain, custom domain, backups, and a launch checklist.

Short version of the order to do things in:

1. Try everything locally with the fake test bank ([DEPLOY.md, section 1](DEPLOY.md#1-try-it-locally)).
2. Open a merchant account with Bank of Georgia or TBC Bank and get API keys ([section 2](DEPLOY.md#2-get-your-bank-account-and-api-keys)), then test with the bank's test access ([section 3](DEPLOY.md#3-test-the-bank-connection)).
3. Put the code on GitHub, create a PostgreSQL database and a web service on Render.
4. Verify your email domain and connect your own domain.
5. Register the callback URL with the bank, and test with a small real payment, a refund and a payout.
6. Have a lawyer review the Terms and Privacy pages and the money flow ([LEGAL-REVIEW.md](LEGAL-REVIEW.md)).

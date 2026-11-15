# Bug: "Unknown error" when a mentor switches email

**What happened (real mentor, a senior lawyer):**
1. He started the mentor application with his work email (Microsoft / Outlook). The code was delivered (Resend shows "delivered"), but it reached his inbox hours later.
2. He then used his Gmail, got the code and verified it.
3. He went back to use his work email instead. The site showed **"Unknown error"**. It happens every time he enters the new email.
4. The late code to his work email also no longer works.

## What to do
1. **Reproduce it** in a test: start with email A (unverified, code sent), verify email B, then try to switch to email A. Also try the reverse, and an email that already belongs to another account.
2. **Find the cause** in the code and the server logs (Render logs if you can read them; don't run anything on the live database). Tell me the cause in one or two sentences.
3. **Fix it**, so switching email works:
   - The new email gets a new code, and everything already filled in is kept.
   - If the email already belongs to another account, say so clearly: KA "ეს ელ-ფოსტა უკვე გამოყენებულია. შედი ამ ანგარიშით ან გამოიყენე სხვა ელ-ფოსტა." / EN "This email is already in use. Log in with it or use another email."
   - A code stays valid for 24 hours, and a newer code doesn't cancel the last 3 codes. Keep the attempt and rate limits.
4. **No raw "Unknown error" anywhere on the site.** Search for every place it can appear (client and server) and replace it with a clear Georgian message saying what to do, for example: KA "რაღაც არ გამოვიდა. სცადე თავიდან, ან მოგვწერე: {support email}" / EN "Something went wrong. Try again, or write to us: {support email}". Log the real error on the server with a short reference code and show that code to the user, so support can find it.
5. **Help this mentor finish:** tell me whether his half-finished application (work email) can just continue after the fix, or whether something needs to be cleaned up. Don't change live data yourself. Write me the exact steps, and I'll decide.

## Tests
- Switching from email A to B and back works, and nothing filled in is lost.
- An email used by another account shows the clear message.
- A code still works after 23 hours.
- No response or screen contains the text "Unknown error".
- Run all unit and e2e tests. Don't skip or delete any.

Commit "Fix: switching email, no more Unknown error" and push. Then give me a short report: the cause, what you changed, the test results, and the steps for this mentor.

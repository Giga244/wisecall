// Admin: "რჩევები", the articles (docs/CLAUDE-CODE-SEO.md 5; the rules are in server/articles.js). Admins only, like every /api/admin route.
//   GET    /api/admin/articles                 every article, drafts first
//   GET    /api/admin/articles/:id             one, with its full text
//   POST   /api/admin/articles                 a new draft
//   PATCH  /api/admin/articles/:id             save (a published article must stay whole)
//   POST   /api/admin/articles/:id/publish     make it public (the only way an article ever becomes public)
//   POST   /api/admin/articles/:id/unpublish   take it down (a draft again)
//   DELETE /api/admin/articles/:id             delete a draft
const express = require('express');
const { requireAuth } = require('../auth');
const { requireAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const articles = require('../articles');

const router = express.Router();

// What an article's rules refuse is said with its code (and the box it is about); anything else is a real error.
const handled = (fn) => asyncHandler(async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!(e instanceof articles.ArticleError)) throw e;
    const status = e.code === 'not_found' ? 404 : (e.code === 'published' || e.code === 'slug_taken' ? 409 : 400);
    res.status(status).json({ error: e.code, ...(e.field ? { field: e.field } : {}), ...(e.max ? { max: e.max } : {}), ...(e.problems ? { problems: e.problems } : {}) });
  }
});
// (with what still stands between the article and Publish, so the form can say it before the button is pressed)
const withProblems = (a) => ({ ...a, problems: articles.problems(a) });

router.get('/articles', requireAuth, requireAdmin, handled(async (req, res) => {
  const list = await articles.all();
  res.json({ limits: articles.LIMITS, articles: list.map((a) => ({ id: a.id, slug: a.slug, status: a.status, category: a.category, authorName: a.authorName, date: a.date, langs: a.langs,
    title: a.ka.title || a.en.title, updatedAt: a.updatedAt, publishedAt: a.publishedAt, everPublished: a.everPublished, problems: articles.problems(a) })) });
}));

router.get('/articles/:id', requireAuth, requireAdmin, handled(async (req, res) => {
  const a = await articles.byId(req.params.id);
  if (!a) throw new articles.ArticleError('not_found');
  res.json({ limits: articles.LIMITS, article: withProblems(a) });
}));

router.post('/articles', requireAuth, requireAdmin, handled(async (req, res) => {
  res.status(201).json({ article: withProblems(await articles.create(req.body, req.adminUser.id)) });
}));

router.patch('/articles/:id', requireAuth, requireAdmin, handled(async (req, res) => {
  res.json({ article: withProblems(await articles.update(req.params.id, req.body)) });
}));

router.post('/articles/:id/publish', requireAuth, requireAdmin, handled(async (req, res) => {
  res.json({ article: withProblems(await articles.publish(req.params.id, req.adminUser.id)) });
}));

router.post('/articles/:id/unpublish', requireAuth, requireAdmin, handled(async (req, res) => {
  res.json({ article: withProblems(await articles.unpublish(req.params.id)) });
}));

router.delete('/articles/:id', requireAuth, requireAdmin, handled(async (req, res) => {
  await articles.remove(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;

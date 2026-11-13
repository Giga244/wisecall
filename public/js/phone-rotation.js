// The order the home page's phone plays its questions and answers in (docs/CLAUDE-CODE-RANDOM-PHONE.md), kept apart from the drawing so the
// unit tests can run it (tests/random-phone.test.js):
// - real answers first (the server sends those both people agreed to show, the pinned one first), in a random order;
// - with fewer than three real ones, an example fills the rotation (the page marks it "Example": no name, no badge, no rating); from three on, none;
// - never two of the same field in a row (as far as the answers allow), also from the end of one round to the start of the next: when the
//   rest of a round would only bring the same field again, a new round starts;
// - a pinned answer comes first, on the first round only.
(function (root) {
  const MIN_REAL = 3;
  // The example: a medicine question and its answer (their words: home2.ex.1.q / .a in the dictionaries).
  const EXAMPLES = [{ n: 1, niche: 'medicine', example: true }];

  // One round: every item once. Groups in order of preference (the real ones, then the examples): the next item is from the first group
  // that has one of another field than the one before; among those, any one at random, as long as the rest can still be laid out with no
  // two of a field side by side (else one of the field that is most common, so the last ones are not all of one field).
  const countsOf = (items) => { const c = {}; items.forEach((x) => { c[x.niche] = (c[x.niche] || 0) + 1; }); return c; };
  // (can these items follow one of field "prev" with no two of a field side by side?)
  function fits(items, prev) {
    const c = countsOf(items);
    return Object.entries(c).every(([niche, k]) => k <= (niche === prev ? Math.floor(items.length / 2) : Math.ceil(items.length / 2)));
  }
  function arrange(groups, prev, random) {
    const left = groups.map((g) => g.slice());
    const out = [];
    const total = () => left.reduce((n, g) => n + g.length, 0);
    while (total()) {
      const all = left.flat();
      const counts = countsOf(all);
      let gi = left.findIndex((g) => g.some((x) => x.niche !== prev));
      let pool;
      if (gi === -1) { gi = left.findIndex((g) => g.length); pool = left[gi]; } // (only one field left: unavoidable)
      else pool = left[gi].filter((x) => x.niche !== prev);
      const order = pool.map((x) => [random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
      let pick = order.find((x) => fits(all.filter((y) => y !== x), x.niche));
      if (!pick) {
        const most = Math.max(...pool.map((x) => counts[x.niche]));
        pick = order.find((x) => counts[x.niche] === most);
      }
      left[gi].splice(left[gi].indexOf(pick), 1);
      out.push(pick);
      prev = pick.niche;
    }
    return out;
  }

  // data: what /api/home-qa sent ({ pinned, answers }). Returns { next(), examples }: next() gives the item to play now, forever.
  function create(data, random = Math.random) {
    const answers = ((data && data.answers) || []).filter((a) => a && a.question && a.answer);
    const pinned = data && data.pinned ? answers.find((a) => a.id === data.pinned) : null;
    const examples = answers.length < MIN_REAL;
    const groups = examples ? [answers, EXAMPLES] : [answers];
    let queue = [];
    let last = null;
    let first = true;
    function next() {
      if (!queue.length) {
        if (first && pinned) queue = [pinned, ...arrange(groups.map((g) => g.filter((x) => x !== pinned)), pinned.niche, random)];
        else queue = arrange(groups, last ? last.niche : null, random);
        first = false;
      } else if (last && queue[0].niche === last.niche) {
        const other = queue.findIndex((x) => x.niche !== last.niche);
        if (other > 0) queue.unshift(queue.splice(other, 1)[0]);
        else queue = arrange(groups, last.niche, random); // (only the same field left in this round)
      }
      last = queue.shift();
      return last;
    }
    // A field chosen on the page (docs/CLAUDE-CODE-COMPACT-HOME.md): one of its items now, if there is one (else null); the rotation goes on
    // after it without playing it again this round.
    function jump(matches) {
      const found = groups.flat().filter((x) => matches(x));
      if (!found.length) return null;
      const pick = found[Math.floor(random() * found.length)];
      queue = queue.filter((x) => x !== pick);
      first = false;
      last = pick;
      return pick;
    }
    // (how many items one round plays: the chat's dots)
    const size = groups.reduce((n, g) => n + g.length, 0);
    return { next, jump, size, examples };
  }

  const api = { create, arrange, EXAMPLES, MIN_REAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WisecallPhoneRotation = api;
})(typeof window !== 'undefined' ? window : this);

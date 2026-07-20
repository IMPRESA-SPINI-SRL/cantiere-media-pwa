import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_FILTERS } from '../js/config.js';
import { chooseFavoriteQueryPlan, chooseMediaQueryPlan } from '../js/db.js';

const base = { siteId: 'site-1', mediaType: MEDIA_FILTERS.BOTH, authorId: 'all' };

test('media query planner selects the narrowest compound index', () => {
  assert.deepEqual(chooseMediaQueryPlan(base), {
    indexName: 'siteDate',
    prefix: ['site-1'],
  });
  assert.equal(chooseMediaQueryPlan({ ...base, mediaType: 'photo' }).indexName, 'siteTypeDate');
  assert.equal(chooseMediaQueryPlan({ ...base, authorId: 'user-1' }).indexName, 'siteAuthorDate');
  assert.equal(chooseMediaQueryPlan({ ...base, mediaType: 'video', authorId: 'user-1' }).indexName, 'siteTypeAuthorDate');
});

test('favorite query planner includes user and context in every prefix', () => {
  const plan = chooseFavoriteQueryPlan({
    ...base,
    userId: 'user-1',
    context: 'archive',
    mediaType: 'photo',
    authorId: 'user-2',
  });
  assert.equal(plan.indexName, 'userContextSiteTypeAuthorDate');
  assert.deepEqual(plan.prefix, ['user-1', 'archive', 'site-1', 'photo', 'user-2']);
});

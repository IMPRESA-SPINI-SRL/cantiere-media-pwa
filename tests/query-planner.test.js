import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SITES_ID, MEDIA_FILTERS } from '../js/config.js';
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


test('all sites query planner usa indici globali senza scansione completa', () => {
  const all = { ...base, siteId: ALL_SITES_ID };
  assert.deepEqual(chooseMediaQueryPlan(all), { indexName: 'allDate', prefix: [] });
  assert.deepEqual(chooseMediaQueryPlan({ ...all, mediaType: 'photo' }), {
    indexName: 'allTypeDate',
    prefix: ['photo'],
  });
  assert.deepEqual(chooseMediaQueryPlan({ ...all, authorId: 'user-1' }), {
    indexName: 'allAuthorDate',
    prefix: ['user-1'],
  });
  assert.deepEqual(chooseMediaQueryPlan({ ...all, mediaType: 'video', authorId: 'user-1' }), {
    indexName: 'allTypeAuthorDate',
    prefix: ['video', 'user-1'],
  });
});

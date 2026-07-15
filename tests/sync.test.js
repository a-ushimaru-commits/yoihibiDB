const test = require('node:test');
const assert = require('node:assert/strict');
const { wrapStoreWithSync, debounce } = require('../js/sync.js');

function fakeStore() {
  let value = 0;
  return {
    setValue(v) { value = v; },
    bumpValue() { value += 1; },
    getState() { return { value }; },
    exportJSON() { return JSON.stringify({ value }); },
  };
}

test('wrapStoreWithSync calls onChange with the latest exportJSON() after a mutating call', () => {
  const store = fakeStore();
  const calls = [];
  const wrapped = wrapStoreWithSync(store, json => calls.push(json));

  wrapped.setValue(42);

  assert.deepEqual(calls, [JSON.stringify({ value: 42 })]);
});

test('wrapStoreWithSync calls onChange once per mutating call, reflecting state at that point', () => {
  const store = fakeStore();
  const calls = [];
  const wrapped = wrapStoreWithSync(store, json => calls.push(json));

  wrapped.bumpValue();
  wrapped.bumpValue();

  assert.deepEqual(calls, [JSON.stringify({ value: 1 }), JSON.stringify({ value: 2 })]);
});

test('wrapStoreWithSync does not call onChange for getState or exportJSON', () => {
  const store = fakeStore();
  const calls = [];
  const wrapped = wrapStoreWithSync(store, json => calls.push(json));

  wrapped.getState();
  wrapped.exportJSON();

  assert.deepEqual(calls, []);
});

test('wrapStoreWithSync passes through return values and getState/exportJSON results unchanged', () => {
  const store = fakeStore();
  const wrapped = wrapStoreWithSync(store, () => {});

  wrapped.setValue(7);
  assert.deepEqual(wrapped.getState(), { value: 7 });
  assert.equal(wrapped.exportJSON(), JSON.stringify({ value: 7 }));
});

test('debounce collapses rapid calls into a single invocation with the last arguments', async () => {
  const calls = [];
  const debounced = debounce(arg => calls.push(arg), 20);

  debounced('a');
  debounced('b');
  debounced('c');

  assert.deepEqual(calls, []); // not yet fired
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(calls, ['c']);
});

test('debounce fires again for calls made after the wait has elapsed', async () => {
  const calls = [];
  const debounced = debounce(arg => calls.push(arg), 20);

  debounced('first');
  await new Promise(r => setTimeout(r, 50));
  debounced('second');
  await new Promise(r => setTimeout(r, 50));

  assert.deepEqual(calls, ['first', 'second']);
});

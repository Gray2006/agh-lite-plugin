import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from '../lib/index.js';

test('apply registers tools and proxy stats works without upstream', async () => {
  const tools = [];
  const routes = [];
  const ctx = {
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            tools.push(definition);
            return () => {};
          },
        };
      }
      return undefined;
    },
    inject(_names, callback) {
      callback({
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
      });
    },
    effect(fn) {
      fn();
    },
  };

  apply(ctx, { days: 30 });
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['token_audit', 'token_proxy'],
  );
  assert.equal(routes.length, 6);
  assert.deepEqual(
    routes.map((route) => route.path).sort(),
    [
      '/agh-lite-plugin/audit',
      '/agh-lite-plugin/cleanup',
      '/agh-lite-plugin/optimize',
      '/agh-lite-plugin/ping',
      '/agh-lite-plugin/proxy',
      '/agh-lite-plugin/runall',
    ],
  );

  const stats = await tools.find((tool) => tool.name === 'token_proxy').execute({ action: 'stats' });
  assert.match(stats.text, /未启动/);
});

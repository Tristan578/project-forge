/** Pin real staging/preview health gates rather than Deployment Protection availability. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function workflow(name) { return readFileSync(new URL('../../.github/workflows/' + name + '.yml', import.meta.url), 'utf8'); }
function job(source, name) {
  // Windows checkouts may use CRLF; preserve strict YAML line assertions.
  source = source.replaceAll('\r\n', '\n');
  const block = source.split('  ' + name + ':\n')[1]?.split(/\n  [a-z][a-z0-9-]*:\n/)[0];
  assert.ok(block, 'missing job ' + name);
  return block;
}
function step(source, name) {
  const block = source.split('      - name: ' + name + '\n')[1]?.split(/\n      - /)[0];
  assert.ok(block, 'missing step ' + name);
  return block;
}
for (const lineEnding of ['LF', 'CRLF']) {
  for (const [file, name, healthName, pullName] of [
    ['cd', 'deploy-staging', 'Post-deploy health check (staging)', 'Link Vercel project (staging)'],
    ['ci', 'preview-deploy', 'Verify preview runtime health', 'Pull Vercel environment (preview)'],
  ]) {
    test(name + ' requires scoped access before deploy and checks runtime identity/payments (' + lineEnding + ')', () => {
      const raw = workflow(file).replace(/\r?\n/g, lineEnding === 'LF' ? '\n' : '\r\n');
      const source = job(raw, name);
      const access = step(source, 'Require staging deployment verification access');
      assert.match(access, /^\s+STAGING_BYPASS: \$\{\{ secrets[.]VERCEL_AUTOMATION_BYPASS_STAGING \}\}$/m);
      assert.match(access, /^\s+if \[ -z "\$STAGING_BYPASS" \]; then$/m);
      assert.match(access, /^\s+exit 1$/m);
      assert.doesNotMatch(access, /^\s+(if:|continue-on-error:)/m);
      assert.ok(source.indexOf('Require staging deployment verification access') < source.indexOf(pullName));
      const health = step(source, healthName);
      assert.doesNotMatch(health, /^\s+(if:|continue-on-error:)/m);
      assert.match(health, /^        run: bash scripts\/post-deploy-health-check[.]sh "\$DEPLOY_URL"$/m);
      assert.match(health, /^\s+HEALTH_CHECK_EXPECT_COMMIT: \$\{\{ github[.]sha \}\}$/m);
      assert.match(health, /^\s+HEALTH_CHECK_EXPECT_ENVIRONMENT: staging$/m);
      assert.match(health, /^\s+HEALTH_CHECK_REQUIRE_SERVICES: 'Payments \(Stripe\)'$/m);
      assert.match(health, /^\s+VERCEL_AUTOMATION_BYPASS: \$\{\{ secrets[.]VERCEL_AUTOMATION_BYPASS_STAGING \}\}$/m);
      assert.match(health, /^\s+VERCEL_AUTOMATION_BYPASS_ORIGIN: \$\{\{ steps[.]deploy[.]outputs[.]url \}\}$/m);
      if (file === 'ci') {
        assert.ok(source.indexOf('      - name: ' + healthName) < source.indexOf('      - name: Comment preview URL on PR'));
        assert.doesNotMatch(source, /Verify preview is reachable|expected Vercel Deployment Protection/);
        assert.doesNotMatch(step(source, pullName), /working-directory: web/);
      }
    });
  }
}

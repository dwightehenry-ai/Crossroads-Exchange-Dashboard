'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

test('ALL and single-screen dashboards use the compact logo-to-kicker spacing', () => {
  const compactRule = /body\.screen-all \.service-kicker,\s*body\.screen-single \.service-kicker \{ margin-top: \.22rem; \}/;
  const compactRulePosition = styles.search(compactRule);
  const portraitMediaPosition = styles.indexOf('@media (orientation: portrait) and (max-width: 1100px)');

  assert.notEqual(compactRulePosition, -1);
  assert.ok(compactRulePosition < portraitMediaPosition);
});

test('logo width and height declarations remain unchanged', () => {
  assert.match(
    styles,
    /\.exchange-logo-image \{\s*width: clamp\(10rem, 20vmin, 16rem\);\s*height: auto;/
  );
  assert.match(
    styles,
    /body\.screen-single \.exchange-logo-image \{\s*width: clamp\(5rem, 14vw, 8rem\);\s*height: auto;/
  );
  assert.match(
    styles,
    /body\.screen-all \.exchange-logo-image \{\s*width: clamp\(5\.4rem, 8vw, 7\.2rem\);\s*height: auto;/
  );
});

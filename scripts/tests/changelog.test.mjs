import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSemVer, parseChangelogSource, renderChangelog } from '../changelog.mjs'

test('compareSemVer orders stable and prerelease versions', () => {
  const versions = ['2.0.0', '1.10.0', '2.0.0-next.10', '2.0.0-next.2', '1.9.9']
  versions.sort(compareSemVer)
  assert.deepEqual(versions, ['1.9.9', '1.10.0', '2.0.0-next.2', '2.0.0-next.10', '2.0.0'])
})

test('parseChangelogSource validates filename, date, and content', () => {
  const valid = '---\nversion: 2.0.0\ndate: 2026-09-09\n---\n### Added\n\n- Secure releases.'
  assert.equal(parseChangelogSource('2.0.0.md', valid).version, '2.0.0')
  assert.throws(() => parseChangelogSource('2.0.1.md', valid), /declares version/)
  assert.throws(() => parseChangelogSource('2.0.0.md', valid.replace('2026-09-09', '2026-02-30')), /calendar date/)
  assert.throws(() => parseChangelogSource('2.0.0.md', valid.replace('- Secure releases.', '')), /empty release notes/)
})

test('renderChangelog is deterministic and SemVer ordered', () => {
  const output = renderChangelog([
    { version: '2.0.0-next.1', date: '2026-09-08', body: 'Preview.' },
    { version: '2.0.0', date: '2026-09-09', body: 'Stable.' },
  ])
  assert.ok(output.indexOf('## 2.0.0 -') < output.indexOf('## 2.0.0-next.1 -'))
  assert.equal(
    output,
    renderChangelog([
      { version: '2.0.0-next.1', date: '2026-09-08', body: 'Preview.' },
      { version: '2.0.0', date: '2026-09-09', body: 'Stable.' },
    ]),
  )
})

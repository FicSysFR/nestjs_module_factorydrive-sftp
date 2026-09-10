import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareRelease, validateReleaseRequest } from '../release.mjs'

test('validateReleaseRequest accepts only stable versions and known channels', () => {
  assert.doesNotThrow(() => validateReleaseRequest('2.0.0', 'latest'))
  assert.doesNotThrow(() => validateReleaseRequest('2.1.0', 'next'))
  assert.throws(() => validateReleaseRequest('2.0.0-next.1', 'next'), /exact stable/)
  assert.throws(() => validateReleaseRequest('2.0', 'latest'), /Invalid SemVer/)
  assert.throws(() => validateReleaseRequest('2.0.0', 'beta'), /Unsupported npm channel/)
})

test('prepareRelease updates the manifest once and remains idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factorydrive-satellite-release-test-'))
  try {
    await mkdir(join(root, 'changelog'))
    await writeFile(join(root, 'package.json'), '{"name":"satellite","version":"1.0.0"}\n')
    await writeFile(join(root, 'changelog', '2.0.0.md'), '---\nversion: 2.0.0\ndate: 2026-09-09\n---\n### Added\n\n- Release notes.\n')

    const first = await prepareRelease(root, '2.0.0', 'latest')
    const firstChangelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
    const second = await prepareRelease(root, '2.0.0', 'latest')
    assert.equal(first.manifestChanged, true)
    assert.equal(second.manifestChanged, false)
    assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '2.0.0')
    assert.equal(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), firstChangelog)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePackOutput, validateSatelliteManifest, validateSatellitePack } from '../package.mjs'

const requiredFiles = [{ path: 'LICENSE' }, { path: 'README.md' }, { path: 'dist/index.d.ts' }, { path: 'dist/index.js' }, { path: 'package.json' }]

test('parsePackOutput supports npm 11 arrays and npm 12 maps', () => {
  const report = { name: '@ficsysfr/nestjs_module_factorydrive-sftp', version: '2.0.0' }
  assert.deepEqual(parsePackOutput(JSON.stringify([report])), report)
  assert.deepEqual(parsePackOutput(JSON.stringify(report)), report)
  assert.deepEqual(parsePackOutput(JSON.stringify({ [report.name]: report })), report)
})

test('parsePackOutput rejects invalid or ambiguous reports', () => {
  for (const value of [[], [{}, {}], {}, { one: {}, two: {} }, null, 'report', 1, [[]]]) {
    assert.throws(() => parsePackOutput(JSON.stringify(value)), /unexpected report/)
  }
})

test('validateSatelliteManifest enforces identity, SemVer, and core major', () => {
  assert.doesNotThrow(() =>
    validateSatelliteManifest({
      name: '@ficsysfr/nestjs_module_factorydrive-sftp',
      version: '2.0.0',
      repository: 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp.git',
      homepage: 'https://ficsysfr.github.io/nestjs_module_factorydrive/guide/drivers',
      bugs: { url: 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/issues' },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
      peerDependencies: { '@ficsysfr/nestjs_module_factorydrive': '^2.0.0' },
    }),
  )
  assert.throws(
    () =>
      validateSatelliteManifest({
        name: '@ficsysfr/nestjs_module_factorydrive-sftp',
        version: '2.0.0',
        repository: 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp.git',
        homepage: 'https://ficsysfr.github.io/nestjs_module_factorydrive/guide/drivers',
        bugs: { url: 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/issues' },
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
        peerDependencies: { '@ficsysfr/nestjs_module_factorydrive': '^1.0.0' },
      }),
    /core peer dependency/,
  )
  assert.throws(
    () =>
      validateSatelliteManifest({
        name: '@ficsysfr/nestjs_module_factorydrive-sftp',
        version: '2.0.0',
        repository: 'https://github.com/tacxou/nestjs_module_factorydrive-sftp.git',
        homepage: 'https://ficsysfr.github.io/nestjs_module_factorydrive/guide/drivers',
        bugs: { url: 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/issues' },
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
        peerDependencies: { '@ficsysfr/nestjs_module_factorydrive': '^2.0.0' },
      }),
    /canonical URLs/,
  )
})

test('validateSatellitePack rejects forbidden and non-allowlisted files', () => {
  assert.doesNotThrow(() => validateSatellitePack({ size: 100, files: requiredFiles }))
  assert.throws(() => validateSatellitePack({ size: 100, files: [...requiredFiles, { path: 'src/index.ts' }] }), /forbidden path/)
  assert.throws(() => validateSatellitePack({ size: 100, files: [...requiredFiles, { path: 'notes.txt' }] }), /non-allowlisted path/)
})

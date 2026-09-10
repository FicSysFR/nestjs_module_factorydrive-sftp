import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_NAME = '@ficsysfr/nestjs_module_factorydrive-sftp'
const CORE_NAME = '@ficsysfr/nestjs_module_factorydrive'
const REPOSITORY_URL = 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp.git'
const HOMEPAGE_URL = 'https://ficsysfr.github.io/nestjs_module_factorydrive/guide/drivers'
const BUGS_URL = 'https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/issues'
const REQUIRED_FILES = ['LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json']
const FORBIDDEN_PATHS = /(?:^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|\.npmrc$|\.tsbuildinfo$|node_modules(?:\/|$)|src(?:\/|$)|tests?(?:\/|$)|specs?(?:\/|$)|[^/]+\.(?:key|pem)$)/i
const ALLOWED_PATHS = /^(?:LICENSE|README\.md|package\.json|dist\/(?:LICENSE|README\.md|package\.json|.+\.(?:js|js\.map|d\.ts|d\.ts\.map)))$/

function run(command, args, cwd, options = {}) {
  let resolvedCommand = command
  if (process.platform === 'win32' && (command === 'npm' || command === 'yarn')) {
    const lookup = spawnSync('where.exe', [`${command}.cmd`], { cwd, encoding: 'utf8' })
    resolvedCommand = lookup.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `${command}.cmd`
  }
  const windowsCommand = [resolvedCommand, ...args].map((value) => `"${value.replaceAll('"', '""')}"`).join(' ')
  const result =
    process.platform === 'win32'
      ? spawnSync(windowsCommand, { cwd, encoding: 'utf8', shell: true, ...options })
      : spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, ...options })
  if (result.status !== 0) throw new Error(`${command} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  return result.stdout.trim()
}

export function validateSatelliteManifest(manifest) {
  if (manifest.name !== PACKAGE_NAME || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Unexpected package identity: ${manifest.name}@${manifest.version}`)
  }
  if (manifest.repository !== REPOSITORY_URL || manifest.homepage !== HOMEPAGE_URL || manifest.bugs?.url !== BUGS_URL) {
    throw new Error(`Unexpected canonical URLs for ${manifest.name}`)
  }
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
    throw new Error(`Unexpected npm publication metadata for ${manifest.name}`)
  }
  const expectedCorePeer = `^${manifest.version.split('.')[0]}.0.0`
  if (manifest.peerDependencies?.[CORE_NAME] !== expectedCorePeer) {
    throw new Error('The core peer dependency must match the satellite major release')
  }
}

export function validateSatellitePack(report) {
  if (report.size > 1024 * 1024) throw new Error('Tarball exceeds 1 MiB')
  const paths = report.files.map((file) => file.path.replaceAll('\\', '/'))
  for (const file of REQUIRED_FILES) if (!paths.includes(file)) throw new Error(`Tarball is missing ${file}`)
  const forbidden = paths.find((path) => FORBIDDEN_PATHS.test(path))
  if (forbidden) throw new Error(`Tarball contains forbidden path ${forbidden}`)
  const unexpected = paths.find((path) => !ALLOWED_PATHS.test(path))
  if (unexpected) throw new Error(`Tarball contains non-allowlisted path ${unexpected}`)
}

export async function packageAndAudit(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
  validateSatelliteManifest(manifest)

  const artifactsRoot = join(projectRoot, '.artifacts', 'npm')
  await rm(artifactsRoot, { recursive: true, force: true })
  await mkdir(artifactsRoot, { recursive: true })
  run('yarn', ['build'], projectRoot)
  const report = JSON.parse(run('npm', ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', artifactsRoot], projectRoot))[0]
  validateSatellitePack(report)

  const tarball = join(artifactsRoot, report.filename)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'factorydrive-satellite-audit-'))
  try {
    await writeFile(join(temporaryRoot, 'package.json'), '{"name":"factorydrive-satellite-audit","private":true,"type":"module"}')
    const coreDevelopmentSpec = manifest.devDependencies?.[CORE_NAME]
    if (!coreDevelopmentSpec) throw new Error('A core development dependency is required for package smoke tests')
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--legacy-peer-deps',
        `${CORE_NAME}@${coreDevelopmentSpec}`,
        tarball,
        '@nestjs/common@11',
        '@nestjs/core@11',
        'reflect-metadata@0.2',
        'rxjs@7',
        'typescript@5',
      ],
      temporaryRoot,
    )

    const importScript = `import('${PACKAGE_NAME}').then((module) => { if (typeof module.SFTPStorage !== 'function') throw new Error('ESM export missing') })`
    run(process.execPath, ['--input-type=module', '--eval', importScript], temporaryRoot)
    const requireScript = `const module = require('${PACKAGE_NAME}'); if (typeof module.SFTPStorage !== 'function') throw new Error('CommonJS export missing')`
    run(process.execPath, ['--eval', requireScript], temporaryRoot)

    await writeFile(
      join(temporaryRoot, 'types-smoke.ts'),
      `import { SFTPStorage } from '${PACKAGE_NAME}'\nimport type { AbstractStorage } from '${CORE_NAME}'\ndeclare const concrete: SFTPStorage\nconst base: AbstractStorage = concrete\nvoid base\n`,
    )
    await writeFile(
      join(temporaryRoot, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true }, files: ['types-smoke.ts'] }, null, 2)}\n`,
    )
    run(process.execPath, [join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], temporaryRoot)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  const sha256 = createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex')
  const audit = {
    name: report.name,
    version: report.version,
    filename: report.filename,
    size: report.size,
    unpackedSize: report.unpackedSize,
    totalFiles: report.files.length,
    sha256,
  }
  await writeFile(join(artifactsRoot, 'manifest.json'), `${JSON.stringify(audit, null, 2)}\n`)
  await writeFile(join(artifactsRoot, 'SHA256SUMS.txt'), `${sha256}  ${report.filename}\n`)
  return audit
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const audit = await packageAndAudit()
  console.log(`${audit.name}@${audit.version}: ${audit.filename} (${audit.size} bytes, sha256 ${audit.sha256})`)
}

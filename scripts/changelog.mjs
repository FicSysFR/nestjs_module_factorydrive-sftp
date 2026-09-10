import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function parseSemVer(version) {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) throw new Error(`Invalid SemVer version: ${version}`)
  return {
    raw: version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareIdentifier(left, right) {
  const leftNumber = /^\d+$/.test(left)
  const rightNumber = /^\d+$/.test(right)
  if (leftNumber && rightNumber) return Number(left) - Number(right)
  if (leftNumber) return -1
  if (rightNumber) return 1
  return left.localeCompare(right)
}

export function compareSemVer(leftVersion, rightVersion) {
  const left = parseSemVer(leftVersion)
  const right = parseSemVer(rightVersion)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1
  if (right.prerelease.length === 0 && left.prerelease.length > 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1
    if (right.prerelease[index] === undefined) return 1
    const compared = compareIdentifier(left.prerelease[index], right.prerelease[index])
    if (compared !== 0) return compared
  }
  return 0
}

function parseMetadata(frontmatter) {
  const metadata = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`Invalid changelog metadata line: ${line}`)
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return metadata
}

export function parseChangelogSource(filename, content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  if (!match) throw new Error(`${filename} must start with YAML-style metadata`)
  const metadata = parseMetadata(match[1])
  const fileVersion = basename(filename, '.md')
  parseSemVer(fileVersion)
  if (metadata.version !== fileVersion) {
    throw new Error(`${filename} declares version ${metadata.version ?? '(missing)'}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date ?? '')) {
    throw new Error(`${filename} has an invalid date`)
  }
  const parsedDate = new Date(`${metadata.date}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== metadata.date) {
    throw new Error(`${filename} has an invalid calendar date`)
  }
  const body = match[2].trim()
  if (!body || !/[A-Za-zÀ-ÿ0-9]/.test(body.replace(/^#+\s.*$/gm, ''))) {
    throw new Error(`${filename} has empty release notes`)
  }
  return { version: fileVersion, date: metadata.date, body }
}

export function renderChangelog(entries) {
  const ordered = [...entries].sort((left, right) => compareSemVer(right.version, left.version))
  const sections = ordered.map(({ version, date, body }) => `## ${version} - ${date}\n\n${body}`)
  return `# Changelog\n\nAll notable changes to Factorydrive are documented here.\n\n${sections.join('\n\n')}\n`
}

export async function loadChangelogEntries(projectRoot) {
  const sourceRoot = join(projectRoot, 'changelog')
  const filenames = (await readdir(sourceRoot)).filter((filename) => filename.endsWith('.md'))
  if (filenames.length === 0) throw new Error('No changelog source files were found')
  return Promise.all(filenames.map(async (filename) => parseChangelogSource(filename, await readFile(join(sourceRoot, filename), 'utf8'))))
}

export async function generateChangelog(projectRoot) {
  return renderChangelog(await loadChangelogEntries(projectRoot))
}

export async function writeChangelog(projectRoot, releaseVersion) {
  const entries = await loadChangelogEntries(projectRoot)
  const release = entries.find((entry) => entry.version === releaseVersion)
  if (!release) throw new Error(`Missing changelog/${releaseVersion}.md`)
  await writeFile(join(projectRoot, 'CHANGELOG.md'), renderChangelog(entries))
  const releaseRoot = join(projectRoot, '.artifacts', 'release')
  await mkdir(releaseRoot, { recursive: true })
  await writeFile(join(releaseRoot, `${releaseVersion}.md`), `${release.body}\n`)
  return release
}

export async function checkChangelog(projectRoot) {
  const expected = await generateChangelog(projectRoot)
  const actual = await readFile(join(projectRoot, 'CHANGELOG.md'), 'utf8')
  if (actual !== expected) throw new Error('CHANGELOG.md is stale; run yarn changelog:write --version X.Y.Z')
  return (await loadChangelogEntries(projectRoot)).length
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--write')) {
    const version = argument('--version')
    if (!version) throw new Error('--version is required with --write')
    const release = await writeChangelog(projectRoot, version)
    console.log(`Generated CHANGELOG.md and release notes for ${release.version}.`)
  } else {
    const count = await checkChangelog(projectRoot)
    console.log(`Validated ${count} changelog source file(s).`)
  }
}

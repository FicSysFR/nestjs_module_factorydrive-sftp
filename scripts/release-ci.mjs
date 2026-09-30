#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { parseSemVer } from './changelog.mjs'

const WORKFLOW = 'release.yml'
const CHANNELS = new Set(['latest', 'next'])

/** gh may be missing from PATH in Cursor if the IDE was open before GitHub CLI was installed. */
function resolveGh() {
  const fromEnv = process.env.GH?.trim()
  if (fromEnv) return fromEnv

  const candidates = []
  if (process.platform === 'win32') {
    candidates.push('C:/Program Files/GitHub CLI/gh.exe', 'C:/Program Files (x86)/GitHub CLI/gh.exe')
    if (process.env.LOCALAPPDATA) {
      candidates.push(`${process.env.LOCALAPPDATA}/Programs/GitHub CLI/gh.exe`)
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  try {
    execSync('gh --version', { stdio: 'ignore', shell: true })
    return 'gh'
  } catch {
    console.error(
      `'gh' introuvable dans le PATH de cette session.\n` +
        `→ Redémarrez votre éditeur après l'installation de GitHub CLI.\n` +
        `→ Ou forcez le binaire : GH="C:/Program Files/GitHub CLI/gh.exe" make release-ci`,
    )
    process.exit(1)
  }
}

function parseArgs(argv) {
  let version = ''
  let channel = 'latest'
  let branch = 'main'
  let watch = false
  let yes = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version' || arg === '-v') {
      version = argv[++i] ?? ''
    } else if (arg === '--channel' || arg === '-c') {
      channel = argv[++i] ?? ''
    } else if (arg === '--branch' || arg === '-b') {
      branch = argv[++i] ?? 'main'
    } else if (arg === '--watch' || arg === '-w') {
      watch = true
    } else if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/release-ci.mjs --version X.Y.Z [--channel latest|next]\n' + '                                  [--branch main] [--watch] [--yes]')
      process.exit(0)
    }
  }

  if (!version) {
    console.error('ERROR: --version X.Y.Z is required')
    process.exit(1)
  }
  try {
    parseSemVer(version)
  } catch {
    console.error(`ERROR: --version must be an exact stable X.Y.Z version (got "${version}")`)
    process.exit(1)
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`ERROR: --version must be an exact stable X.Y.Z version (got "${version}")`)
    process.exit(1)
  }

  channel = channel.trim().toLowerCase()
  if (!CHANNELS.has(channel)) {
    console.error(`ERROR: --channel must be one of latest, next (got "${channel}")`)
    process.exit(1)
  }

  return { version, channel, branch: branch.trim() || 'main', watch, yes }
}

function ghOutput(gh, args) {
  return execFileSync(gh, args, { encoding: 'utf8', shell: gh === 'gh' }).trim()
}

function run(gh, args) {
  try {
    execFileSync(gh, args, { stdio: 'inherit', shell: gh === 'gh' })
  } catch (error) {
    console.error(`\nERROR: command failed: ${[gh, ...args].join(' ')}`)
    process.exit(error.status ?? 1)
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui'
}

/** The dispatch API returns no run id — poll the workflow's recent runs instead. */
async function findRun(gh, branch, since) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const raw = ghOutput(gh, ['run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,createdAt,url'])
    const runs = JSON.parse(raw).filter((entry) => new Date(entry.createdAt).getTime() >= since)
    if (runs.length > 0) return runs[0]
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return null
}

async function main() {
  const { version, channel, branch, watch, yes } = parseArgs(process.argv.slice(2))
  const gh = resolveGh()

  console.log(`Workflow : ${WORKFLOW}`)
  console.log(`Branch   : ${branch}`)
  console.log(`Version  : ${version}`)
  console.log(`Channel  : ${channel}`)

  if (!yes && !(await confirm('\nDéclencher cette release sur GitHub ?'))) {
    console.log('Annulé.')
    process.exit(0)
  }

  const since = Date.now() - 5000
  run(gh, ['workflow', 'run', WORKFLOW, '--ref', branch, '-f', `release_version=${version}`, '-f', `channel=${channel}`])

  const workflowRun = await findRun(gh, branch, since)
  if (!workflowRun) {
    console.log(`Release déclenchée. Suivi : gh run list --workflow ${WORKFLOW}`)
    return
  }

  console.log(`\nRun: ${workflowRun.url}`)
  if (watch) {
    run(gh, ['run', 'watch', String(workflowRun.databaseId), '--exit-status'])
  }
}

main()

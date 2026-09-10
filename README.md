<p align="center">
  <a href="http://nestjs.com/" target="blank">
    <img src="https://nestjs.com/img/logo_text.svg" width="320" alt="Nest Logo" />
  </a>
</p>

<p align="center">
  SFTP driver for Factory drive module from NestJS framework
</p>

<p align="center">
  <a href="https://www.npmjs.com/org/ficsysfr"><img src="https://img.shields.io/npm/v/@ficsysfr/nestjs_module_factorydrive-sftp.svg" alt="NPM Version" /></a>
  <a href="https://www.npmjs.com/org/ficsysfr"><img src="https://img.shields.io/npm/l/@ficsysfr/nestjs_module_factorydrive-sftp.svg" alt="Package License" /></a>
  <a href="https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/actions/workflows/ci.yml"><img src="https://github.com/FicSysFR/nestjs_module_factorydrive-sftp/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/FicSysFR/nestjs_module_factorydrive-sftp"><img src="https://codecov.io/gh/FicSysFR/nestjs_module_factorydrive-sftp/graph/badge.svg" alt="Coverage" /></a>
</p>
<br>

# SFTP driver for Factory drive module
SFTP driver for Factory drive module from NestJS framework

## Installation

Install both packages with your favorite package manager.

```bash
# npm
npm install @ficsysfr/nestjs_module_factorydrive @ficsysfr/nestjs_module_factorydrive-sftp
```

```bash
# yarn
yarn add @ficsysfr/nestjs_module_factorydrive @ficsysfr/nestjs_module_factorydrive-sftp
```

```bash
# pnpm
pnpm add @ficsysfr/nestjs_module_factorydrive @ficsysfr/nestjs_module_factorydrive-sftp
```

```bash
# bun
bun add @ficsysfr/nestjs_module_factorydrive @ficsysfr/nestjs_module_factorydrive-sftp
```

## Register the driver
```ts
import { Module } from '@nestjs/common'
import { FactorydriveService } from '@ficsysfr/nestjs_module_factorydrive'
import { SFTPStorage } from '@ficsysfr/nestjs_module_factorydrive-sftp'

@Module({
  //...
})
export class AppModule {
  public constructor(storage: FactorydriveService) {
    // Register the "sftp" driver key once at bootstrap
    storage.registerDriver('sftp', SFTPStorage)
  }
}
```

## Example configuration

```ts
import { FactorydriveService } from '@ficsysfr/nestjs_module_factorydrive'

export class StorageBootstrap {
  public constructor(private readonly storage: FactorydriveService) {}

  public async init(): Promise<void> {
    await this.storage.createDisk('remote', {
      driver: 'sftp',
      config: {
        root: '/var/www/storage',
        options: {
          host: 'sftp.example.com',
          port: 22,
          username: 'my-user',
          password: 'my-password',
        },
      },
    })
  }
}
```

## Example operations

```ts
const disk = this.storage.disk('remote')

await disk.put('documents/report.txt', 'Hello from SFTP storage')
const exists = await disk.exists('documents/report.txt')
const content = await disk.get('documents/report.txt')

console.log({ exists: exists.exists, content: content.content })
```

## Development

This repository uses Yarn 1.22.22, Biome, Vitest, and TypeScript:

```bash
yarn install --frozen-lockfile
yarn lint
yarn typecheck
yarn test
yarn test:coverage
yarn build
yarn package:check
```

Use `make check` for every local quality gate, `yarn package` or `make package` for
the audited tarball under `.artifacts/npm/`, and
`make release VERSION=2.0.0 CHANNEL=latest WATCH=1` for the manual release workflow.

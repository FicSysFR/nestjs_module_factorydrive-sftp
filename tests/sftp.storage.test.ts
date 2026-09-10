import { beforeEach, describe, expect, it, vi } from 'vitest'

type ConnectOptions = { host: string; username: string; password: string }

class MockSftpClient {
  public readonly host: string
  public connect = vi.fn(async (_options: ConnectOptions) => undefined)
  public rcopy = vi.fn(async (_src: string, _dest: string) => 'copied')
  public delete = vi.fn(async (_location: string) => 'deleted')
  public exists = vi.fn(async (_location: string) => true)
  public get = vi.fn(async (_location: string) => Buffer.from('hello'))
  public stat = vi.fn(async (_location: string) => ({ size: 42, modifyTime: 1700000000000 }))
  public list = vi.fn(async (_location: string) => [] as Array<{ name: string; type: 'd' | '-' }>)
  public put = vi.fn(async (_content: unknown, _location: string) => 'uploaded')

  public constructor(host: string) {
    this.host = host
  }
}

class AbstractStorage {}
class UnknownException extends Error {
  public readonly code: string
  public readonly target: string

  public constructor(original: unknown, code: string, target: string) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'UnknownException'
    this.code = code
    this.target = target
  }
}
class FileNotFoundException extends Error {
  public constructor(original: unknown, target: string) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'FileNotFoundException'
    ;(this as { target: string }).target = target
  }
}
class NoSuchBucketException extends Error {
  public constructor(original: unknown, target: string) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'NoSuchBucketException'
    ;(this as { target: string }).target = target
  }
}
class PermissionMissingException extends Error {
  public constructor(original: unknown, target: string) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'PermissionMissingException'
    ;(this as { target: string }).target = target
  }
}

vi.doMock('ssh2-sftp-client', () => ({
  default: MockSftpClient,
}))

vi.doMock('@ficsysfr/nestjs_module_factorydrive', () => ({
  AbstractStorage,
  FileNotFoundException,
  NoSuchBucketException,
  PermissionMissingException,
  UnknownException,
}))

const { SFTPStorage } = await import('../src/sftp.storage.js')

describe('SFTPStorage', () => {
  let storage: InstanceType<typeof SFTPStorage>
  let driver: MockSftpClient

  beforeEach(() => {
    storage = new SFTPStorage({
      root: '/bucket/',
      options: {
        host: 'sftp.example.com',
        username: 'john',
        password: 'secret',
      },
    })
    driver = storage.driver() as unknown as MockSftpClient
  })

  it('connecte le driver avec la configuration', async () => {
    await storage.onStorageInit()

    expect(driver.host).toBe('sftp.example.com')
    expect(driver.connect).toHaveBeenCalledTimes(1)
    expect(driver.connect).toHaveBeenCalledWith({
      host: 'sftp.example.com',
      username: 'john',
      password: 'secret',
    })
  })

  it('normalise les chemins pendant copy', async () => {
    await storage.copy('//docs//a.txt', 'archive///b.txt')

    expect(driver.rcopy).toHaveBeenCalledWith('/bucket/docs/a.txt', '/bucket/archive/b.txt')
  })

  it('retourne exists=false quand le driver renvoie 404', async () => {
    const notFound = { statusCode: 404 }
    driver.exists = vi.fn(async () => {
      throw notFound
    })

    const result = await storage.exists('missing.txt')
    expect(result.exists).toBe(false)
    expect(result.raw).toBe(notFound)
  })

  it('move appelle copy puis delete avec les bons chemins', async () => {
    const copySpy = vi.fn(storage.copy.bind(storage))
    const deleteSpy = vi.fn(storage.delete.bind(storage))
    ;(storage as unknown as { copy: typeof copySpy }).copy = copySpy
    ;(storage as unknown as { delete: typeof deleteSpy }).delete = deleteSpy

    const result = await storage.move('from.txt', 'to.txt')

    expect(copySpy).toHaveBeenCalledWith('from.txt', 'to.txt')
    expect(deleteSpy).toHaveBeenCalledWith('from.txt')
    expect(result.raw).toBeUndefined()
  })

  it('flatList retourne les fichiers de facon recursive', async () => {
    driver.list = vi.fn(async (location: string) => {
      if (location === '/bucket') {
        return [{ name: 'docs', type: 'd' as const }]
      }

      if (location === '/bucket/docs/') {
        return [
          { name: 'a.txt', type: '-' as const },
          { name: 'nested', type: 'd' as const },
        ]
      }

      if (location === '/bucket/docs/nested/') {
        return [{ name: 'b.txt', type: '-' as const }]
      }

      return []
    })

    const output: string[] = []
    for await (const item of storage.flatList('docs')) {
      output.push(item.path)
    }

    expect(output).toEqual(['docs/a.txt', 'docs/nested/b.txt'])
  })
})

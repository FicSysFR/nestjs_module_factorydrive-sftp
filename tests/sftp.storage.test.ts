import { once } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ConnectOptions = { host: string; username: string; password: string }

// Same shape as the errors produced by ssh2-sftp-client (fmtError).
function sftpError(code: number | string): Error {
  return Object.assign(new Error(`sftp: failure (${code})`), { code, custom: true })
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString()
}

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
  public createReadStream = vi.fn((_location: string): Readable => Readable.from([Buffer.from('hel'), Buffer.from('lo')]))

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

  describe('put', () => {
    it("attend la fin de l'upload et retourne son resultat", async () => {
      const result = await storage.put('docs/a.txt', Buffer.from('hello'))

      expect(result.raw).toBe('uploaded')
      expect(driver.put).toHaveBeenCalledWith(Buffer.from('hello'), '/bucket/docs/a.txt')
    })

    it('envoie une chaine comme contenu et non comme chemin local', async () => {
      await storage.put('docs/a.txt', '/etc/passwd')

      const [source] = driver.put.mock.calls[0]
      expect(Buffer.isBuffer(source)).toBe(true)
      expect((source as Buffer).toString()).toBe('/etc/passwd')
    })

    it('transmet un flux tel quel', async () => {
      const content = Readable.from(['hello'])

      await storage.put('docs/a.txt', content)

      expect(driver.put).toHaveBeenCalledWith(content, '/bucket/docs/a.txt')
    })

    it("rejette avec une erreur mappee quand l'upload echoue", async () => {
      driver.put = vi.fn(async () => {
        throw sftpError(3)
      })

      await expect(storage.put('docs/a.txt', 'hello')).rejects.toBeInstanceOf(PermissionMissingException)
    })
  })

  describe('get', () => {
    it("ne prefixe la racine qu'une seule fois", async () => {
      const result = await storage.get('docs/a.txt')

      expect(driver.get).toHaveBeenCalledTimes(1)
      expect(driver.get).toHaveBeenCalledWith('/bucket/docs/a.txt')
      expect(result.content).toBe('hello')
    })
  })

  describe('getStream', () => {
    it('diffuse le contenu du fichier distant', async () => {
      const stream = await storage.getStream('docs/a.txt')

      expect(driver.createReadStream).toHaveBeenCalledWith('/bucket/docs/a.txt')
      expect(await readAll(stream)).toBe('hello')
    })

    it('emet une FileNotFoundException quand le fichier est absent', async () => {
      driver.createReadStream = vi.fn(
        () =>
          new Readable({
            read() {
              this.destroy(sftpError(2))
            },
          }),
      )

      const stream = await storage.getStream('missing.txt')

      const error = await readAll(stream).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FileNotFoundException)
      expect((error as { target: string }).target).toBe('missing.txt')
    })

    it('libere le flux distant quand le consommateur abandonne la lecture', async () => {
      const source = new Readable({ read() {} })
      driver.createReadStream = vi.fn(() => source)

      const stream = (await storage.getStream('docs/a.txt')) as Readable
      const closed = once(source, 'close')
      stream.destroy()
      await closed

      expect(source.destroyed).toBe(true)
    })

    it('rejette avec une erreur mappee quand le flux ne peut pas etre cree', async () => {
      driver.createReadStream = vi.fn(() => {
        throw sftpError('ERR_NOT_CONNECTED')
      })

      const error = await storage.getStream('docs/a.txt').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnknownException)
      expect((error as UnknownException).code).toBe('ERR_NOT_CONNECTED')
    })
  })

  describe('mapping des erreurs SFTP', () => {
    it.each([
      { code: 2, expected: FileNotFoundException },
      { code: 'ENOENT', expected: FileNotFoundException },
      { code: 3, expected: PermissionMissingException },
      { code: 'EACCES', expected: PermissionMissingException },
      { code: 4, expected: UnknownException },
    ])('code $code -> $expected.name', async ({ code, expected }) => {
      driver.get = vi.fn(async () => {
        throw sftpError(code)
      })

      const error = await storage.getBuffer('docs/a.txt').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(expected)
      expect((error as { target: string }).target).toBe('docs/a.txt')
    })

    it("mappe l'ENOENT renvoye par stat", async () => {
      driver.stat = vi.fn(async () => {
        throw sftpError('ENOENT')
      })

      await expect(storage.getStat('missing.txt')).rejects.toBeInstanceOf(FileNotFoundException)
    })

    it('conserve le code SFTP dans UnknownException', async () => {
      driver.delete = vi.fn(async () => {
        throw sftpError(4)
      })

      const error = await storage.delete('docs/a.txt').catch((e: unknown) => e)
      expect((error as UnknownException).code).toBe('4')
    })

    it("n'interprete plus les noms d'erreur S3", async () => {
      driver.get = vi.fn(async () => {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      })

      const error = await storage.getBuffer('docs/a.txt').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnknownException)
      expect((error as UnknownException).code).toBe('NoSuchKey')
    })

    it("mappe l'echec de connexion sur l'hote", async () => {
      driver.connect = vi.fn(async () => {
        throw sftpError('ERR_BAD_AUTH')
      })

      const error = await storage.onStorageInit().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnknownException)
      expect((error as UnknownException).code).toBe('ERR_BAD_AUTH')
      expect((error as UnknownException).target).toBe('sftp.example.com')
    })

    it("mappe l'echec de connexion sans hote configure", async () => {
      const sockStorage = new SFTPStorage({ root: '/bucket/', options: { username: 'john', password: 'secret' } })
      const sockDriver = sockStorage.driver() as unknown as MockSftpClient
      sockDriver.connect = vi.fn(async () => {
        throw sftpError('ECONNREFUSED')
      })

      const error = await sockStorage.onStorageInit().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnknownException)
      expect((error as UnknownException).target).toBe('')
    })

    it('mappe les erreurs de copy sur le chemin source', async () => {
      driver.rcopy = vi.fn(async () => {
        throw sftpError(2)
      })

      const error = await storage.copy('from.txt', 'to.txt').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FileNotFoundException)
      expect((error as { target: string }).target).toBe('from.txt')
    })

    it('mappe les erreurs de exists autres que 404', async () => {
      driver.exists = vi.fn(async () => {
        throw sftpError(3)
      })

      await expect(storage.exists('docs/a.txt')).rejects.toBeInstanceOf(PermissionMissingException)
    })

    it('mappe les erreurs de listing pendant flatList', async () => {
      driver.list = vi.fn(async () => {
        throw sftpError(2)
      })

      const iterate = async () => {
        for await (const _item of storage.flatList('docs/')) {
          // consomme l'iterateur
        }
      }
      await expect(iterate()).rejects.toBeInstanceOf(FileNotFoundException)
    })
  })
})

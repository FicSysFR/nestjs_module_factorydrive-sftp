import { PassThrough } from 'node:stream'
import {
  AbstractStorage,
  type ContentResponse,
  type DeleteResponse,
  type ExistsResponse,
  type FileListResponse,
  FileNotFoundException,
  PermissionMissingException,
  type Response,
  type StatResponse,
  UnknownException,
} from '@ficsysfr/nestjs_module_factorydrive'
import Client, { type ConnectOptions } from 'ssh2-sftp-client'

// ssh2 SFTP status codes, kept numeric by ssh2-sftp-client on get/put/delete/list.
const SFTP_STATUS_NO_SUCH_FILE = 2
const SFTP_STATUS_PERMISSION_DENIED = 3

function handleError(err: unknown, path: string): Error {
  const error = err instanceof Error ? err : new Error(String(err))
  const code: unknown = (error as { code?: unknown }).code
  switch (code) {
    case SFTP_STATUS_NO_SUCH_FILE:
    case 'ENOENT':
      return new FileNotFoundException(error, path)
    case SFTP_STATUS_PERMISSION_DENIED:
    case 'EACCES':
      return new PermissionMissingException(error, path)
    default:
      return new UnknownException(error, code === undefined ? error.name : String(code), path)
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404
}

export interface SFTPStorageConfig {
  root: string
  options: ConnectOptions
}

export class SFTPStorage extends AbstractStorage {
  private readonly $driver: Client

  public constructor(private readonly $config: SFTPStorageConfig) {
    super()
    this.$driver = new Client($config.options.host)
  }

  public async onStorageInit(): Promise<void> {
    try {
      await this.$driver.connect(this.$config.options)
    } catch (e) {
      throw handleError(e, this.$config.options.host ?? '')
    }
  }

  public driver(): Client {
    return this.$driver
  }

  public async copy(src: string, dest: string): Promise<Response> {
    try {
      const result = await this.$driver.rcopy(this._fullPath(src), this._fullPath(dest))
      return { raw: result }
    } catch (e) {
      throw handleError(e, src)
    }
  }

  public async delete(location: string): Promise<DeleteResponse> {
    try {
      const result = await this.$driver.delete(this._fullPath(location))
      return { raw: result, wasDeleted: null }
    } catch (e) {
      throw handleError(e, location)
    }
  }

  public async exists(location: string): Promise<ExistsResponse> {
    try {
      const result = await this.$driver.exists(this._fullPath(location))

      return { exists: !!result, raw: result }
    } catch (e) {
      if (isNotFound(e)) {
        return { exists: false, raw: e }
      } else {
        throw handleError(e, location)
      }
    }
  }

  public async get(location: string, encoding: BufferEncoding = 'utf-8'): Promise<ContentResponse<string>> {
    const bufferResult = await this.getBuffer(location)
    return {
      content: bufferResult.content.toString(encoding),
      raw: bufferResult.raw,
    }
  }

  public async getBuffer(location: string): Promise<ContentResponse<Buffer>> {
    try {
      const result = (await this.$driver.get(this._fullPath(location))) as Buffer
      return { content: Buffer.from(result), raw: result }
    } catch (e) {
      throw handleError(e, location)
    }
  }

  public async getStat(location: string): Promise<StatResponse> {
    try {
      const result = await this.$driver.stat(this._fullPath(location))
      return {
        size: result.size,
        modified: new Date(result.modifyTime),
        raw: result,
      }
    } catch (e) {
      throw handleError(e, location)
    }
  }

  public async getStream(location: string): Promise<NodeJS.ReadableStream> {
    try {
      const source = this.$driver.createReadStream(this._fullPath(location))
      const output = new PassThrough()
      // pipe() does not forward errors: surface them mapped on the returned stream,
      // and release the remote handle when the consumer stops reading early.
      source.on('error', (e: Error) => output.destroy(handleError(e, location)))
      output.once('close', () => source.destroy())
      source.pipe(output)

      return output
    } catch (e) {
      throw handleError(e, location)
    }
  }

  public async move(src: string, dest: string): Promise<Response> {
    await this.copy(src, dest)
    await this.delete(src)
    return { raw: undefined }
  }

  public async put(location: string, content: Buffer | NodeJS.ReadableStream | string): Promise<Response> {
    try {
      // ssh2-sftp-client reads a string source as a local file path; the storage contract treats it as content.
      const source = typeof content === 'string' ? Buffer.from(content) : content
      const result = await this.$driver.put(source, this._fullPath(location))
      return { raw: result }
    } catch (e) {
      throw handleError(e, location)
    }
  }

  public flatList(prefix = ''): AsyncIterable<FileListResponse> {
    const fullPrefix = this._fullPath(prefix)
    return this._flatDirIterator(fullPrefix, prefix)
  }

  private async *_flatDirIterator(prefix: string, originalPrefix: string): AsyncIterable<FileListResponse> {
    const prefixDirectory = prefix.endsWith('/') ? prefix : this._dirname(prefix)

    try {
      const dir = await this.$driver.list(prefixDirectory)

      for (const file of dir) {
        const fileName = this._joinPath(prefixDirectory, file.name)
        if (fileName.startsWith(prefix)) {
          if (file.type === 'd') {
            yield* this._flatDirIterator(this._joinPath(fileName, '/'), originalPrefix)
          } else if (file.type === '-') {
            const path = this._relative(this.$config.root, fileName)
            yield {
              raw: file,
              path,
            }
          }
        }
      }
    } catch (e) {
      throw handleError(e, prefix)
    }
  }

  private _fullPath(prefix: string): string {
    return this._joinPath(this.$config.root, prefix)
  }

  private _relative(root: string, fileName: string): string {
    return fileName.replace(root, '')
  }

  private _dirname(path: string): string {
    return path.substring(0, path.lastIndexOf('/'))
  }

  private _joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/')
  }
}

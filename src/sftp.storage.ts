import { PassThrough } from 'node:stream'
import {
  AbstractStorage,
  type ContentResponse,
  type DeleteResponse,
  type ExistsResponse,
  type FileListResponse,
  FileNotFoundException,
  NoSuchBucketException,
  PermissionMissingException,
  type Response,
  type StatResponse,
  UnknownException,
} from '@ficsysfr/nestjs_module_factorydrive'
import Client, { type ConnectOptions } from 'ssh2-sftp-client'

function handleError(err: unknown, path: string, name?: string): Error {
  const error = err instanceof Error ? err : new Error(String(err))
  const storageName = name ?? path
  switch (error.name) {
    case 'NoSuchBucket':
      return new NoSuchBucketException(error, storageName)
    case 'NoSuchKey':
      return new FileNotFoundException(error, path)
    case 'AllAccessDisabled':
      return new PermissionMissingException(error, path)
    default:
      return new UnknownException(error, error.name, path)
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
      throw handleError(e, this.$config.options.host ?? '', this.$config.options.host)
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
      throw handleError(e, src, this.$config.options.host)
    }
  }

  public async delete(location: string): Promise<DeleteResponse> {
    try {
      const result = await this.$driver.delete(this._fullPath(location))
      return { raw: result, wasDeleted: null }
    } catch (e) {
      throw handleError(e, location, this.$config.options.host)
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
        throw handleError(e, location, this.$config.options.host)
      }
    }
  }

  public async get(location: string, encoding: BufferEncoding = 'utf-8'): Promise<ContentResponse<string>> {
    const bufferResult = await this.getBuffer(this._fullPath(location))
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
      throw handleError(e, location, this.$config.options.host)
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
      throw handleError(e, location, this.$config.options.host)
    }
  }

  public async getStream(location: string): Promise<NodeJS.ReadableStream> {
    const passThrough = new PassThrough()
    const stream = (await this.$driver.get(this._fullPath(location))) as NodeJS.WritableStream
    passThrough.pipe(stream)

    return passThrough
  }

  public async move(src: string, dest: string): Promise<Response> {
    await this.copy(src, dest)
    await this.delete(src)
    return { raw: undefined }
  }

  public async put(location: string, content: Buffer | NodeJS.ReadableStream | string): Promise<Response> {
    try {
      const result = this.$driver.put(content, this._fullPath(location))
      return { raw: result }
    } catch (e) {
      throw handleError(e, location, this.$config.options.host)
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
      throw handleError(e, prefix, this.$config.options.host)
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

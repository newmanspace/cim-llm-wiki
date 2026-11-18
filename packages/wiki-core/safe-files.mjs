import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs'

// Read through one descriptor: reject symlinks/FIFOs and never reopen a checked pathname.
export function readRegularFile(path, encoding) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Regular file required: ' + path)
    return readFileSync(fd, encoding)
  } finally { closeSync(fd) }
}

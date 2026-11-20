import { extname } from 'node:path'
const mime = { '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.txt': 'text/plain' }
export function mediaType(filename, bytes) {
  const type = mime[extname(filename).toLowerCase()] || 'application/octet-stream'
  const signatures = { 'image/png': '89504e470d0a1a0a', 'image/jpeg': 'ffd8ff', 'image/gif': '47494638', 'application/pdf': '25504446' }
  if (signatures[type] && !bytes.toString('hex').startsWith(signatures[type])) throw new Error('File signature differs from its extension')
  if (type === 'image/webp' && (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')) throw new Error('Invalid WebP signature')
  return type
}

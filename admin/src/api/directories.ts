import client from './client'
export type DirectoryRow = {
  id?: string
  path: string
  parent_path: string
  display_name: string
  revision?: number
  child_count: number
  document_count: number
  scoring_mode: string
  path_locked: boolean
  can_delete: boolean
  virtual?: boolean
}
export const dimensions = [
  { id: 'fidelity', label: '转换准确性' },
  { id: 'completeness', label: '完整性' },
  { id: 'traceability', label: '来源追溯' },
  { id: 'consistency', label: '一致性' },
  { id: 'structure', label: '结构与归类' },
  { id: 'usability', label: '可用性' },
  { id: 'validity', label: '状态可信度' },
]
export function directoryBase(project: string) {
  return `/admin/projects/${encodeURIComponent(project)}/document-quality/`
}
export async function directoryCommand(
  project: string,
  operation: string,
  body: Record<string, any>,
) {
  const response = await client.post(directoryBase(project) + operation, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  return response.data.data
}
export async function directoryList(project: string, resource: string) {
  const items: any[] = []
  let cursor = ''
  do {
    const response = await client.get(directoryBase(project) + resource, {
      params: { limit: 200, cursor },
    })
    items.push(...response.data.data.items)
    cursor = response.data.data.next_cursor
  } while (cursor)
  return items
}
export function policyMode(patch: Record<string, any>) {
  if (!Object.keys(patch).length) return 'inherit'
  return patch.review_threshold !== undefined &&
    dimensions.every(
      (d) =>
        patch.dimensions?.[d.id]?.weight !== undefined &&
        patch.dimensions?.[d.id]?.rubric !== undefined,
    )
    ? 'independent'
    : 'partial'
}
export function scoringLabel(mode: string) {
  return (
    (
      {
        inherit: '继承父级',
        partial: '部分自定义',
        independent: '独立设置',
      } as Record<string, string>
    )[mode] || '继承父级'
  )
}

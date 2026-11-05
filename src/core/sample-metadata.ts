import type { CandidateStatus, DesignParameters, MetadataKey, ProductionKey, ProductionRecord, SampleHistory, SampleMetadata as SampleMetadataRecord, Staff, StaffKey } from '../services/types'

export const groups: Array<{ title: string; fields: Array<[MetadataKey, string]> }> = [
  { title: '基本信息', fields: [['name', '样例名称'], ['wood', '木种 / 材质'], ['style', '风格'], ['tone', '色系'], ['source', '来源']] },
  { title: '客户与工艺信息', fields: [['customer', '客户 / 项目'], ['customerCode', '客户编号'], ['orderNo', '订单编号'], ['substrate', '承印原纸'], ['inkSeries', '油墨型号 / 系列'], ['machine', '生产设备']] },
]
export const staffFields: Array<[StaffKey, string]> = [['designer', '设计人员'], ['colorist', '调墨师傅'], ['operator', '生产操作人员'], ['reviewer', '审核人员']]
export const productionFields: Array<[ProductionKey, string]> = [['batchNo', '批次编号'], ['stage', '阶段'], ['date', '生产日期'], ['equipment', '设备'], ['quantity', '生产数量'], ['substrate', '原纸'], ['deltaE', '实测色差'], ['result', '生产结果'], ['operator', '操作人员']]

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw Error(label + '必须是文字')
  return value.trim()
}
export const inputValue = (value: unknown): string => value == null || value === '未填写' || value === '待人工评价' ? '' : String(value)
function validDate(value: string, label: string): string {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error(label + '应为YYYY-MM-DD')
  if (value) {
    const date = new Date(value + 'T00:00:00Z')
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error(label + '不是有效日期')
  }
  return value
}
export function normalize(value: unknown): SampleMetadataRecord {
  if (!isRecord(value)) throw Error('样例资料应为对象')
  const input = value
  const basic = {} as Record<MetadataKey, string>
  for (const group of groups) for (const [key, label] of group.fields) basic[key] = text(input[key], label) || '未填写'
  if (basic.name === '未填写') throw Error('请填写样例名称')
  if (input.staff != null && !isRecord(input.staff)) throw Error('人员信息staff应为对象')
  const staffInput = isRecord(input.staff) ? input.staff : {}
  const staff = {} as Staff
  for (const [key, label] of staffFields) staff[key] = text(staffInput[key], label) || '未填写'
  if (input.productionRecords != null && !Array.isArray(input.productionRecords)) throw Error('productionRecords应为生产记录数组')
  const productionRecords: ProductionRecord[] = []
  for (const [index, row] of ((input.productionRecords ?? []) as unknown[]).entries()) {
    if (!isRecord(row)) throw Error('第' + (index + 1) + '条生产记录格式错误')
    const values = {} as ProductionRecord
    for (const [key, label] of productionFields) {
      const raw = key === 'deltaE' && typeof row[key] === 'number' ? String(row[key]) : text(row[key], label)
      values[key] = raw === '未填写' ? '' : raw
    }
    if (!Object.values(values).some(Boolean)) continue
    if (!values.batchNo) throw Error('第' + (index + 1) + '条生产记录请填写批次编号')
    validDate(values.date, '第' + (index + 1) + '条生产日期')
    if (values.deltaE && (!Number.isFinite(Number(values.deltaE)) || Number(values.deltaE) < 0)) throw Error('实测色差必须为大于或等于0的数值')
    for (const [key] of productionFields) values[key] ||= '未填写'
    productionRecords.push(values)
  }
  if (input.history != null && !Array.isArray(input.history)) throw Error('history应为历史记录数组')
  const history = ((input.history ?? []) as unknown[]).map((row, index): SampleHistory => {
    if (!isRecord(row)) throw Error('第' + (index + 1) + '条历史记录格式错误')
    const date = text(row.date, '历史日期')
    validDate(date === '未填写' ? '' : date, '历史日期')
    return { date: date || '未填写', title: text(row.title, '历史标题') || '未填写', description: text(row.description, '历史说明') || '未填写', status: text(row.status, '历史状态') || '未填写' }
  })
  if (input.parameters != null && !isRecord(input.parameters)) throw Error('parameters应为对象')
  const out: SampleMetadataRecord = { ...basic, feedback: text(input.feedback, '反馈') || '待人工评价', staff, productionRecords, history, parameters: (input.parameters ?? {}) as DesignParameters }
  if (input.recordKind != null) {
    if (input.recordKind !== 'sample' && input.recordKind !== 'design-candidate') throw Error('recordKind应为sample或design-candidate')
    out.recordKind = input.recordKind
  }
  if (input.candidateReview != null) {
    const review = input.candidateReview
    if (!isRecord(review) || typeof review.status !== 'string' || !['pending', 'accepted', 'adjust', 'rejected'].includes(review.status)) throw Error('候选评价状态无效')
    out.candidateReview = { status: review.status as CandidateStatus }
    if (review.updatedAt) out.candidateReview.updatedAt = text(review.updatedAt, '评价时间')
  }
  return out
}
export function draft(asset: unknown): SampleMetadataRecord {
  const data = normalize(asset)
  for (const group of groups) for (const [key] of group.fields) data[key] = inputValue(data[key])
  if (['导入样例', '本地用户'].includes(data.customer)) data.customer = ''
  data.feedback = inputValue(data.feedback)
  for (const [key] of staffFields) data.staff[key] = inputValue(data.staff[key])
  data.productionRecords = data.productionRecords.map(row => {
    const result = {} as ProductionRecord
    for (const [key] of productionFields) result[key] = inputValue(row[key])
    return result
  })
  return data
}
export const SampleMetadata = Object.freeze({ groups, staffFields, productionFields, normalize, draft, inputValue })
export default SampleMetadata

/** Small, dependency-free unique id generator (time-sortable). */
export function newId(prefix = ''): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}${time}${rand}`
}

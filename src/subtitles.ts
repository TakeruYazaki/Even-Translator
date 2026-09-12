/** Conservative 22 full-width characters × 5 lines; keep every character across pages. */
export function subtitlePages(text: string, columns = 44, rows = 5): string[] {
  const lines: string[] = []
  let line = '', width = 0
  for (const character of Array.from(text.replace(/\r/g, ''))) {
    if (character === '\n') { lines.push(line); line = ''; width = 0; continue }
    const units = /^[\x20-\x7e]$/.test(character) ? 1 : 2
    if (width + units > columns) { lines.push(line); line = ''; width = 0 }
    line += character
    width += units
  }
  if (line || !lines.length) lines.push(line)
  const pages: string[] = []
  for (let i = 0; i < lines.length; i += rows) pages.push(lines.slice(i, i + rows).join('\n'))
  return pages
}

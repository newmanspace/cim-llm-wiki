function descendants(headings, index) {
  const next = headings.findIndex((section, i) =>
    i > index && section.level <= headings[index].level,
  )
  return headings.slice(index + 1, next < 0 ? headings.length : next)
}

export function checkSectionGroups(contract, headings, add, checkSections) {
  for (const rule of contract.section_groups || []) {
    const index = headings.findIndex((s) => s.level === 2 && s.title === rule.parent)
    if (index < 0) continue
    const children = descendants(headings, index)
    const groups = children.filter((s) => s.level === 3)
    if (groups.length < rule.min_groups)
      add('section_group_required', 'Not enough function design groups', headings[index], rule.min_groups, groups.length)
    groups.forEach((group, i) => {
      const prefix = rule.parent.split('.')[0] + '.' + (i + 1)
      if (!group.title.startsWith(prefix + ' ') || !group.title.slice(prefix.length).trim())
        add('section_group_number', 'Function group numbering must be sequential: ' + prefix, group)
      const scoped = descendants(children, children.indexOf(group))
      checkSections({ contract: {
        sections: rule.sections.map((title, j) => `${prefix}.${j + 1} ${title}`),
        tables: [],
      } }, scoped, add)
    })
  }
}

export function checkGroupDefinitions(contract, add) {
  for (const rule of contract.section_groups || []) {
    if (!/^\d+\.\s+\S/.test(rule.parent) || !contract.sections.includes(rule.parent))
      add('section_group_contract', 'Section group must bind a declared numbered top-level section')
    if (rule.sections.some((title) => /^\d/.test(title) || /\r|\n/.test(title)))
      add('section_group_contract', 'Function subsection names must omit numbering and line breaks')
  }
}

export function weakensSectionGroups(parent, replacement) {
  return (parent.section_groups || []).some((rule) =>
    !replacement?.section_groups?.some((next) =>
      next.parent === rule.parent && next.min_groups >= rule.min_groups &&
      JSON.stringify(next.sections.filter((title) => rule.sections.includes(title))) === JSON.stringify(rule.sections),
    ),
  )
}

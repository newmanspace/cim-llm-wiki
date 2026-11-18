let queue = Promise.resolve()
let library

export function decodeSource(source) {
  return new TextDecoder().decode(Uint8Array.from(atob(source), char => char.charCodeAt(0)))
}

export function renderDiagram(id, source, dark) {
  // Mermaid configuration is shared: initialize and render in the same queue.
  const result = queue.then(async () => {
    library ??= Promise.all([import('mermaid'), import('dompurify')]).then(([diagram, sanitizer]) => ({
      mermaid: diagram.default,
      purify: sanitizer.default(globalThis.window)
    }))
    const { mermaid, purify } = await library
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 50000,
      maxEdges: 500,
      suppressErrorRendering: true,
      secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
        'suppressErrorRendering', 'htmlLabels', 'flowchart', 'themeCSS']
    })
    const { svg } = await mermaid.render(id, source)
    // Strict Mermaid can still emit links; expose only non-interactive SVG.
    return purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['style'],
      FORBID_TAGS: ['a', 'foreignObject', 'script']
    })
  })
  queue = result.catch(() => {})
  return result
}

// Encode diagram text as data so Vue never compiles its HTML or interpolation.
export function mermaidMarkdown(md) {
  const fence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const token = tokens[index]
    if (token.info.trim() !== 'mermaid') {
      return fence(tokens, index, options, env, renderer)
    }
    const source = Buffer.from(token.content, 'utf8').toString('base64')
    return `<MermaidDiagram source="${source}" />\n`
  }
}

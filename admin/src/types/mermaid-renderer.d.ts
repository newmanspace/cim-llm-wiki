declare module '*mermaid-renderer.mjs' {
  export function renderDiagram(id: string, source: string, dark: boolean): Promise<string>
}

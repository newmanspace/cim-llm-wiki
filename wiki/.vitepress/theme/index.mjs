import DefaultTheme from 'vitepress/theme'
import WikiLayout from './WikiLayout.vue'
import MermaidDiagram from './MermaidDiagram.vue'

export default {
  extends: DefaultTheme,
  Layout: WikiLayout,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram)
  }
}

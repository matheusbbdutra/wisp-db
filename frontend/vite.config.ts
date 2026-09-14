import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// worker: { format: 'es' } é exigido pelo monaco-editor para bundlar seus
// web workers (sintaxe, sugestões) localmente via import ?worker — sem isso
// o Vite falha ao empacotar os workers do editor. Mantém o Wisp 100%
// offline (sem depender de CDN pro editor), conforme docs/ARCHITECTURE.md.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es'
  }
})

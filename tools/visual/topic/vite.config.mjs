import react from '@vitejs/plugin-react'
export default { root: new URL(".", import.meta.url).pathname, base: './', plugins: [react()], build: { outDir: '../out/topic-dist', emptyOutDir: true }, logLevel: 'warn' }

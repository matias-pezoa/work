/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // base relativa: el build funciona servido desde cualquier subruta, incluido
  // un subdirectorio de GitHub Pages.
  base: './',
  plugins: [react()],
  build: {
    // publica directo a la carpeta que sirve GitHub Pages del repo (raiz/main).
    // Queda en https://<user>.github.io/work/plataforma-parametrica/
    outDir: '../../plataforma-parametrica',
    emptyOutDir: true,
  },
  test: {
    // los modulos de geometry/ son funciones puras: corren en node, sin DOM.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

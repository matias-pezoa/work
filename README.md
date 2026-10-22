# Work — Matías Pezoa

Portafolio de experimentos y trabajos en diseño, moda, tecnología y fabricación digital.

**https://matias-pezoa.github.io/work/**

## Estructura

```text
.
├── index.html               ← home: índice WORK, perfil (con intereses) y contacto
├── styles.css               ← sistema gráfico compartido (Oswald + JetBrains Mono)
├── assets/                  ← imágenes de la home
├── <trabajo>/               ← cada trabajo en su carpeta, servido en /work/<trabajo>/
│   ├── patron-moda/
│   ├── lo-que-queda/
│   ├── pattern-key/
│   ├── analisis-sesion/
│   ├── plataforma-parametrica/   (build: no editar a mano)
│   ├── denat-decart/  denat-ia/  prueba-decart/
│   └── exercise-01/  exercise-02/  lab-02/
└── source/
    └── plataforma-textil-parametrica/   ← código fuente (Vite + React) de plataforma-parametrica
```

## Agregar un trabajo nuevo

1. Crea una carpeta en la raíz con un nombre corto en minúsculas (`mi-trabajo/`) y su `index.html`.
2. Para el link de vuelta a la home usa `../index.html`.
3. En `index.html`, dentro de `<ul class="works">`, duplica un `<li>` y ponlo primero
   (hay una plantilla comentada encima de la sección).
4. Haz commit y push. GitHub Pages lo publica en `https://matias-pezoa.github.io/work/mi-trabajo/`.

## Plataforma paramétrica

El código fuente vive en `source/plataforma-textil-parametrica/`. El build escribe directo en `plataforma-parametrica/`:

```bash
cd source/plataforma-textil-parametrica
npm install
npm run build
```

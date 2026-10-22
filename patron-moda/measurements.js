// Catálogo de medidas paramétricas del sistema.
// Método de trazado: https://thecopycat.blog/2021/03/01/como-hacer-un-patron-de-cuerpo-base/
//
//  - "cuerpo": medidas que se toman directamente sobre la persona.
//  - "tabla": valores de patronaje que el artículo toma de una tabla estándar
//    en vez de derivarlos por fórmula; quedan expuestos para ajustarlos.

export const MEASUREMENT_GROUPS = [
  {
    id: "cuerpo",
    label: "Medidas del cuerpo",
    open: true,
    fields: [
      { key: "bust", label: "Contorno de busto", unit: "cm", default: 92, min: 60, max: 140, step: 0.5 },
      { key: "waist", label: "Contorno de cintura", unit: "cm", default: 74, min: 50, max: 130, step: 0.5 },
      { key: "hip", label: "Contorno de cadera", unit: "cm", default: 98, min: 60, max: 140, step: 0.5 },
      { key: "neck", label: "Contorno de cuello", unit: "cm", default: 36, min: 28, max: 48, step: 0.5 },
      { key: "chestWidth", label: "Ancho de pecho", unit: "cm", default: 32, min: 22, max: 46, step: 0.5 },
      { key: "backWidth", label: "Ancho de espalda", unit: "cm", default: 34, min: 24, max: 48, step: 0.5 },
      { key: "frontWaistLength", label: "Largo de talle delantero", unit: "cm", default: 40, min: 30, max: 52, step: 0.5 },
      { key: "backWaistLength", label: "Largo de talle espalda", unit: "cm", default: 38, min: 28, max: 50, step: 0.5 },
      { key: "shoulderLength", label: "Largo de hombro", unit: "cm", default: 12, min: 8, max: 16, step: 0.2 },
      { key: "bustSeparation", label: "Separación de busto", unit: "cm", default: 18, min: 12, max: 26, step: 0.5 },
    ],
  },
  {
    id: "pinza-espalda",
    label: "Pinza de espalda",
    open: true,
    fields: [
      { key: "backWaistDartWidth", label: "Ancho de pinza", unit: "cm", default: 3, min: 1, max: 6, step: 0.1 },
      { key: "backDartOffset", label: "Desplazamiento (− centro / + costado)", unit: "cm", default: 0, min: -8, max: 8, step: 0.1 },
    ],
  },
  {
    id: "tabla",
    label: "Tabla de patronaje (ajuste fino)",
    open: false,
    fields: [
      { key: "frontArmholeDrop", label: "Bajada de sisa delantera", unit: "cm", default: 20, min: 14, max: 26, step: 0.5 },
      { key: "backArmholeDrop", label: "Bajada de sisa espalda", unit: "cm", default: 19, min: 14, max: 26, step: 0.5 },
      { key: "bustHeight", label: "Altura de busto", unit: "cm", default: 25, min: 18, max: 34, step: 0.5 },
      { key: "hipHeight", label: "Altura de cadera", unit: "cm", default: 20, min: 14, max: 28, step: 0.5 },
      { key: "bustDartDepth", label: "Profundidad pinza de busto", unit: "cm", default: 3, min: 1, max: 6, step: 0.2 },
      { key: "frontWaistDartWidth", label: "Ancho pinza talle delantero", unit: "cm", default: 2, min: 1, max: 4, step: 0.2 },
      { key: "frontWaistDartLength", label: "Pinza talle delantero: largo hacia cadera", unit: "cm", default: 9.5, min: 7, max: 12, step: 0.5 },
      { key: "backWaistDartLength", label: "Pinza talle espalda: largo hacia cadera", unit: "cm", default: 11.5, min: 9, max: 14, step: 0.5 },
      { key: "backDartUpperLength", label: "Pinza talle espalda: largo hacia escápula", unit: "cm", default: 12, min: 8, max: 16, step: 0.5 },
      { key: "dartRelease", label: "Despegue de pinzas del ápice", unit: "cm", default: 2.5, min: 1, max: 4, step: 0.1 },
      { key: "backNeckDrop", label: "Bajada de cuello espalda", unit: "cm", default: 2, min: 1, max: 4, step: 0.2 },
      { key: "shoulderDrop", label: "Bajada de hombro", unit: "cm", default: 4, min: 2, max: 6, step: 0.2 },
      { key: "neckHorizontalConst", label: "Constante ancho de cuello (+)", unit: "cm", default: 0.5, min: 0, max: 2, step: 0.1 },
      { key: "neckVerticalConst", label: "Constante bajada cuello del. (+)", unit: "cm", default: 2, min: 0, max: 4, step: 0.2 },
    ],
  },
];

export function defaultMeasurements() {
  const out = {};
  for (const group of MEASUREMENT_GROUPS) {
    for (const field of group.fields) out[field.key] = field.default;
  }
  return out;
}

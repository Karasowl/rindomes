# RindoMes

Aplicacion presupuestaria para planificar, registrar y cerrar finanzas personales o familiares por mes. El producto es manual-first: debe servir aunque no haya IA, pero deja espacio para captura inteligente, revision asistida e importaciones.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Convex como backend operativo
- ExcelJS para importar plantillas existentes

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run convex:dev
npm run convex:deploy
```

## Modelo funcional

La app separa conceptos que no deben mezclarse:

- Categoria: presupuesto estable, como Hogar, Comida, Transporte o Deudas.
- Subcategoria: detalle reutilizable dentro de una categoria.
- Comercio/persona: a quien se pago o de quien vino el dinero.
- Nota/tags: descripcion libre para casos especificos que no merecen crear una categoria fija.
- Moneda original: moneda en la que se registro el movimiento.
- Moneda base: moneda del hogar, convertida con la tasa fijada del dia.

Convex empieza en `convex/schema.ts` con hogares, miembros, cuentas, categorias, planes mensuales, movimientos, splits, adjuntos, bandeja de revision, reglas recurrentes, reglas locales de clasificacion, historial de aplicaciones de reglas, acciones de IA, deudas, metas, patrimonio, preferencias de alertas y cierres mensuales.

Las funciones backend iniciales viven en `convex/finance.ts`:

- `createHousehold`
- `getHouseholdSnapshot`
- `saveSnapshot`
- `addCategory`
- `addTransaction`
- `applyWorkbookImport`

`src/lib/convex-adapter.ts` transforma el estado local/importado a payloads compatibles con esas mutaciones, evitando enviar IDs locales de la plantilla como si fueran IDs reales de Convex.

## IA

La captura inteligente llama `src/app/api/ai/capture/route.ts`, que usa la Responses API con salida estructurada JSON. Configura `OPENAI_API_KEY` en `.env.local` para usar IA del servidor. `OPENAI_MODEL` permite cambiar el modelo; por defecto usa `gpt-5-mini` por costo/latencia. Si la clave falta o la llamada falla, la vista IA usa el clasificador local de `src/lib/natural-capture.ts`.

## Convex

1. Crea o enlaza el proyecto con `npm run convex:dev`.
2. Copia la URL generada por Convex a `.env.local` como `NEXT_PUBLIC_CONVEX_URL`.
3. Abre Ajustes en la app y usa `Guardar en Convex` para persistir el snapshot del hogar.
4. Usa `Cargar desde Convex` para reconstruir el workspace local desde el ultimo `householdId` guardado en este navegador.

El snapshot incluye cuentas, categorias, movimientos, splits, recibos, comentarios, acciones de IA, reglas recurrentes, reglas locales, historial de reglas aplicadas, miembros, metas, deudas, patrimonio, preferencias de alertas y cierres mensuales guiados.

## PWA y Android

La app ya expone `manifest.webmanifest`, iconos maskable y `public/sw.js` para instalacion web. Para Play Store, la ruta recomendada es publicar primero en Vercel y envolver la URL como Trusted Web Activity; asi se evita mantener dos interfaces y se conserva Convex como backend unico. Cuando se agregue Android nativo, el paquete debe apuntar al mismo dominio, validar Digital Asset Links y probar captura, recibos, importacion y modo offline antes de subir a produccion.

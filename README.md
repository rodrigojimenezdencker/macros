# Macros

App web para registrar lo que comes y seguir tus calorías y macronutrientes, al estilo de MyFitnessPal. Se instala en el móvil como una app (PWA), funciona sin conexión y guarda tus datos solo en tu dispositivo: sin cuentas, sin anuncios y sin servidores propios.

## Qué hace

- **Diario por comidas** (desayuno, comida, cena, snacks) con la cuenta de MyFitnessPal: *objetivo − comida = restantes*, y barras de proteína, carbohidratos y grasas frente a tus objetivos.
- **Buscador de alimentos** sobre [Open Food Facts](https://world.openfoodfacts.org), una base de datos abierta con millones de productos. Puedes priorizar los de tu país.
- **Escáner de código de barras** con la cámara (en Android usa el detector nativo; en iPhone, una alternativa en JavaScript). También se puede escribir el número a mano.
- **Cantidades en gramos/ml o en porciones**, con vista previa de calorías y macros antes de añadir.
- **Alimentos propios**, a partir de los valores de la etiqueta, por 100 g o por porción.
- **Recetas**: añade los ingredientes en crudo y la app calcula los macros por porción (y por 100 g si pesas la olla ya cocinada).
- **Añadido rápido** de calorías y macros cuando no tienes el alimento a mano.
- **Recientes, favoritos y copiar comidas de ayer**, para registrar en segundos lo que comes a menudo.
- **Calculadora de objetivos** (Mifflin-St Jeor + nivel de actividad + perder/mantener/ganar), o fija tus macros a mano en gramos o porcentajes.
- **Progreso**: calorías diarias desglosadas por macro, medias de 7/30/90 días y evolución del peso.
- **Copia de seguridad** en un archivo JSON para exportar e importar.

## Usarla en el móvil

Cuando esté publicada en GitHub Pages (ver abajo), abre la URL en el móvil y:

- **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar aplicación*.

Tus datos viven en el almacenamiento del navegador de ese dispositivo. Exporta una copia de seguridad de vez en cuando (Ajustes → Copia de seguridad), sobre todo antes de cambiar de móvil.

## Publicarla gratis con GitHub Pages

El repositorio incluye un flujo de GitHub Actions (`.github/workflows/deploy.yml`) que publica la app en cada push a `main`. Solo hay que activarlo una vez:

1. En GitHub, ve a **Settings → Pages**.
2. En **Source**, elige **GitHub Actions**.
3. Haz merge a `main` (o lanza el flujo *Deploy to GitHub Pages* a mano desde la pestaña Actions).

La app quedará en `https://<tu-usuario>.github.io/macros/`. La cámara para escanear necesita HTTPS, que GitHub Pages ya da.

## Desarrollo

Requiere Node 22 o superior.

```bash
npm install
npm run dev          # servidor de desarrollo en http://localhost:5173
npm run typecheck    # TypeScript
npm test             # tests unitarios (Vitest)
npm run test:e2e     # tests de extremo a extremo (Playwright; Open Food Facts va simulado)
npm run build        # versión de producción en dist/
```

Si `npm install` falla con `Cannot read properties of null (reading 'edgesOut')` al añadir paquetes nuevos, es un fallo de npm 10: usa `npx npm@11 install <paquete>`.

### Cómo está hecho

- **React + TypeScript + Vite**, con `vite-plugin-pwa` para que se pueda instalar y funcione sin conexión.
- **IndexedDB** (vía Dexie) como base de datos local: `src/db.ts`.
- **Open Food Facts** se consulta directamente desde el navegador (`src/lib/openfoodfacts.ts`). Se busca al pulsar *Buscar*, no a cada tecla, para respetar sus límites de uso.
- Cálculos de nutrición y objetivos en `src/lib/` (con tests al lado).
- Las entradas del diario guardan una copia del alimento: si después editas o borras el alimento, tu historial no cambia.

Los datos de productos son © colaboradores de Open Food Facts, bajo licencia [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

# Macros

App web para registrar lo que comes y seguir tus calorías y macronutrientes, al estilo de MyFitnessPal. Se instala en el móvil como una app (PWA) y funciona sin conexión. Con una cuenta (Supabase, gratis) tus datos se guardan en la nube y se sincronizan entre tus dispositivos; sin configurarla, la app funciona solo en el dispositivo.

## Qué hace

- **Diario por comidas** (desayuno, comida, cena, snacks) con la cuenta de MyFitnessPal: *objetivo − comida = restantes*, y barras de proteína, carbohidratos y grasas frente a tus objetivos.
- **Buscador de alimentos** sobre [Open Food Facts](https://world.openfoodfacts.org), una base de datos abierta con millones de productos. Puedes priorizar los de tu país.
- **Escáner de código de barras** con la cámara (en Android usa el detector nativo; en iPhone, una alternativa en JavaScript). También se puede escribir el número a mano.
- **Cantidades en la unidad que prefieras**: gramos, kilos, mililitros, litros, vasos, tazas, cucharadas, cucharaditas o porciones, con vista previa de calorías y macros antes de añadir. La app recuerda la última cantidad que usaste con cada alimento.
- **Alimentos propios**, a partir de los valores de la etiqueta, por 100 g o por porción.
- **Recetas**: añade los ingredientes en crudo y la app calcula los macros por porción (y por 100 g si pesas la olla ya cocinada).
- **Añadido rápido** de calorías y macros cuando no tienes el alimento a mano.
- **Recientes, favoritos y copiar comidas de ayer**, para registrar en segundos lo que comes a menudo.
- **Calculadora de objetivos** (Mifflin-St Jeor + nivel de actividad + perder/mantener/ganar), o fija tus macros a mano en gramos o porcentajes.
- **Progreso**: calorías diarias desglosadas por macro, medias de 7/30/90 días y evolución del peso.
- **Cuenta con correo y contraseña**: tus datos se guardan en tu cuenta y se sincronizan entre dispositivos (con recuperación y cambio de contraseña).
- **Copia de seguridad** en un archivo JSON para exportar e importar.

## Usarla en el móvil

Cuando esté publicada en GitHub Pages (ver abajo), abre la URL en el móvil y:

- **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar aplicación*.

Con la cuenta configurada (ver abajo), entra con tu correo en cada dispositivo y verás los mismos datos. Sin cuenta, los datos viven solo en el navegador de ese dispositivo: exporta una copia de seguridad de vez en cuando (Ajustes → Copia de seguridad).

## Publicarla gratis con GitHub Pages

El repositorio incluye un flujo de GitHub Actions (`.github/workflows/deploy.yml`) que publica la app en cada push a `main`. Solo hay que activarlo una vez:

1. En GitHub, ve a **Settings → Pages**.
2. En **Source**, elige **GitHub Actions**.
3. Haz merge a `main` (o lanza el flujo *Deploy to GitHub Pages* a mano desde la pestaña Actions).

La app quedará en `https://<tu-usuario>.github.io/macros/`. La cámara para escanear necesita HTTPS, que GitHub Pages ya da.

## Cuenta y sincronización (Supabase)

La app guarda los datos en [Supabase](https://supabase.com) (base de datos Postgres + inicio de sesión; el plan gratuito sobra para uso personal). Configuración, una sola vez:

1. **Crea el proyecto.** Entra en supabase.com → *New project*. Elige una región cercana (p. ej. *West EU*) y guarda la contraseña de la base de datos (no la necesitará la app).
2. **Crea la tabla.** En el proyecto: *SQL Editor* → *New query* → pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) → *Run*. Crea la tabla `records` con seguridad por filas (cada usuario solo ve sus datos) y la función de sincronización.
3. **Configura el inicio de sesión.** *Authentication* → *URL Configuration*:
   - *Site URL*: `https://<tu-usuario>.github.io/macros/`
   - *Redirect URLs*: añade esa misma URL (y `http://localhost:5173/` si desarrollas en local).
4. **Añade el código al correo de recuperación.** *Authentication* → *Emails* → *Reset Password*: añade al mensaje una línea como `<p>Tu código: {{ .Token }}</p>`. Así puedes cambiar la contraseña escribiendo el código en la app, también desde la app instalada en el iPhone. El enlace del correo solo funciona en el navegador donde la pediste.
5. **Copia las claves.** *Project Settings* → *API Keys*: la **Project URL** y la **publishable key** (`sb_publishable_…`, o la *anon key* en proyectos antiguos). Son públicas por diseño: los datos los protege la seguridad por filas.
6. **Pásaselas a GitHub.** En el repositorio: *Settings* → *Secrets and variables* → *Actions* → pestaña *Variables* → crea `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`.
7. **Publica.** Lanza *Actions* → *Deploy to GitHub Pages* → *Run workflow* (o haz merge a `main`).
8. **Crea tu cuenta y cierra el registro.** Abre la app, pulsa *Crear cuenta* y confirma el correo. Después, en Supabase: *Authentication* → *Sign In / Providers* → desactiva *Allow new users to sign up*. Así nadie más puede crear cuentas en tu proyecto. Las claves de la app son públicas y, con el registro abierto, cualquiera podría llenar tu base de datos gratuita.

La primera vez que entres en un dispositivo que ya tenía datos guardados, esos datos se suben a tu cuenta. Si dos dispositivos tenían datos de antes de las cuentas, lo que ya esté en la cuenta tiene prioridad, y las entradas repetidas (por ejemplo, de una copia de seguridad restaurada) se fusionan.

Cómo funciona: cada dispositivo guarda una copia local (IndexedDB) y sube y baja los cambios en segundo plano: al abrir la app, al volver a ella, tras cada cambio y en tiempo real cuando otro dispositivo cambia algo. Si dos dispositivos editan lo mismo sin conexión, gana el cambio más reciente. La app abre y funciona sin conexión aunque haya caducado la sesión; sincroniza al volver la red. Al cerrar sesión se borra la copia local de ese dispositivo (sigue en tu cuenta).

Para probarlo en local, copia `.env.example` a `.env.local` y rellena las dos variables.

## Desarrollo

Requiere Node 22 o superior.

```bash
npm install
npm run dev          # servidor de desarrollo en http://localhost:5173
npm run typecheck    # TypeScript
npm test             # tests unitarios (Vitest)
npm run test:e2e     # tests de extremo a extremo (Playwright; Open Food Facts y Supabase van simulados)
npm run build        # versión de producción en dist/
```

Si `npm install` falla con `Cannot read properties of null (reading 'edgesOut')` al añadir paquetes nuevos, es un fallo de npm 10: usa `npx npm@11 install <paquete>`.

### Cómo está hecho

- **React + TypeScript + Vite**, con `vite-plugin-pwa` para que se pueda instalar y funcione sin conexión.
- **IndexedDB** (vía Dexie) como base de datos local: `src/db.ts`.
- **Sincronización** en `src/sync/` (seguimiento de cambios y motor de sincronización, con tests de dos dispositivos) y **cuenta** en `src/cloud/` (cliente de Supabase, sesión y pantallas de acceso). El esquema de la base de datos está en `supabase/schema.sql`.
- **Open Food Facts** se consulta directamente desde el navegador (`src/lib/openfoodfacts.ts`). Se busca al pulsar *Buscar*, no a cada tecla, para respetar sus límites de uso. Su buscador falla a menudo durante un momento (responde 503 sin cabeceras CORS, y el navegador lo ve como un fallo de red), así que la app lo reintenta sola dos veces antes de avisar. Su buscador nuevo (`search.openfoodfacts.org`) no se puede usar desde el navegador porque no envía cabeceras CORS.
- Cálculos de nutrición y objetivos en `src/lib/` (con tests al lado).
- Las entradas del diario guardan una copia del alimento: si después editas o borras el alimento, tu historial no cambia.
- Las cantidades se guardan siempre en gramos o ml (la unidad de los valores por 100 del alimento); vasos, tazas, litros o cucharadas solo cambian cómo se escriben y se muestran (`src/lib/units.ts`). Entre peso y volumen se cuenta 1 ml ≈ 1 g, y la app lo indica como aproximado.

Los datos de productos son © colaboradores de Open Food Facts, bajo licencia [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

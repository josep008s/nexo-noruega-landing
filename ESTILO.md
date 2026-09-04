# Sistema visual de nexonoruega.com

Este documento es la fuente de verdad del diseño del sitio. Si tocas una página y te desvías de aquí, el guard (`node scripts/norsk_prelaunch_check.mjs`) te lo dice antes de que llegue a producción.

## Por qué no hay un CSS compartido

El sitio es estático y sin build: cada página se sirve tal cual, con su CSS dentro de un `<style>`. Es una decisión deliberada (cero dependencias, cada página se abre sola, el preview no necesita nada). El precio es que los tokens de color y tipografía están duplicados en todos los archivos.

Para que esa duplicación no se convierta en deriva, el bloque `:root` es idéntico en todas las páginas y el guard comprueba que lo sea. Cambiar un token significa cambiarlo en todos los archivos de la lista de abajo, no en uno.

## Los dos temas

La home (`/index.html`) es **oscura**: fondo noche, texto nieve. Es la cara editorial de la marca y no se toca.

Todo lo demás (`/norsk/*`, `/pass/*`) es **claro**: fondo nieve, texto noche. Es la cara de producto, donde la gente lee instrucciones, compara exámenes y practica. La legibilidad manda sobre el efecto.

## Bloque `:root` canónico

Este bloque va literal en cada página del tema claro:

```css
:root{
  --noche:#0E1B26; --nieve:#F3F5F4; --aurora:#3FCB94; --fiordo:#2C5A72; --niebla:#8DA1AB;
  --blanco:#FFFFFF;
  --tinta-suave:rgba(14,27,38,.72);
  --linea-clara:rgba(14,27,38,.14);
  --linea-oscura:rgba(243,245,244,.12);
  --sombra-clara:0 14px 34px rgba(14,27,38,.08);
  --alerta:#8F5A0F;
  --sg:"Space Grotesk",system-ui,sans-serif;
  --serif:"Source Serif 4",Georgia,serif;
  --caesar:"Caesar Dressing",var(--sg);
  --ease:cubic-bezier(0.16,1,0.3,1);
  --ancho:860px;
}
```

## Qué significa cada color y dónde se usa

| Token | Valor | Uso |
|---|---|---|
| `--noche` | `#0E1B26` | Fondo de la home y de bandas oscuras puntuales. En tema claro, es el color del texto principal. |
| `--nieve` | `#F3F5F4` | Fondo de página en tema claro. Texto sobre fondo oscuro. |
| `--aurora` | `#3FCB94` | Acento vivo. Fondo de botones, subrayados, bordes, barras. |
| `--fiordo` | `#2C5A72` | Azul de apoyo. Es el acento **tipográfico** del tema claro: kickers, cifras grandes, texto secundario. |
| `--niebla` | `#8DA1AB` | Texto secundario **solo sobre fondo oscuro**. |
| `--blanco` | `#FFFFFF` | Superficies elevadas sobre nieve: tarjetas, planes, cajas. |
| `--tinta-suave` | `rgba(14,27,38,.72)` | Párrafos secundarios y ledes sobre fondo claro. |
| `--alerta` | `#8F5A0F` | Avisos sobre fondo claro (reloj con poco tiempo, estados de atención). El ámbar claro `#E0A458` solo vale como relleno de barra, nunca como texto. |

## Reglas de contraste (no negociables)

Sobre fondo claro, el texto tiene que superar el 4,5:1 de la norma AA. Tres reglas cubren el 100% de los casos:

1. **`--aurora` nunca es color de texto sobre claro.** Sobre nieve da 1,7:1, es ilegible. Aurora va de fondo (con texto `--noche` encima, que da 9,5:1), de subrayado, de borde o de barra.
2. **`--niebla` nunca es color de texto sobre claro.** Da 2,5:1. Es un color para fondos oscuros. Sobre claro, usa `--tinta-suave` o `--fiordo`.
3. **El acento tipográfico del tema claro es `--fiordo`** (6,8:1). Los kickers, las cifras Caesar y los metadatos van en fiordo.

## Tipografía

Tres familias, autoalojadas en `/fonts/` como ficheros `woff2` (subconjunto latino, licencia SIL OFL, ver `fonts/LICENSES.txt`) y declaradas una sola vez en `/fonts/fonts.css`. Esa hoja es la única excepción al "sin CSS compartido": solo contiene `@font-face`, ningún token. Ningún navegador vuelve a pedir nada a Google, que era el único tercero de la web.

- **Space Grotesk** (500, 700): titulares, kickers, interfaz, botones, metadatos.
- **Source Serif 4** (400, 600, cursiva): cuerpo de texto. Es la fuente por defecto del `body`.
- **Caesar Dressing**: solo la firma de marca y las cifras grandes de dato. Sobre claro, en `--fiordo`.

Enlace canónico, el mismo en las 17 páginas (sin `preconnect` a Google):

```html
<link rel="stylesheet" href="/fonts/fonts.css">
```

## Firmas visuales que se conservan

- **Grano**: capa fija con ruido SVG (`feTurbulence`). Sobre oscuro va con `opacity:.035` y `mix-blend-mode:overlay`. Sobre claro, `opacity:.028` y `mix-blend-mode:multiply`.
- **Aurora animada**: gradiente radial verde muy tenue que deriva en 46 segundos (`@keyframes deriva`). Sobre claro se baja a `rgba(63,203,148,.10)`.
- **Curva de entrada**: `--ease: cubic-bezier(0.16,1,0.3,1)` en todas las transiciones.
- **Ancho de lectura**: 860px.
- **Revelado por scroll**: clase `.reveal` con `IntersectionObserver`, con red de seguridad a los 6 segundos y desactivado bajo `prefers-reduced-motion`.

## Prohibiciones

- **`#0b6f63`**: el verde oscuro que usaba la landing del Sprint oral. Fuera del sistema. Donde hacía de texto, va `--fiordo`; donde hacía de fondo o subrayado, va `--aurora`.
- Cualquier color hexadecimal de marca que no esté en la tabla de arriba.
- El **em dash** (`—`) en texto publicado. Puntos, comas y saltos de línea.

## Cabecera y pie unificados

Las páginas de producto comparten cabecera y pie para que /norsk y /pass se lean como una sola casa. La cabecera es clara, con blur, y su navegación es siempre la misma: `Norsk` a `/norsk/`, `Ciudadanía` a `/pass/`, `Nexo Noruega` a la home.

La sección activa se distingue con peso 700 y una línea Aurora de 3 px. El patrón es idéntico en `Norsk` y `Ciudadanía`; no se sustituye el tercer enlace por una acción del producto.

Etiquetas vigentes desde el 02.09.2026: `Norsk` (antes `Noruego`, porque es el nombre del producto, coincide con la URL y es la palabra que el lector usa a diario) y `Ciudadanía` (antes `Exámenes`, que era ambiguo: la Ruta B1 también prepara un examen). No se usa "pasaporte" en la navegación: los exámenes no lo garantizan y la regla del producto es preparación, no promesa.


## Nombres

- Tres casas y un nombre por casa: `Nexo Noruega` (home, calculadora y newsletter), `NEXO NORSK` (todo `/norsk`) y `NEXO PASS` (todo `/pass`). En la web, NORSK y PASS son dos productos hermanos bajo Nexo Noruega; "línea Idioma" y "línea Ciudadanía" son vocabulario interno de los documentos de trabajo.
- Los nombres de producto van siempre en mayúsculas, como el logotipo, también en rótulos pequeños y en prosa: `NEXO NORSK`, `NEXO PASS`. La marca editorial va en alta y baja: `Nexo Noruega`.
- El logotipo de cada casa enlaza al inicio de esa casa (`/norsk/`, `/pass/` o `/`). El enlace a la home de Nexo Noruega ya está en la navegación, así que el logotipo no lo repite.
- Títulos de pestaña: `Qué es · CASA`, siempre con punto medio, nunca con barra vertical.
- El entrenamiento oral tiene un solo nombre público, `Entrenamiento oral`, en `/norsk/entrenamiento-oral/`. Larsito es el personaje con el que se practica, no un producto aparte. La URL antigua `/norsk/sprint-oral/` redirige de forma permanente.
- Las partes del curso se nombran con verbos: `Hablar`, `Escuchar`, `Leer`, `Escribir` y `Simulacros`, más `Punto de partida`, `Los 16 mecanismos`, `Banco de expresiones` y `Practicar con Larsito`. Los tomos del cuaderno en PDF usan los mismos nombres.
- En público se dice `curso`. `Ruta` es vocabulario interno y no aparece en la web.

## Hero de las dos entradas de producto

`/norsk/` y `/pass/` comparten exactamente la geometría de entrada: H1 a `clamp(2.1rem,5.4vw,3.4rem)` y `17ch`, entradilla a `56ch`, CTA con `16px 32px` y hero con `56px 0 52px` en escritorio y `38px 0 44px` en móvil.

Cada titular señala una única promesa con `<mark class="marcado">`: `Vuelve a intentarlo` en Norsk y `explicado en español` en Ciudadanía. El resaltado Aurora es semántico, no una selección de texto simulada ni un adorno repartido por el hero.

En `/norsk/`, la promesa se demuestra antes de explicarse: el hero contiene una micropráctica funcional con dos respuestas y una corrección exacta. No se usa un mockup ni una lista de prestaciones en ese primer contacto. La entrada principal de quien ya tiene base abre `M01`; el diagnóstico existe como herramienta opcional, nunca como peaje.

El método visible de NEXO NORSK se nombra siempre `Responde · Repara · Repite`:

1. `Responde`: el alumno habla, ordena, elige o escribe sin ver el modelo.
2. `Repara`: la devolución localiza una diferencia y explica el mecanismo que la provoca.
3. `Repite`: el alumno vuelve a usar el mecanismo con datos nuevos.

La recuperación a los 1, 3, 7 y 14 días funciona por detrás y se explica como comportamiento del sistema, no como un cuarto paso que el alumno deba gestionar.

```html
<header>
  <div class="head-inner">
    <a class="marca" href="/norsk/" aria-label="NEXO NORSK, inicio">
      <svg viewBox="0 0 800 800" aria-hidden="true">
        <path d="M223 532 L223 298 L320 402 L320 265" fill="none" stroke="#2C5A72" stroke-opacity=".45" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M478 532 L478 264 L577 398 L577 532" fill="none" stroke="#2C5A72" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>NEXO <b>NORSK</b></span>
    </a>
    <nav class="head-nav" aria-label="Secciones">
      <a href="/norsk/">Norsk</a>
      <a href="/pass/">Ciudadanía</a>
      <a href="https://www.nexonoruega.com">Nexo Noruega</a>
    </nav>
  </div>
</header>
```

El pie lleva siempre el aviso de no afiliación y los enlaces legales:

```html
<footer>
  <div class="foot-inner">
    <p>Nexo Noruega no está afiliado a HK-dir, a UDI ni a ningún organismo oficial noruego.</p>
    <nav class="footer-links" aria-label="Enlaces">
      <a href="https://www.nexonoruega.com">Inicio</a>
      <a href="/norsk/">Norsk</a>
      <a href="/pass/">Ciudadanía</a>
      <a href="/pass/condiciones/">Condiciones</a>
      <a href="/pass/privacidad/">Privacidad</a>
      <a href="https://nexonoruega.substack.com">Newsletter</a>
    </nav>
  </div>
</footer>
```

## Páginas que siguen el tema claro

`norsk/index.html`, `norsk/entrenamiento-oral/index.html`, `norsk/curso/index.html`, `norsk/larsito/index.html`, `pass/index.html`, `pass/app/index.html`, `pass/leccion-0/index.html`, `pass/que-examen-necesitas/index.html`, `pass/como-inscribirse/index.html`, `pass/preguntas-de-ejemplo/index.html`, `pass/requisitos-ciudadania-noruega/index.html`, `pass/condiciones/index.html`, `pass/privacidad/index.html`, `pass/acceso/index.html` y `pass/gracias/index.html`. El guard (`scripts/norsk_prelaunch_check.mjs`, lista `TEMA_CLARO`) vigila exactamente esta lista.

Solo dos superficies son oscuras, y las dos a propósito: `index.html` (la home, la cara editorial de la marca) y `sueldo/index.html` (la calculadora, que es una herramienta editorial de Nexo Noruega y no una página de producto). Las dos llevan la misma navegación de tres enlaces y el mismo pie que el resto, con los colores del tema oscuro.

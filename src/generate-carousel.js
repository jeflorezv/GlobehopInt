import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from './utils/retry.js';
import { parseJson } from './utils/parse-json.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-6';

// Mirrors generate-content.js — picked at code level so Claude cannot override.
const AUSTRALIA_LOCATIONS = [
  { city: 'Melbourne', landmark: 'Federation Square at dusk with Flinders Street Station and its ornate clocks across the tram intersection, warm city glow', exclude: '' },
  { city: 'Melbourne', landmark: "Hosier Lane, Melbourne's iconic street-art laneway, both walls covered in vivid graffiti, afternoon light filtering down", exclude: '' },
  { city: 'Melbourne', landmark: 'St Kilda Beach foreshore at golden hour with the historic St Kilda pier extending into Port Phillip Bay', exclude: '' },
  { city: 'Melbourne', landmark: 'Royal Botanic Gardens Melbourne, manicured lake path with Australian native flora, towering eucalyptus trees', exclude: '' },
  { city: 'Brisbane', landmark: "Story Bridge, Brisbane's great steel arch bridge lit at dusk, Brisbane River winding below, South Bank in the distance", exclude: '' },
  { city: 'Brisbane', landmark: 'South Bank Parklands artificial beach with lifeguard tower and Brisbane CBD skyline rising behind the palm trees', exclude: '' },
  { city: 'Brisbane', landmark: 'Lone Pine Koala Sanctuary — a fluffy koala clinging to a eucalyptus branch in close foreground, sanctuary gardens behind', exclude: '' },
  { city: 'Perth', landmark: 'Kings Park hilltop lookout at golden hour, Swan River curving through the valley far below, Perth city skyline on the horizon', exclude: '' },
  { city: 'Perth', landmark: 'Cottesloe Beach, calm Indian Ocean water with turquoise shallows, white sand, limestone rock formations at the far end', exclude: '' },
  { city: 'Perth', landmark: 'Rottnest Island — a wild quokka sitting in sun-drenched coastal scrub with Pinky Beach turquoise water in the background', exclude: '' },
  { city: 'Adelaide', landmark: 'Glenelg Beach jetty stretching into calm blue water at sunrise, pastel sky, Adelaide seaside suburb behind', exclude: '' },
  { city: 'Adelaide', landmark: 'Adelaide Central Market, vibrant multicultural produce and food stalls under warm market lighting, shoppers browsing', exclude: '' },
  { city: 'Gold Coast', landmark: 'Burleigh Heads National Park volcanic headland — surfers riding turquoise waves below, rainforest-covered rocky point above', exclude: '' },
  { city: 'Gold Coast', landmark: 'Surfers Paradise beach at sunrise, high-rise skyline reflected in the wet sand at low tide, warm amber light', exclude: '' },
  { city: 'Cairns', landmark: 'Great Barrier Reef pontoon platform, crystal-clear turquoise water, coral reef visible beneath the surface, open ocean horizon', exclude: '' },
  { city: 'Cairns', landmark: 'Daintree Rainforest canopy walk — ancient tree ferns and towering palms, dappled morning light through the canopy', exclude: '' },
  { city: 'Sydney', landmark: 'Bondi to Coogee coastal walk, dramatic sandstone cliffs, turquoise ocean below, coastal heathland in foreground', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge anywhere in this image' },
  { city: 'Sydney', landmark: 'Darling Harbour waterfront at dusk, water reflections, city lights beginning to glow, Pyrmont Bridge in background', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge anywhere in this image' },
  { city: 'Sydney', landmark: 'Blue Mountains Echo Point lookout — eucalyptus-filled valley stretching to the horizon, Three Sisters rock formation visible', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge' },
  { city: 'Hobart', landmark: 'Salamanca Market, Georgian sandstone warehouses converted to market stalls, crisp morning light, fresh produce and craft vendors', exclude: '' },
  { city: 'Darwin', landmark: 'Mindil Beach Sunset Market — amber sunset blazing over the Timor Sea, food stall silhouettes, crowd watching the colours fade', exclude: '' },
  { city: 'Kangaroo Island', landmark: 'Wild kangaroos grazing on coastal heathland at dawn, Flinders Chase National Park cliffs and Southern Ocean in the background', exclude: '' },
];

const SYSTEM = `Eres el estratega de contenido para GlobeHop International, agencia colombiana boutique de educación internacional (Australia, Irlanda, Canadá, Malta, España, Dubai, EE.UU.).

IDIOMA Y VOZ
- Español colombiano, tuteo, tono cálido e inspirador (amigo que ya estudió afuera)
- Menciona GlobeHop naturalmente — nunca suenes corporativo ni vendedor
- Enfoca en transformación personal, no en datos turísticos

CAPTION INSTAGRAM
Estructura: hook (1 frase) → dato o beneficio sorprendente → "👉 Desliza para ver más" → CTA con «KEYWORD» → 10-15 hashtags
Longitud: 120-180 palabras. Emojis con moderación (2-4 máx).

SELECCIÓN DE TEMPLATE (elige el más adecuado según el pillar + audiencia + destino)
T01 Destination Discovery   → S2:oportunidad S3:beneficio S4:beneficio S5:transformación       [destination_spotlight]
T02 Student Success Story   → S2:reto S3:decisión S4:viaje S5:resultado                        [student_story]
T03 Parent Content          → S2:miedo S3:realidad S4:seguridad S5:éxito                      [padres]
T04 Visa Mistakes           → S2:error#1 S3:error#2 S4:error#3 S5:solución                    [visa_tip]
T05 Visa Requirements       → S2:requisito1 S3:requisito2 S4:requisito3 S5:pro tip            [visa_tip]
T06 Cost Breakdown          → S2:matrícula S3:alojamiento S4:vida diaria S5:realidad          [visa_tip/destination]
T07 Myth vs Reality         → S2:mito S3:realidad S4:mito S5:realidad                        [any]
T08 Work While Studying     → S2:derechos S3:trabajos típicos S4:beneficios S5:ejemplo real  [destination_spotlight]
T09 Compare Destinations    → S2:destino A S3:destino B S4:destino C S5:mejor fit            [destination_spotlight]
T10 Study Pathway           → S2:elige destino S3:elige curso S4:aplica S5:visa              [agency_promo]
T11 Career Transformation   → S2:oportunidad S3:estudio S4:habilidades S5:futuro             [profesionales]
T12 Student Life            → S2:campus S3:amigos S4:viajes S5:crecimiento                   [estudiantes]
T13 English Improvement     → S2:nivel actual S3:inmersión S4:práctica diaria S5:resultados  [visa_tip/destination]
T14 FAQ Carousel            → S2:FAQ#1 S3:FAQ#2 S4:FAQ#3 S5:FAQ#4                            [any]
T15 Timeline 90 Days        → S2:mes1 S3:mes2 S4:mes3 S5:salida                              [agency_promo]
T16 Age Objections          → S2:18-24 S3:25-34 S4:35+ S5:historia de éxito                [adultos]
T17 Destination Checklist   → S2:check1 S3:check2 S4:check3 S5:bonus tip                    [destination_spotlight]
T18 Student Testimonial     → S2:problema S3:experiencia S4:resultado S5:recomendación       [student_story]
T19 GlobeHop Difference     → S2:soporte personalizado S3:visas S4:cuidado S5:resultados     [agency_promo]
T20 Lead Generation         → S2:oportunidad S3:beneficio1 S4:beneficio2 S5:urgencia         [agency_promo]

LAYOUTS DISPONIBLES PARA SLIDES 2-5
Elige el que mejor exprese cada slide. No repitas el mismo layout en slides consecutivos.
- "statement": afirmación contundente, contraste antes/después, mito/realidad, o insight único
- "list": cuando el slide tiene 3-4 ítems distintos (requisitos, pasos, beneficios, checklist)
- "fact": cuando el slide gira en torno a una cifra o estadística clave

ESPECIFICACIONES POR LAYOUT — respeta ESTRICTAMENTE los límites de caracteres (se renderiza en pantalla):
hook       → headline: ≤50 chars   | subtext: ≤40 chars (opcional, null si no aplica)
statement  → headline: ≤60 chars   | body: ≤75 chars (opcional) | tag: ≤20 chars (opcional, etiqueta Mint sobre el headline — ej: "VIDA", "TRABAJO", "PROCESO", "VISA")
list       → headline: ≤45 chars   | items: array de 3-4 strings, c/u ≤35 chars
fact       → headline: ≤40 chars (opcional) | stat: ≤8 chars | statLabel: ≤35 chars | body: ≤55 chars (opcional)
cta        → headline: ≤55 chars | keyword: nombre del destino en MAYÚSCULAS | action: ≤25 chars (verbo de acción claro — ej: "Escríbenos por DM hoy", "Escríbenos al WhatsApp", "Link en bio →") | offer: ≤30 chars | savePrompt: ≤55 chars

SLIDES FIJOS:
- Slide 1: layout siempre "hook"
- Slide 6: layout siempre "cta" — keyword = destino en MAYÚSCULAS (IRLANDA, AUSTRALIA, CANADA, MALTA, DUBAI, ESPAÑA)

REGLAS DE CONTENIDO
- Textos en español. Sin él/ella — usa "tú" o formas neutras.
- Headlines sin puntuación extraña al final — se ven mejor en negrita sin punto ni coma
- COSTOS Y FONDOS: si mencionas cifras de dinero, siempre expresa en pesos colombianos (COP) y añade "aprox." antes del valor. Ejemplo: "aprox. $15.000.000 COP". Nunca menciones valores exactos — aclara que el monto real se define en la asesoría gratuita con GlobeHop.
- HOOKS (slide 1): abre con paradoja, contraste o lo que nadie dice. No empieces con el nombre del destino. Buenos ejemplos: "Lo que aprendes en Dubái va más allá del inglés", "El destino más subestimado para aprender inglés", "Muchos piensan en estudiar inglés. Pocos consideran esto".
- LISTAS: usa ✖ al inicio de cada ítem cuando el slide muestra errores o mitos; usa ✓ cuando muestra soluciones o checklists. El símbolo va siempre dentro del texto del ítem. Ejemplo de error: "✖ Fondos depositados a último momento". Ejemplo de solución: "✓ Carta de intención clara".
- SLIDE 5: siempre es la "solución" — da valor real antes del CTA. Usa layout "list" con ítems ✓. Los pasos deben ser aplicables a cualquier estudiante (no solo menores): documentación, presupuesto, timing, asesoría. Evita ítems específicos de menores de edad.
- ESTADÍSTICAS DE INMERSIÓN: nunca uses horas específicas (como "8 hrs de inglés al día"). Prefiere afirmaciones cualitativas: "Inmersión total en inglés", "Practica inglés dentro y fuera del aula".
- TAG en statement slides: usa el campo 'tag' para añadir una etiqueta Mint corta y en mayúsculas que contextualice el headline (ej: "TRABAJO", "VIDA", "PROCESO", "VISA"). Úsalo en 1-2 slides statement por carrusel donde añada contexto real.
- CTA (slide 6): headline interrogativo ("¿Quieres aplicar a [DESTINO] sin errores?"). savePrompt con dos frases: guardar + compartir ("Guarda este carrusel · Compártelo con alguien que quiera estudiar").

IMAGE PROMPTS (imagePrompt por slide, en inglés para Ideogram)
Cada slide tendrá una fotografía de fondo con overlay oscuro — elige escenas con profundidad de campo, cielos abiertos o composiciones claras donde el texto superpuesto sea legible.
- Slide 1: vista panorámica o icónica del destino, hora dorada o luz dramática
- Slides 2-5: siempre incluye personas — estudiante en campus o aula, familia en reunión de asesoría, joven en aeropuerto o calle de la ciudad, profesional en clase. Combina el entorno del destino con presencia humana real.
- Slide 6: escena aspiracional — estudiante celebrando con bandera del país, skyline al atardecer, o campus con jóvenes felices
Estilo fotográfico: documentary style, photojournalistic lighting, natural skin texture, visible pores. Evita: perfect skin, beauty photography, ultra attractive faces, AI-looking people. Sin texto ni logos. 2-3 oraciones en inglés.

DESTINO AUSTRALIA — CIUDAD Y LANDMARK:
La ciudad y el landmark exactos se especifican en el mensaje del usuario como CITY LOCK. Síguelos al pie de la letra en todos los imagePrompts del carrusel. Australia cubre todo el país: ciudades (Melbourne, Brisbane, Perth, Adelaide, Gold Coast, Cairns, Sydney, Hobart, Darwin), fauna (koalas, quokkas, canguros) y maravillas naturales (Gran Barrera de Coral, Daintree, Montañas Azules). Respeta también la regla de exclusión del CITY LOCK si se indica.

RESPONDE SOLO CON JSON VÁLIDO, sin texto antes ni después:
{
  "caption": "Caption completo con hashtags",
  "template": 1,
  "templateName": "Destination Discovery",
  "keyword": "IRLANDA",
  "slides": [
    { "slideNumber": 1, "layout": "hook", "headline": "...", "subtext": "...", "imagePrompt": "Aerial view of Dublin city centre at golden hour, River Liffey and Ha'penny Bridge visible, warm light, editorial travel photography" },
    { "slideNumber": 2, "layout": "list", "headline": "...", "items": ["...", "...", "..."], "imagePrompt": "..." },
    { "slideNumber": 3, "layout": "fact", "headline": "...", "stat": "...", "statLabel": "...", "body": "...", "imagePrompt": "..." },
    { "slideNumber": 4, "layout": "statement", "tag": "TRABAJO", "headline": "...", "body": "...", "imagePrompt": "..." },
    { "slideNumber": 5, "layout": "list", "headline": "...", "items": ["✓ ...", "✓ ...", "✓ ..."], "imagePrompt": "..." },
    { "slideNumber": 6, "layout": "cta", "headline": "¿Quieres aplicar a IRLANDA sin errores?", "keyword": "IRLANDA", "action": "Escríbenos por DM hoy", "offer": "Revisamos tu caso gratis", "savePrompt": "Guarda este carrusel · Compártelo con alguien que quiera estudiar", "imagePrompt": "..." }
  ]
}`.trim();

export async function generateCarousel(record, ctx) {
  const destino  = record['Destino/Tema'] ?? '';
  const pillar   = record['Pilar']        ?? record['Pillar'] ?? '';
  const audience = record['Audiencia']    ?? 'jóvenes colombianos 18-30';
  const cta      = record['CTA']          ?? 'Escríbenos por DM';

  const isAustralia = /australia/i.test(destino);
  const ausLoc = isAustralia
    ? AUSTRALIA_LOCATIONS[Math.floor(Math.random() * AUSTRALIA_LOCATIONS.length)]
    : null;

  const userMessage = [
    `Destino: ${destino}`,
    `Pillar: ${pillar}`,
    `Audiencia: ${audience}`,
    `CTA: ${cta}`,
    ausLoc ? [
      `CITY LOCK — OBLIGATORIO (no negociable, anula todas las demás instrucciones de ubicación):`,
      `  Ciudad: ${ausLoc.city}, Australia`,
      `  Landmark de fondo: ${ausLoc.landmark}`,
      ausLoc.exclude ? `  IMPORTANTE: ${ausLoc.exclude}` : '',
      `Todos los imagePrompts del carrusel deben estar ambientados en ${ausLoc.city} usando el landmark indicado. No uses ninguna otra ciudad australiana.`,
    ].filter(Boolean).join('\n') : '',
  ].filter(Boolean).join('\n');

  const msg = await withRetry(() =>
    client.messages.create({
      model:      MODEL,
      max_tokens: 3000,
      system: [
        {
          type:          'text',
          text:          SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const raw  = msg.content[0]?.text ?? '';
  const json = parseJson(raw, 'generate-carousel');

  const { caption, template, templateName, keyword, slides } = json;

  if (!Array.isArray(slides) || slides.length !== 6) {
    throw new Error(
      `[generate-carousel] Expected 6 slides, got ${slides?.length ?? 0}\nRaw: ${raw.slice(0, 300)}`
    );
  }

  console.log(`[generate-carousel] T${String(template).padStart(2, '0')} "${templateName}" — "${destino}"`);

  return { ...ctx, caption, template, templateName, keyword, slides };
}

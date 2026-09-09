# GlobeHop · Guía del equipo de marketing
**Sistema de automatización de contenido para Instagram**

---

## ¿Qué hace este sistema?

El sistema genera automáticamente 4 publicaciones de Instagram por semana para GlobeHop, usando inteligencia artificial. Cada publicación incluye:

- **Imagen o carrusel** generado por IA con paisajes reales de Australia
- **Caption** en español latinoamericano neutro, adaptado al pilar de contenido y la audiencia
- **Hook** (texto impreso sobre la imagen) diseñado para detener el scroll

El equipo de marketing **no necesita crear nada desde cero**. Su rol es revisar, editar si es necesario, y aprobar o rechazar cada publicación antes de que se publique en Instagram.

---

## Calendario de publicaciones

El sistema genera contenido para estos días y horarios:

| Día | Hora (Bogotá) |
|-----|---------------|
| Lunes | 8:00 a.m. |
| Miércoles | 8:00 a.m. |
| Viernes | 8:00 a.m. |
| Sábado | 8:00 a.m. |

La generación ocurre automáticamente. Ustedes recibirán un correo cuando haya publicaciones listas para revisar.

---

## Cómo revisar el contenido

### 1. Abrir el dashboard de revisión

URL del dashboard:
```
https://globehop-instagram-production.up.railway.app/review?token=Globe@123
```

Guarden esta URL como marcador en el navegador.

### 2. Ver las publicaciones pendientes

En la pantalla principal verán todas las publicaciones con estado **"Pendiente revisión"**. Cada tarjeta muestra:
- Tipo de post (foto, carrusel)
- Destino (Australia)
- Fecha programada
- Vista previa de la imagen principal

### 3. Revisar una publicación en detalle

Al hacer clic en **"Revisar contenido →"** se abre la vista completa con:

- **Imágenes completas**: Para carruseles, use las flechas ‹ › para navegar entre los 6 slides
- **Hook**: El texto impreso sobre la foto (3 líneas)
- **Caption de Instagram**: El texto completo con hashtags

### 4. Editar el copy (si es necesario)

Si el caption o el hook necesitan ajustes, existe una sección **"Editar copy"** debajo del contenido. Pueden:
- Modificar el hook (las 3 líneas de texto sobre la imagen)
- Editar el caption completo de Instagram
- Hacer clic en **"Guardar cambios"** para aplicar la edición

Los cambios se guardan en Airtable automáticamente.

### 5. Aprobar o rechazar

Al final de la página hay dos botones:

| Botón | Qué hace |
|-------|----------|
| **✓ Aprobar y Publicar** | Publica inmediatamente en Instagram y marca el post como Publicado |
| **✗ Rechazar** | Descarta el post (no se publica, no se regenera) |

> **Importante:** Al hacer clic en "Aprobar y Publicar", el post se sube a Instagram de forma inmediata. Asegúrense de haber revisado todo el contenido antes de aprobar.

---

## Tipos de publicaciones

### Foto individual (single_photo)

Una sola imagen con el hook impreso encima. Ideal para mensajes directos y aspiracionales.

### Carrusel (carousel)

6 slides con diseño de marca GlobeHop:
- **Slide 1**: Hook de apertura con imagen de fondo del destino
- **Slides 2–5**: Contenido informativo (datos, listas, estadísticas, argumentos)
- **Slide 6**: Llamada a la acción con la palabra clave para DM

---

## Qué revisar en cada publicación

**Imágenes:**
- ¿La imagen representa bien a Australia? ¿Se ve auténtica y profesional?
- ¿El destino es claramente identificable?
- ¿La persona en la imagen se ve natural (no artificial)?

**Hook (texto sobre la imagen):**
- ¿La línea 1 engancha emocionalmente?
- ¿La línea 2 complementa sin repetir?
- ¿La línea 3 tiene la llamada a la acción correcta? (ej. "Escribe «AUSTRALIA» al DM")

**Caption:**
- ¿El tono suena como GlobeHop? (cálido, cercano, aspiracional)
- ¿Menciona GlobeHop de forma natural en el cuerpo del texto?
- ¿Los hashtags son apropiados?
- ¿El CTA al final es claro?

**Para carruseles:**
- ¿El slide 1 abre con una pregunta o afirmación que detiene el scroll?
- ¿Los slides 2–5 entregan valor real (no solo publicidad)?
- ¿El slide 6 tiene la palabra clave correcta en mayúsculas?

---

## Qué NO hace el sistema

- **No publica sin aprobación humana.** Todo pasa por el dashboard antes de llegar a Instagram.
- **No edita las imágenes.** Si una imagen no es adecuada, rechacen el post. Se puede generar uno nuevo manualmente.
- **No responde comentarios.** Solo publica el contenido inicial.

---

## Problemas frecuentes

| Situación | Qué hacer |
|-----------|-----------|
| El dashboard no carga | Verificar que el token en la URL sea correcto (`Globe@123`) |
| Un post tiene error en el estado | Contactar al equipo técnico |
| Queremos generar un post adicional | Contactar al equipo técnico para activar el pipeline manualmente |
| La imagen no carga en el dashboard | Refrescar la página; las imágenes pueden demorar unos segundos |

---

## Contacto técnico

Para problemas con el sistema, generación de posts adicionales, o cambios en el calendario:
**jeflorez@gmail.com**

---

*Última actualización: junio 2026*

// Single source of truth for the weekly content pillar mix — shared by
// scripts/reset-airtable.js (full reset) and scripts/seed-next-weeks.js
// (additive seeding), so both stay in sync with the same rotation.

import { hashStr, weekIndex } from './variety.js';
//
// 7 pillars, rebalanced 2026-07-17 against the team's requested content mix
// (25% educational, 20% student stories, 20% Australia/cities, 15%
// inspirational, remainder trust/engagement — "team" content stays folded
// into agency_promo until real staff/student media exists, see CLAUDE.md):
// visa_tip 4, student_life 4        → educational      8/32 = 25%
// student_story 6                    → stories          6/32 ≈ 19%
// city_spotlight 6                   → Australia/cities 6/32 ≈ 19%
// destination_spotlight 5            → inspirational    5/32 ≈ 16%
// agency_promo 4                     → trust            4/32 = 12.5%
// myth_vs_reality 3                  → engagement       3/32 ≈ 9%
// News is handled separately via the biweekly Saturday news_update override
// in reset-airtable.js / seed-next-weeks.js and is not part of this table.
//
// 8-week cycle (32 slots), each week has 4 distinct pillars — no repeats
// within a week.
export const PILLAR_ROTATION = [
  ['city_spotlight',        'student_story',         'destination_spotlight', 'visa_tip'            ],
  ['destination_spotlight', 'city_spotlight',        'student_story',         'student_life'        ],
  ['agency_promo',          'visa_tip',              'city_spotlight',        'student_story'       ],
  ['student_story',         'student_life',          'destination_spotlight', 'city_spotlight'      ],
  ['agency_promo',          'myth_vs_reality',        'visa_tip',             'student_life'        ],
  ['agency_promo',          'destination_spotlight',  'city_spotlight',       'student_story'       ],
  ['student_life',          'destination_spotlight',  'myth_vs_reality',      'visa_tip'            ],
  ['myth_vs_reality',       'city_spotlight',         'student_story',        'agency_promo'        ],
];

// CTA pools per pillar, rotated deterministically by pickCTA() below —
// replaces a static one-CTA-per-pillar map that gave 7 of 8 pillars the
// literal same "Escríbenos por DM" text on every single post forever (spec
// section 12.1: "same CTA not more than 2 consecutive posts"). Pool
// membership also maps CTA intensity to the pillar's implied funnel stage
// (spec section 6.3) using the 5 CTA options already defined in Airtable's
// singleSelect field (scripts/setup-airtable.js) but previously never
// assigned beyond the two DM/consultoría strings:
//   DESCUBRIMIENTO (destination_spotlight, city_spotlight) → soft CTAs
//   CONSIDERACION/EVALUACION (visa_tip, student_life, myth_vs_reality, news_update) → medium CTAs
//   CONFIANZA (student_story) → medium CTAs
//   CONVERSION (agency_promo) → hard CTAs
// This CTA field is the caption's closing line, consumed via generate-
// content.js's "If a CTA is provided, use it verbatim" instruction and
// generate-carousel.js's slide 6 action field — it is a separate mechanism
// from the hook's LINE 3 DM-keyword trigger ("Escribe «AUSTRALIA» al DM"),
// which stays untouched here because CLAUDE.md flags that exact phrase as
// wired to a live ManyChat automation pending a team decision.
export const CTA_POOL_BY_PILLAR = {
  destination_spotlight: ['Comenta abajo', 'Visita nuestro sitio web', 'Escríbenos por DM'],
  city_spotlight:         ['Comenta abajo', 'Visita nuestro sitio web', 'Escríbenos por DM'],
  visa_tip:                ['Escríbenos por DM', 'Link en bio', 'Visita nuestro sitio web'],
  student_life:             ['Escríbenos por DM', 'Link en bio', 'Visita nuestro sitio web'],
  myth_vs_reality:          ['Escríbenos por DM', 'Link en bio'],
  student_story:            ['Escríbenos por DM', 'Link en bio', 'Comenta abajo'],
  agency_promo:             ['Agenda tu consultoría gratuita', 'Escríbenos por DM'],
  news_update:              ['Escríbenos por DM', 'Visita nuestro sitio web'],
};

/**
 * Picks the CTA text for a record's pillar, deterministically rotating
 * through that pillar's pool (weekIndex-based, same pattern as pickTopic) so
 * the same CTA doesn't run on every post of a given pillar indefinitely.
 *
 * @param {object} record  Airtable record fields (uses 'Fecha publicación', id)
 * @param {string} pillar  Content pillar
 * @returns {string} CTA text (one of the 5 Airtable CTA singleSelect choices)
 */
export function pickCTA(record = {}, pillar = '') {
  const pool = CTA_POOL_BY_PILLAR[pillar] ?? ['Escríbenos por DM'];
  const fecha = record['Fecha publicación'] ?? '';
  const idx = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? (hashStr(`cta:${pillar}`) + weekIndex(fecha)) % pool.length
    : hashStr(`cta:${pillar}:${record.id ?? ''}`) % pool.length;
  return pool[idx];
}

// Weighted, interleaved Audiencia sequence for calendar seeding — replaces a
// flat 5-way round robin that gave "padres" 20% of all posts against the
// spec's 10% ceiling (section 5.4/21.1: min 75% student-facing, max 10%
// family). This 20-slot array yields universitarios 6/20=30%, profesionales
// 5/20=25%, estudiantes_secundaria 4/20=20%, adultos 3/20=15% (90% student-
// facing total), padres 2/20=10%, with padres entries spread 8 slots apart
// (~2 weeks at 4 posts/week) rather than clustered.
export const AUDIENCE_ROTATION = [
  'universitarios', 'profesionales', 'estudiantes_secundaria', 'adultos',
  'universitarios', 'padres',       'profesionales',           'estudiantes_secundaria',
  'universitarios', 'adultos',      'profesionales',           'estudiantes_secundaria',
  'universitarios', 'padres',       'profesionales',           'adultos',
  'universitarios', 'estudiantes_secundaria', 'profesionales', 'universitarios',
];

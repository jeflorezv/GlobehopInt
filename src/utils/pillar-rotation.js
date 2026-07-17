// Single source of truth for the weekly content pillar mix — shared by
// scripts/reset-airtable.js (full reset) and scripts/seed-next-weeks.js
// (additive seeding), so both stay in sync with the same rotation.
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

export const CTA_BY_PILLAR = {
  destination_spotlight: 'Escríbenos por DM',
  visa_tip:              'Escríbenos por DM',
  student_story:         'Escríbenos por DM',
  agency_promo:          'Agenda tu consultoría gratuita',
  news_update:            'Escríbenos por DM',
  city_spotlight:         'Escríbenos por DM',
  student_life:           'Escríbenos por DM',
  myth_vs_reality:        'Escríbenos por DM',
};

/**
 * Gap-fill sweep table (owner-approved rollout, Aug 10, 2026).
 *
 * Per country:
 *   qid     — Wikidata item for the country (citizenship/origin checks)
 *   name    — display name used in reports and logs
 *   mbArea  — MusicBrainz's EXACT country-area name, live-verified
 *             Aug 10, 2026 (the dedup area walk compares names, so a
 *             "Burma"-vs-"Myanmar" mismatch would silently weaken it)
 *   discogs — Discogs country string(s), probe-verified Aug 10, 2026;
 *             multi-string countries sweep each and merge by release id
 *   noFallback — display-string fallback DISABLED: the country string
 *             is a token of another Discogs country, so a release whose
 *             detail fetch failed cannot be attributed on the record;
 *             it is skipped and counted instead (rule on the record)
 *
 * Batches (each runs only on its own explicit go):
 *   smoke: BT TL AF
 *   A:     remaining Tier A · B1: SE/S Asia · B2: Africa
 *   B3:    Caribbean/Central America · B4: MENA + Europe/ex-USSR
 *   C:     VN GH ZM CD TT (owner opt-in, after B4)
 */
export const COUNTRIES = {
  // ------------------------------------------------- pilot (complete)
  LA: { qid: 'Q819', name: 'Laos', mbArea: 'Laos', discogs: ['Laos'] },
  PY: { qid: 'Q733', name: 'Paraguay', mbArea: 'Paraguay', discogs: ['Paraguay'] },

  // ------------------------------------------------------------ Tier A
  TD: { qid: 'Q657', name: 'Chad', mbArea: 'Chad', discogs: ['Chad'] },
  GQ: { qid: 'Q983', name: 'Equatorial Guinea', mbArea: 'Equatorial Guinea', discogs: ['Equatorial Guinea'] },
  SB: { qid: 'Q685', name: 'Solomon Islands', mbArea: 'Solomon Islands', discogs: ['Solomon Islands'] },
  DJ: { qid: 'Q977', name: 'Djibouti', mbArea: 'Djibouti', discogs: ['Djibouti'] },
  VU: { qid: 'Q686', name: 'Vanuatu', mbArea: 'Vanuatu', discogs: ['Vanuatu'] },
  SZ: { qid: 'Q1050', name: 'Eswatini', mbArea: 'Eswatini', discogs: ['Swaziland'] },
  MR: { qid: 'Q1025', name: 'Mauritania', mbArea: 'Mauritania', discogs: ['Mauritania'] },
  RW: { qid: 'Q1037', name: 'Rwanda', mbArea: 'Rwanda', discogs: ['Rwanda'] },
  TJ: { qid: 'Q863', name: 'Tajikistan', mbArea: 'Tajikistan', discogs: ['Tajikistan'] },
  GW: { qid: 'Q1007', name: 'Guinea-Bissau', mbArea: 'Guinea-Bissau', discogs: ['Guinea-Bissau'] },
  LS: { qid: 'Q1013', name: 'Lesotho', mbArea: 'Lesotho', discogs: ['Lesotho'] },
  OM: { qid: 'Q842', name: 'Oman', mbArea: 'Oman', discogs: ['Oman'] },
  MW: { qid: 'Q1020', name: 'Malawi', mbArea: 'Malawi', discogs: ['Malawi'] },
  NE: { qid: 'Q1032', name: 'Niger', mbArea: 'Niger', discogs: ['Niger'] },
  // Discogs records carry the formal "Gambia, The" (search tokenizes to
  // "Gambia") — found by the record guard rejecting all 41, Aug 10 run.
  GM: { qid: 'Q1005', name: 'Gambia', mbArea: 'Gambia', discogs: ['Gambia, The', 'Gambia'] },
  BT: { qid: 'Q917', name: 'Bhutan', mbArea: 'Bhutan', discogs: ['Bhutan'] },
  SO: { qid: 'Q1045', name: 'Somalia', mbArea: 'Somalia', discogs: ['Somalia'] },
  LR: { qid: 'Q1014', name: 'Liberia', mbArea: 'Liberia', discogs: ['Liberia'] },
  BW: { qid: 'Q963', name: 'Botswana', mbArea: 'Botswana', discogs: ['Botswana'] },
  CF: { qid: 'Q929', name: 'Central African Republic', mbArea: 'Central African Republic', discogs: ['Central African Republic'] },
  QA: { qid: 'Q846', name: 'Qatar', mbArea: 'Qatar', discogs: ['Qatar'] },
  BN: { qid: 'Q921', name: 'Brunei', mbArea: 'Brunei', discogs: ['Brunei'] },
  TM: { qid: 'Q874', name: 'Turkmenistan', mbArea: 'Turkmenistan', discogs: ['Turkmenistan'] },
  KG: { qid: 'Q813', name: 'Kyrgyzstan', mbArea: 'Kyrgyzstan', discogs: ['Kyrgyzstan'] },
  SL: { qid: 'Q1044', name: 'Sierra Leone', mbArea: 'Sierra Leone', discogs: ['Sierra Leone'] },
  BF: { qid: 'Q965', name: 'Burkina Faso', mbArea: 'Burkina Faso', discogs: ['Burkina Faso'] },
  NA: { qid: 'Q1030', name: 'Namibia', mbArea: 'Namibia', discogs: ['Namibia'] },
  ER: { qid: 'Q986', name: 'Eritrea', mbArea: 'Eritrea', discogs: ['Eritrea'] },
  TL: { qid: 'Q574', name: 'Timor-Leste', mbArea: 'Timor-Leste', discogs: ['East Timor'] },
  PG: { qid: 'Q691', name: 'Papua New Guinea', mbArea: 'Papua New Guinea', discogs: ['Papua New Guinea'] },
  YE: { qid: 'Q805', name: 'Yemen', mbArea: 'Yemen', discogs: ['Yemen'] },
  TG: { qid: 'Q945', name: 'Togo', mbArea: 'Togo', discogs: ['Togo'] },
  AF: { qid: 'Q889', name: 'Afghanistan', mbArea: 'Afghanistan', discogs: ['Afghanistan'] },
  GA: { qid: 'Q1000', name: 'Gabon', mbArea: 'Gabon', discogs: ['Gabon'] },
  FJ: { qid: 'Q712', name: 'Fiji', mbArea: 'Fiji', discogs: ['Fiji'] },

  // ------------------------------------------------------------ Tier B
  BZ: { qid: 'Q242', name: 'Belize', mbArea: 'Belize', discogs: ['Belize'] },
  PS: { qid: 'Q219060', name: 'Palestine', mbArea: 'Palestine', discogs: ['Palestine'] },
  JO: { qid: 'Q810', name: 'Jordan', mbArea: 'Jordan', discogs: ['Jordan'] },
  GY: { qid: 'Q734', name: 'Guyana', mbArea: 'Guyana', discogs: ['Guyana'] },
  TZ: { qid: 'Q924', name: 'Tanzania', mbArea: 'Tanzania', discogs: ['Tanzania'] },
  LY: { qid: 'Q1016', name: 'Libya', mbArea: 'Libya', discogs: ['Libya'] },
  IQ: { qid: 'Q796', name: 'Iraq', mbArea: 'Iraq', discogs: ['Iraq'] },
  BD: { qid: 'Q902', name: 'Bangladesh', mbArea: 'Bangladesh', discogs: ['Bangladesh'] },
  KP: { qid: 'Q423', name: 'North Korea', mbArea: 'North Korea', discogs: ['North Korea'] },
  GL: { qid: 'Q223', name: 'Greenland', mbArea: 'Greenland', discogs: ['Greenland'] },
  XK: { qid: 'Q1246', name: 'Kosovo', mbArea: 'Kosovo', discogs: ['Kosovo'] },
  NP: { qid: 'Q837', name: 'Nepal', mbArea: 'Nepal', discogs: ['Nepal'] },
  MN: { qid: 'Q711', name: 'Mongolia', mbArea: 'Mongolia', discogs: ['Mongolia'] },
  MM: { qid: 'Q836', name: 'Myanmar', mbArea: 'Myanmar', discogs: ['Burma'] },
  UG: { qid: 'Q1036', name: 'Uganda', mbArea: 'Uganda', discogs: ['Uganda'] },
  KH: { qid: 'Q424', name: 'Cambodia', mbArea: 'Cambodia', discogs: ['Cambodia'] },
  ML: { qid: 'Q912', name: 'Mali', mbArea: 'Mali', discogs: ['Mali'] },
  GN: { qid: 'Q1006', name: 'Guinea', mbArea: 'Guinea', discogs: ['Guinea'], noFallback: true },
  SD: { qid: 'Q1049', name: 'Sudan', mbArea: 'Sudan', discogs: ['Sudan'], noFallback: true },
  BJ: { qid: 'Q962', name: 'Benin', mbArea: 'Benin', discogs: ['Benin'] },
  HN: { qid: 'Q783', name: 'Honduras', mbArea: 'Honduras', discogs: ['Honduras'] },
  KW: { qid: 'Q817', name: 'Kuwait', mbArea: 'Kuwait', discogs: ['Kuwait'] },
  AM: { qid: 'Q399', name: 'Armenia', mbArea: 'Armenia', discogs: ['Armenia'] },
  CM: { qid: 'Q1009', name: 'Cameroon', mbArea: 'Cameroon', discogs: ['Cameroon'] },
  // Discogs records carry the formal "Bahamas, The" (Gambia-class trap,
  // caught by record-level spot-check Aug 11 before the B3 sweep).
  BS: { qid: 'Q778', name: 'Bahamas', mbArea: 'Bahamas', discogs: ['Bahamas, The', 'Bahamas'] },
  SR: { qid: 'Q730', name: 'Suriname', mbArea: 'Suriname', discogs: ['Suriname'] },
  HT: { qid: 'Q790', name: 'Haiti', mbArea: 'Haiti', discogs: ['Haiti'] },
  UZ: { qid: 'Q265', name: 'Uzbekistan', mbArea: 'Uzbekistan', discogs: ['Uzbekistan'] },
  LK: { qid: 'Q854', name: 'Sri Lanka', mbArea: 'Sri Lanka', discogs: ['Sri Lanka'] },
  AL: { qid: 'Q222', name: 'Albania', mbArea: 'Albania', discogs: ['Albania'] },
  // Discogs records carry the formal "Moldova, Republic of" (Gambia-class
  // trap — found by the record guard rejecting all 895, Aug 14 B4 run).
  MD: { qid: 'Q217', name: 'Moldova', mbArea: 'Moldova', discogs: ['Moldova, Republic of', 'Moldova'] },
  SN: { qid: 'Q1041', name: 'Senegal', mbArea: 'Senegal', discogs: ['Senegal'] },
  ET: { qid: 'Q115', name: 'Ethiopia', mbArea: 'Ethiopia', discogs: ['Ethiopia'] },
  NI: { qid: 'Q811', name: 'Nicaragua', mbArea: 'Nicaragua', discogs: ['Nicaragua'] },

  // ------------------------------------- Tier C (owner opt-in, Aug 10)
  VN: { qid: 'Q881', name: 'Vietnam', mbArea: 'Vietnam', discogs: ['Vietnam'] },
  GH: { qid: 'Q117', name: 'Ghana', mbArea: 'Ghana', discogs: ['Ghana'] },
  ZM: { qid: 'Q953', name: 'Zambia', mbArea: 'Zambia', discogs: ['Zambia'] },
  // "Belgian Congo" (290 releases, found Aug 11 via the CG spot-check)
  // is the colonial-era predecessor holding the vintage rumba pressings
  // — same historical-entity treatment as Rhodesia→ZW. Flagged in the
  // Batch A report; the C batch still needs its own go before this runs.
  CD: {
    qid: 'Q974',
    name: 'DR Congo',
    mbArea: 'Democratic Republic of the Congo',
    discogs: ['Zaire', 'Congo, Democratic Republic of the', 'Belgian Congo'],
    noFallback: true,
  },
  TT: { qid: 'Q754', name: 'Trinidad & Tobago', mbArea: 'Trinidad and Tobago', discogs: ['Trinidad & Tobago'] },
}

// Countries, grouped the way the business thinks about them.
//
// A flat list of 149 names with India bolted on the front meant the country
// box read as one long alphabetical run, and the markets that actually matter
// — East Africa, South East Asia, the Gulf — were scattered through it. These
// are the zones the export side already talks in, each one alphabetical
// inside, so a rep can go to the region first and scan a short list rather
// than hunt through Afghanistan to Zimbabwe.
//
// India sits on its own at the top because it is 2,168 of 2,423 clients: a
// group of one, which is honest, rather than hidden under "South Asia".
//
// Membership is geographic, not political. Where a country could sit in two
// zones the choice follows how this business sells: Egypt and the Maghreb go
// with Africa rather than the Middle East, Turkey and Cyprus with Europe,
// Afghanistan with South Asia.

export interface CountryRegion { region: string; countries: string[] }

/** The zones, in the order they should appear. Alphabetical within each. */
export const COUNTRY_REGIONS: CountryRegion[] = [
  { region: 'India', countries: ['India'] },

  { region: 'South Asia', countries: [
    'Afghanistan', 'Bangladesh', 'Maldives', 'Nepal', 'Pakistan', 'Sri Lanka',
  ] },

  { region: 'South East Asia', countries: [
    'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines',
    'Singapore', 'Thailand', 'Vietnam',
  ] },

  { region: 'East Asia', countries: [
    'China', 'Hong Kong', 'Japan', 'Mongolia', 'South Korea', 'Taiwan',
  ] },

  { region: 'Middle East', countries: [
    'Bahrain', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kuwait', 'Lebanon', 'Oman',
    'Qatar', 'Saudi Arabia', 'Syria', 'United Arab Emirates', 'Yemen',
  ] },

  { region: 'Central Asia & Caucasus', countries: [
    'Armenia', 'Azerbaijan', 'Georgia', 'Kazakhstan', 'Kyrgyzstan',
    'Tajikistan', 'Turkmenistan', 'Uzbekistan',
  ] },

  { region: 'East Africa', countries: [
    'Ethiopia', 'Kenya', 'Madagascar', 'Malawi', 'Mauritius', 'Mozambique',
    'Rwanda', 'Somalia', 'South Sudan', 'Sudan', 'Tanzania', 'Uganda',
    'Zambia', 'Zimbabwe',
  ] },

  { region: 'West & Central Africa', countries: [
    'Angola', 'Benin', 'Burkina Faso', 'Cameroon', 'Chad', 'Congo (DRC)',
    "Côte d'Ivoire", 'Gabon', 'Ghana', 'Guinea', 'Liberia', 'Mali', 'Niger',
    'Nigeria', 'Senegal', 'Sierra Leone', 'Togo',
  ] },

  { region: 'North Africa', countries: [
    'Algeria', 'Egypt', 'Libya', 'Morocco', 'Tunisia',
  ] },

  { region: 'Southern Africa', countries: [
    'Botswana', 'Namibia', 'South Africa',
  ] },

  { region: 'Europe', countries: [
    'Albania', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herzegovina',
    'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Finland', 'France',
    'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Latvia',
    'Lithuania', 'Luxembourg', 'Malta', 'Moldova', 'Netherlands',
    'North Macedonia', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia',
    'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland',
    'Turkey', 'Ukraine', 'United Kingdom',
  ] },

  { region: 'North America', countries: ['Canada', 'Mexico', 'United States'] },

  { region: 'Latin America & Caribbean', countries: [
    'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Costa Rica',
    'Cuba', 'Dominican Republic', 'Ecuador', 'El Salvador', 'Guatemala',
    'Honduras', 'Jamaica', 'Nicaragua', 'Panama', 'Paraguay', 'Peru',
    'Trinidad and Tobago', 'Uruguay', 'Venezuela',
  ] },

  { region: 'Oceania', countries: [
    'Australia', 'Fiji', 'New Zealand', 'Papua New Guinea',
  ] },

  // Not a region. Kept last so a client whose country nobody has established
  // still has somewhere to go, rather than being filed under a guess.
  { region: 'Unspecified', countries: ['Other'] },
];

/** Every country, in region order. The flat list the old COUNTRIES export was. */
export const COUNTRIES_IN_REGION_ORDER: string[] =
  COUNTRY_REGIONS.flatMap(r => r.countries);

/** The region a country belongs to, or null for one not on the list. */
export function regionOf(country: string | null | undefined): string | null {
  if (!country) return null;
  const hit = COUNTRY_REGIONS.find(r => r.countries.includes(country));
  return hit ? hit.region : null;
}

/**
 * The groups to render, with a country the record already holds folded in even
 * when it is not on the list — an older record must not have its value
 * silently rewritten by opening the form. An unrecognised value gets a group
 * of its own at the top so it is visibly the odd one out.
 */
export function countryGroupsWith(current: string | null | undefined): CountryRegion[] {
  const value = (current ?? '').trim();
  if (!value || regionOf(value)) return COUNTRY_REGIONS;
  return [{ region: 'On this record', countries: [value] }, ...COUNTRY_REGIONS];
}

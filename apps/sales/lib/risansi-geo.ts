// Shared geography option lists for client location fields.
// Used by the client create/edit form (country dropdown + conditional state).

// India stays first so it remains the natural default; the rest are alphabetical.
export const COUNTRIES: string[] = [
  'India',
  'Afghanistan', 'Albania', 'Algeria', 'Angola', 'Argentina', 'Armenia',
  'Australia', 'Austria', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Belarus',
  'Belgium', 'Benin', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana',
  'Brazil', 'Bulgaria', 'Burkina Faso', 'Cambodia', 'Cameroon', 'Canada',
  'Chad', 'Chile', 'China', 'Colombia', 'Congo (DRC)', 'Costa Rica',
  "Côte d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gabon', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Guatemala', 'Guinea', 'Honduras', 'Hong Kong', 'Hungary',
  'Iceland', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait',
  'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Liberia', 'Libya',
  'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives',
  'Mali', 'Malta', 'Mauritius', 'Mexico', 'Moldova', 'Mongolia', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand',
  'Nicaragua', 'Niger', 'Nigeria', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia',
  'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Sierra Leone', 'Singapore',
  'Slovakia', 'Slovenia', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda',
  'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia',
  'Zimbabwe', 'Other',
];

// 28 states + 8 union territories.
export const INDIAN_STATES: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
  // Union territories
  'Andaman & Nicobar Islands', 'Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
];

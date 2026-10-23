// Where a client sits on the map.
//
// Pure data and three lookups, no database — the map is a client component and
// anything it imports ships to the browser.
//
// ── Why state names are normalised ──────────────────────────────
//
// Three spellings are in play and they disagree. `clients.state` is whatever
// was typed or imported ("ORISSA", "Jammu And Kashmir", "Uttaranchal"); the
// boundary file spells them its own way ("Jammu and Kashmir", "Dadra and
// Nagar Haveli and Daman and Diu"); and the portal displays the current ones.
// normaliseStateName maps all of them onto one label per state so the
// choropleth, the bubbles and the ranking agree.
//
// ── The boundary file, and what it does and does not show ───────
//
// public/india-states-goi.json, 36 features, from Vardhan-Systems/vardhan-maps
// (OpenStreetMap-derived, ODbL 1.0, with the publisher's Government of India
// border patches applied). The credit line is on the map's footer because ODbL
// requires it wherever the data is shown.
//
// It replaced a GADM file that was wrong in two ways. That file was clipped to
// the Line of Control - Jammu & Kashmir stopped at 35.50°N / 79.56°E, so Aksai
// Chin, Gilgit-Baltistan and Azad Kashmir were not drawn as part of India at
// all. It was also twelve years stale: 35 features, no Telangana (it carried
// the pre-2014 combined Andhra Pradesh polygon), no Ladakh, "Orissa",
// "Uttaranchal", and Daman & Diu still separate from Dadra & Nagar Haveli.
//
// Two corrections were applied to it, both repeatable from scripts/:
//
//   WINDING. Every one of the 36 features was wound backwards for d3-geo,
//   which reads polygons spherically — a backwards ring is not mirrored, it
//   is the whole globe MINUS the shape. Thirty-six of those stacked up paint
//   a blank map, and that is what the first boundary swap shipped. GADM had
//   happened to comply, so nothing caught it until the file changed.
//   scripts/rewind-geojson.mjs fixes it and is idempotent; run it on any
//   boundary file before committing one.
//
//   SHAKSGAM. The published file stopped at the Karakoram ridge, leaving out
//   the Shaksgam Valley / Trans-Karakoram Tract, which India claims. The
//   missing band was taken from datameet/maps india-composite.geojson (CC-0,
//   which sources that tract from Natural Earth's disputed-areas set),
//   differenced against this file inside a tight window on the Karakoram,
//   sliver-filtered, and unioned into Ladakh. It added 4,822 km²; the tract
//   is usually cited around 5,180 km², the difference being where the two
//   datasets put the ridge line. No coordinate was drawn by hand.
//
// Verified by point-in-polygon, not taken on the publishers' word:
//
//   Aksai Chin, Gilgit-Baltistan, Siachen      inside Ladakh
//   Shaksgam Valley / Trans-Karakoram          inside Ladakh
//   Azad Kashmir (Muzaffarabad, Mirpur)        inside Jammu and Kashmir
//   Arunachal Pradesh (Tawang, Itanagar)       present in full
//   Kashgar, Kathmandu, Dhaka, Colombo         outside, as they should be
//   total land area                            33,52,136 km²
//   northern extent                            37.09°N, west to 72.51°E

// ── State centres [lng, lat] ──────────────────────────────────

export const STATE_CENTERS: Record<string, [number, number]> = {
  'Andaman & Nicobar Islands': [92.8, 11.7],
  'Andhra Pradesh':      [79.7, 15.9],
  'Arunachal Pradesh':   [94.4, 28.1],
  'Assam':               [92.9, 26.2],
  'Bihar':               [85.3, 25.1],
  'Chandigarh':          [76.8, 30.7],
  'Chhattisgarh':        [81.9, 21.3],
  // The merged UT, spelled as INDIAN_STATES in risansi-geo spells it, so the
  // form's dropdown value normalises to itself.
  'Dadra & Nagar Haveli and Daman & Diu': [72.9, 20.3],
  'Delhi':               [77.2, 28.6],
  'Goa':                 [74.1, 15.3],
  'Gujarat':             [71.6, 22.5],
  'Haryana':             [76.1, 29.1],
  'Himachal Pradesh':    [77.2, 31.8],
  'Jammu & Kashmir':     [75.3, 33.7],
  'Jharkhand':           [85.3, 23.6],
  'Karnataka':           [76.0, 14.8],
  'Kerala':              [76.3, 10.4],
  'Ladakh':              [77.6, 34.2],
  'Lakshadweep':         [73.0, 10.6],
  'Madhya Pradesh':      [78.4, 23.6],
  'Maharashtra':         [75.9, 19.3],
  'Manipur':             [93.9, 24.7],
  'Meghalaya':           [91.4, 25.5],
  'Mizoram':             [92.8, 23.3],
  'Nagaland':            [94.3, 26.1],
  'Odisha':              [84.8, 20.6],
  'Puducherry':          [79.8, 11.9],
  'Punjab':              [75.3, 31.0],
  'Rajasthan':           [74.0, 26.8],
  'Sikkim':              [88.5, 27.6],
  'Tamil Nadu':          [78.4, 11.1],
  'Telangana':           [79.1, 17.9],
  'Tripura':             [91.7, 23.8],
  'Uttar Pradesh':       [80.6, 26.9],
  'Uttarakhand':         [79.2, 30.1],
  'West Bengal':         [87.9, 23.4],
};

// ── Name normalisation ────────────────────────────────────────
//
// Every spelling seen in `clients.state` or in the boundary file, mapped onto
// the key used in STATE_CENTERS. Lower-cased on both sides, so only genuine
// alternative names need an entry.

const STATE_ALIASES: Record<string, string> = {
  'orissa':                      'Odisha',
  'uttaranchal':                 'Uttarakhand',
  'uttranchal':                  'Uttarakhand',
  'jammu and kashmir':           'Jammu & Kashmir',
  'jammu & kashmir':             'Jammu & Kashmir',
  'j&k':                         'Jammu & Kashmir',
  'pondicherry':                 'Puducherry',
  'andaman and nicobar':         'Andaman & Nicobar Islands',
  'andaman & nicobar':           'Andaman & Nicobar Islands',
  'andaman and nicobar islands': 'Andaman & Nicobar Islands',
  'dadra and nagar haveli':      'Dadra & Nagar Haveli and Daman & Diu',
  'dadra & nagar haveli':        'Dadra & Nagar Haveli and Daman & Diu',
  'daman and diu':               'Dadra & Nagar Haveli and Daman & Diu',
  'daman & diu':                 'Dadra & Nagar Haveli and Daman & Diu',
  'dadra and nagar haveli and daman and diu': 'Dadra & Nagar Haveli and Daman & Diu',
  'nct of delhi':                'Delhi',
  'new delhi':                   'Delhi',
  'tamilnadu':                   'Tamil Nadu',
  'tamil nadu ':                 'Tamil Nadu',
  'telengana':                   'Telangana',
  'telagana':                    'Telangana',
  'chattisgarh':                 'Chhattisgarh',
  'chhatisgarh':                 'Chhattisgarh',
  'pondychery':                  'Puducherry',
  'west bangal':                 'West Bengal',
  'maharastra':                  'Maharashtra',
  'maharstra':                   'Maharashtra',
  'karnatka':                    'Karnataka',
  'gujrat':                      'Gujarat',
  'uttar lpradesh':              'Uttar Pradesh',
  'himanchal pradesh':           'Himachal Pradesh',
  // A city typed into the state column. Counting these as "not India" put
  // them in the International panel, which is worse than placing them at the
  // state centre they unambiguously belong to.
  'hyderabad':                   'Telangana',
  'jammu':                       'Jammu & Kashmir',
};

const CANON_BY_LOWER = new Map(Object.keys(STATE_CENTERS).map(k => [k.toLowerCase(), k]));

/** The one label for a state, or null when the value is not an Indian state. */
export function normaliseStateName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!k) return null;
  return CANON_BY_LOWER.get(k) ?? STATE_ALIASES[k] ?? null;
}

// ── City centres [lng, lat] ───────────────────────────────────

export const CITY_COORDS: Record<string, [number, number]> = {
  // Maharashtra
  'Pune':               [73.86, 18.52],
  'Mumbai':             [72.88, 19.08],
  'Thane':              [72.97, 19.22],
  'Navi Mumbai':        [73.03, 19.03],
  'Kolhapur':           [74.24, 16.70],
  'Solapur':            [75.91, 17.69],
  'Nashik':             [73.79, 20.00],
  'Nagpur':             [79.09, 21.15],
  'Aurangabad':         [75.34, 19.88],
  'Sambhajinagar':      [75.34, 19.88],
  'Sangli':             [74.57, 16.85],
  'Satara':             [74.02, 17.69],
  'Ahmednagar':         [74.75, 19.09],
  'Jalgaon':            [75.56, 21.01],
  'Latur':              [76.56, 18.40],
  'Chiplun':            [73.51, 17.53],
  'Ratnagiri':          [73.31, 16.99],
  'Amravati':           [77.75, 20.93],
  'Akola':              [77.00, 20.70],
  'Baramati':           [74.58, 18.15],
  'Dhule':              [74.78, 20.90],
  'Nanded':             [77.32, 19.15],
  'Chandrapur':         [79.30, 19.95],
  // Karnataka
  'Bengaluru':          [77.59, 12.97],
  'Bangalore':          [77.59, 12.97],
  'Mysuru':             [76.64, 12.30],
  'Mysore':             [76.64, 12.30],
  'Belagavi':           [74.50, 15.85],
  'Belgaum':            [74.50, 15.85],
  'Hubli':              [75.12, 15.36],
  'Hubballi':           [75.12, 15.36],
  'Davangere':          [75.92, 14.47],
  'Mangaluru':          [74.86, 12.91],
  'Mangalore':          [74.86, 12.91],
  'Ballari':            [76.92, 15.14],
  'Bellary':            [76.92, 15.14],
  'Bidar':              [77.52, 17.91],
  'Shivamogga':         [75.57, 13.93],
  'Tumakuru':           [77.10, 13.34],
  'Mandya':             [76.90, 12.52],
  'Bagalkot':           [75.70, 16.19],
  'Gulbarga':           [76.83, 17.33],
  'Kalaburagi':         [76.83, 17.33],
  // Gujarat
  'Ahmedabad':          [72.59, 23.03],
  'Surat':              [72.83, 21.17],
  'Vadodara':           [73.19, 22.31],
  'Rajkot':             [70.80, 22.30],
  'Bharuch':            [72.99, 21.71],
  'Ankleshwar':         [73.00, 21.63],
  'Vapi':               [72.91, 20.37],
  'Jamnagar':           [70.07, 22.47],
  'Gandhinagar':        [72.63, 23.22],
  'Bhavnagar':          [72.15, 21.76],
  'Junagadh':           [70.46, 21.52],
  'Morbi':              [70.84, 22.82],
  'Anand':              [72.95, 22.56],
  'Mehsana':            [72.37, 23.60],
  'Valsad':             [72.93, 20.60],
  'Dahej':              [72.58, 21.70],
  'Kutch':              [69.86, 23.73],
  'Bhuj':               [69.67, 23.25],
  // Tamil Nadu
  'Chennai':            [80.28, 13.08],
  'Coimbatore':         [76.96, 11.02],
  'Madurai':            [78.12, 9.92],
  'Tiruchirappalli':    [78.70, 10.79],
  'Trichy':             [78.70, 10.79],
  'Salem':              [78.16, 11.66],
  'Erode':              [77.73, 11.34],
  'Tirunelveli':        [77.69, 8.71],
  'Tuticorin':          [78.13, 8.76],
  'Thoothukudi':        [78.13, 8.76],
  'Vellore':            [79.13, 12.92],
  'Hosur':              [77.83, 12.74],
  'Cuddalore':          [79.77, 11.75],
  'Nagercoil':          [77.43, 8.18],
  'Karur':              [78.08, 10.96],
  // Telangana / Andhra
  'Hyderabad':          [78.49, 17.39],
  'Secunderabad':       [78.50, 17.44],
  'Warangal':           [79.59, 17.97],
  'Nizamabad':          [78.09, 18.67],
  'Visakhapatnam':      [83.30, 17.69],
  'Vizag':              [83.30, 17.69],
  'Guntur':             [80.44, 16.30],
  'Vijayawada':         [80.65, 16.51],
  'Nellore':            [79.99, 14.44],
  'Tirupati':           [79.42, 13.63],
  'Kakinada':           [82.24, 16.99],
  'Rajahmundry':        [81.78, 17.00],
  // North
  'Delhi':              [77.21, 28.61],
  'New Delhi':          [77.21, 28.61],
  'Noida':              [77.39, 28.54],
  'Ghaziabad':          [77.44, 28.67],
  'Gurugram':           [77.03, 28.46],
  'Gurgaon':            [77.03, 28.46],
  'Faridabad':          [77.31, 28.41],
  'Panipat':            [76.97, 29.39],
  'Sonipat':            [77.02, 28.99],
  'Hisar':              [75.72, 29.15],
  'Rohtak':             [76.61, 28.90],
  'Yamunanagar':        [77.28, 30.13],
  'Ambala':             [76.78, 30.38],
  'Karnal':             [76.99, 29.69],
  'Bhiwadi':            [76.86, 28.21],
  'Ludhiana':           [75.86, 30.90],
  'Amritsar':           [74.87, 31.64],
  'Jalandhar':          [75.58, 31.33],
  'Patiala':            [76.40, 30.34],
  'Mohali':             [76.72, 30.70],
  'Chandigarh':         [76.78, 30.73],
  'Bathinda':           [74.95, 30.21],
  'Haridwar':           [78.17, 29.95],
  'Dehradun':           [78.03, 30.32],
  'Kashipur':           [78.96, 29.21],
  'Rudrapur':           [79.41, 28.98],
  'Roorkee':            [77.89, 29.87],
  'Pantnagar':          [79.49, 29.02],
  // Uttar Pradesh
  'Kanpur':             [80.35, 26.45],
  'Lucknow':            [80.95, 26.85],
  'Agra':               [78.01, 27.18],
  'Varanasi':           [82.97, 25.32],
  'Meerut':             [77.71, 28.98],
  'Aligarh':            [78.08, 27.90],
  'Bareilly':           [79.43, 28.37],
  'Gorakhpur':          [83.37, 26.76],
  'Moradabad':          [78.77, 28.84],
  'Muzaffarnagar':      [77.70, 29.47],
  'Prayagraj':          [81.85, 25.44],
  'Allahabad':          [81.85, 25.44],
  'Jhansi':             [78.58, 25.45],
  'Gonda':              [81.96, 27.13],
  'Bijnor':             [78.14, 29.37],
  // Rajasthan / MP
  'Jaipur':             [75.79, 26.91],
  'Jodhpur':            [73.02, 26.24],
  'Udaipur':            [73.71, 24.59],
  'Kota':               [75.84, 25.21],
  'Bhilwara':           [74.63, 25.35],
  'Alwar':              [76.63, 27.56],
  'Ajmer':              [74.64, 26.45],
  'Sriganganagar':      [73.88, 29.92],
  'Indore':             [75.86, 22.72],
  'Bhopal':             [77.41, 23.26],
  'Jabalpur':           [79.95, 23.18],
  'Gwalior':            [78.18, 26.22],
  'Ujjain':             [75.78, 23.18],
  'Dewas':              [76.06, 22.96],
  'Pithampur':          [75.68, 22.60],
  'Satna':              [80.83, 24.58],
  'Sagar':              [78.72, 23.84],
  // East
  'Kolkata':            [88.36, 22.57],
  'Howrah':             [88.31, 22.59],
  'Durgapur':           [87.31, 23.52],
  'Asansol':            [86.99, 23.68],
  'Siliguri':           [88.43, 26.72],
  'Haldia':             [88.10, 22.07],
  'Kharagpur':          [87.32, 22.35],
  'Patna':              [85.14, 25.59],
  'Muzaffarpur':        [85.39, 26.12],
  'Bhagalpur':          [86.98, 25.24],
  'Ranchi':             [85.33, 23.35],
  'Dhanbad':            [86.43, 23.79],
  'Jamshedpur':         [86.20, 22.80],
  'Bokaro':             [86.15, 23.67],
  'Raipur':             [81.63, 21.25],
  'Bhilai':             [81.38, 21.21],
  'Korba':              [82.71, 22.35],
  'Raigarh':            [83.40, 21.90],
  'Bhubaneswar':        [85.82, 20.30],
  'Cuttack':            [85.88, 20.46],
  'Rourkela':           [84.85, 22.26],
  'Angul':              [85.10, 20.84],
  'Paradeep':           [86.61, 20.32],
  'Jharsuguda':         [84.01, 21.86],
  // North-east
  'Guwahati':           [91.74, 26.14],
  'Dibrugarh':          [94.91, 27.47],
  'Silchar':            [92.80, 24.83],
  'Agartala':           [91.28, 23.83],
  'Imphal':             [93.94, 24.82],
  'Shillong':           [91.88, 25.57],
  'Aizawl':             [92.72, 23.73],
  'Kohima':             [94.11, 25.67],
  'Gangtok':            [88.61, 27.33],
  // Kerala / Goa
  'Thiruvananthapuram': [76.95, 8.52],
  'Trivandrum':         [76.95, 8.52],
  'Kochi':              [76.27, 9.93],
  'Cochin':             [76.27, 9.93],
  'Ernakulam':          [76.29, 9.98],
  'Thrissur':           [76.22, 10.53],
  'Kozhikode':          [75.78, 11.26],
  'Calicut':            [75.78, 11.26],
  'Kollam':             [76.60, 8.89],
  'Palakkad':           [76.66, 10.78],
  'Kannur':             [75.37, 11.87],
  'Alappuzha':          [76.34, 9.50],
  'Panaji':             [73.83, 15.50],
  'Panjim':             [73.83, 15.50],
  'Verna':              [73.93, 15.37],
  'Vasco':              [73.81, 15.40],
  'Margao':             [73.96, 15.27],
  // Himachal / J&K
  'Shimla':             [77.17, 31.10],
  'Baddi':              [76.79, 30.96],
  'Solan':              [77.10, 30.91],
  'Parwanoo':           [76.96, 30.84],
  'Kala Amb':           [77.21, 30.50],
  'Jammu':              [74.86, 32.73],
  'Srinagar':           [74.80, 34.08],
  'Leh':                [77.58, 34.16],

  // ── District towns ──
  //
  // Measured against the live client table rather than guessed at: these are
  // the places that were falling back to a state centre, which stacks a whole
  // state's sugar belt onto one bubble in the middle of it. Sugar country is
  // district towns, not metros, so this is most of the map's real detail.
  // Uttar Pradesh
  'Saharanpur':         [77.55, 29.97],
  'Hardoi':             [80.11, 27.42],
  'Shahjahanpur':       [79.91, 27.88],
  'Kushinagar':         [83.89, 26.74],
  'Unnao':              [80.49, 26.55],
  'Shamli':             [77.31, 29.45],
  'Sitapur':            [80.68, 27.57],
  'Bulandshahr':        [77.86, 28.40],
  'Bulandshahar':       [77.86, 28.40],
  'Pilibhit':           [79.80, 28.64],
  'Rampur':             [79.03, 28.81],
  'Lakhimpur Kheri':    [80.78, 27.95],
  'Lakhimpur-Kheri':    [80.78, 27.95],
  'Kheri':              [80.78, 27.95],
  'Amroha':             [78.47, 28.90],
  'Bahraich':           [81.59, 27.57],
  'Baghpat':            [77.22, 28.95],
  'Barabanki':          [81.19, 26.93],
  'Basti':              [82.73, 26.79],
  'Ayodhya':            [82.20, 26.80],
  'Faizabad':           [82.14, 26.78],
  'Faizabaad':          [82.14, 26.78],
  'Deoria':             [83.79, 26.50],
  'Badaun':             [79.12, 28.04],
  'Budaun':             [79.12, 28.04],
  'Azamgarh':           [83.19, 26.07],
  'Hapur':              [77.78, 28.73],
  'Kanpur Dehat':       [79.98, 26.41],
  'Raebareli':          [81.23, 26.23],
  'Raebareilly':        [81.23, 26.23],
  'Sultanpur':          [82.07, 26.26],
  'Ambedkar Nagar':     [82.68, 26.42],
  'Balrampur':          [82.18, 27.43],
  'Seohara':            [78.59, 29.21],
  'Hasanpur':           [78.28, 28.72],
  // Maharashtra
  'Beed':               [75.76, 18.99],
  'Dharashiv':          [76.04, 18.19],
  'Osmanabad':          [76.04, 18.19],
  'Parbhani':           [76.78, 19.27],
  'Jalna':              [75.88, 19.84],
  'Hingoli':            [77.15, 19.72],
  'Nandurbar':          [74.24, 21.37],
  'Raigad':             [73.27, 18.52],
  'Tarapur':            [72.68, 19.86],
  'Boisar':             [72.75, 19.80],
  'Niphad':             [74.11, 20.08],
  'Paithan':            [75.39, 19.48],
  'Nasik':              [73.79, 20.00],
  'Chhatrapati Sambhajinagar': [75.34, 19.88],
  // Madhya Pradesh / Chhattisgarh
  'Betul':              [77.90, 21.90],
  'Narsinghpur':        [79.19, 22.95],
  'Barwani':            [74.90, 22.03],
  'Hoshangabad':        [77.72, 22.75],
  'Kabirdham':          [81.23, 22.01],
  'Kawardha':           [81.23, 22.01],
  'Durg':               [81.28, 21.19],
  // Gujarat
  'Palanpur':           [72.43, 24.17],
  'Tapi':               [73.40, 21.11],
  'Vyara':              [73.40, 21.11],
  'Porbandar':          [69.60, 21.64],
  'Aravalli':           [73.30, 23.46],
  'Modasa':             [73.30, 23.46],
  'Kachchh':            [69.86, 23.73],
  // Punjab / Haryana / Himachal
  'Gurdaspur':          [75.40, 32.04],
  'Hoshiarpur':         [75.91, 31.53],
  'Fazilka':            [74.03, 30.40],
  'Batala':             [75.20, 31.82],
  'Moga':               [75.17, 30.82],
  'Tarn Taran':         [74.93, 31.45],
  'Rupnagar':           [76.53, 30.97],
  'Ropar':              [76.53, 30.97],
  'Panchkula':          [76.86, 30.69],
  'Yamuna Nagar':       [77.28, 30.13],
  'Sirmour':            [77.30, 30.56],
  'Nahan':              [77.30, 30.56],
  // Uttarakhand
  'Udham Singh Nagar':  [79.40, 28.97],
  'Udhamsinghnagar':    [79.40, 28.97],
  'Jaspur':             [78.82, 29.28],
  'Sitarganj':          [79.70, 28.93],
  'Khatima':            [79.97, 28.92],
  // Bihar
  'West Champaran':     [84.50, 26.80],
  'West Chamaran':      [84.50, 26.80],
  'Bettiah':            [84.50, 26.80],
  'East Champaran':     [84.92, 26.65],
  'Motihari':           [84.92, 26.65],
  'Gopalganj':          [84.44, 26.47],
  'Sitamarhi':          [85.49, 26.59],
  // Karnataka
  'Vijayapura':         [75.71, 16.83],
  'Vijaypura':          [75.71, 16.83],
  'Bijapur':            [75.71, 16.83],
  'Haveri':             [75.40, 14.80],
  'Jamkhandi':          [75.29, 16.51],
  'Hassan':             [76.10, 13.01],
  'Udupi':              [74.75, 13.34],
  // Tamil Nadu / Puducherry
  'Villupuram':         [79.49, 11.94],
  'Tiruvannamalai':     [79.07, 12.23],
  'Perambalur':         [78.88, 11.23],
  'Tiruvallur':         [79.91, 13.14],
  'Ranipet':            [79.33, 12.93],
  'Namakkal':           [78.17, 11.22],
  'Kancheepuram':       [79.70, 12.84],
  'Kanchipuram':        [79.70, 12.84],
  'Thanjavur':          [79.14, 10.79],
  'Pondicherry':        [79.83, 11.93],
  // Andhra / Telangana
  'Khammam':            [80.15, 17.25],
  'Chittoor':           [79.10, 13.22],
  'East Godavari':      [82.00, 17.00],
  'Krishna':            [81.14, 16.19],
  'Machilipatnam':      [81.14, 16.19],
  // Odisha
  'Kalahandi':          [83.17, 19.91],
  'Bhawanipatna':       [83.17, 19.91],
  'Koraput':            [82.71, 18.81],
  'Khurda':             [85.62, 20.18],
};

// Misspellings seen in the client table, mapped onto a CITY_COORDS key. Kept
// apart from the coordinates so the table above stays a list of places.
const CITY_ALIASES: Record<string, string> = {
  'dhanbaad':     'Dhanbad',
  'hyderabaad':   'Hyderabad',
  'dedhradun':    'Dehradun',
  'bhubaneshwar': 'Bhubaneswar',
  'baroda':       'Vadodara',
  'bombay':       'Mumbai',
  'calcutta':     'Kolkata',
  'poona':        'Pune',
  'gurgaon ':     'Gurugram',
};

const CITY_BY_LOWER = new Map(Object.keys(CITY_COORDS).map(k => [k.toLowerCase(), k]));

/**
 * The CITY_COORDS key for a typed city name, or null.
 *
 * Trailing bracketed text and a trailing state are common in the imported
 * data ("Pune (MIDC)", "Hosur, Tamil Nadu"), so both are stripped before the
 * lookup rather than losing the pin. Hyphens are treated as spaces, which is
 * what makes "Lakhimpur-Kheri" and "Lakhimpur Kheri" the same place.
 */
export function cityKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(',')[0]
    .replace(/\([^)]*\)/g, '')
    .replace(/[-–]/g, ' ')
    .trim().toLowerCase().replace(/\s+/g, ' ');
  if (!base) return null;
  const direct = CITY_BY_LOWER.get(base);
  if (direct) return direct;
  const alias = CITY_ALIASES[base];
  return alias && CITY_COORDS[alias] ? alias : null;
}

// ── Not India ─────────────────────────────────────────────────
//
// `clients.state` holds a country for export accounts. Listed so the map can
// count them and say so rather than dropping them silently.

export const INTL_STATES = new Set([
  'UAE', 'Bangkok', 'Dubai', 'Jakarta',
  'Tanzania', 'Uganda', 'Kenya', 'Philippines', 'Vietnam',
]);

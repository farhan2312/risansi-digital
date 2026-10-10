// DEBTOR (sheet) code → users.id, for the monthly outstanding upload.
//
// This lives here rather than beside the action that uses it, and the reason is
// not tidiness. app/actions/risansi-outstanding.ts carries 'use server', and a
// 'use server' module may export nothing but async functions. Exporting this
// object from there compiled cleanly, passed every local check, and then threw
//
//   A "use server" file can only export async functions, found object.
//
// on the first real click — before any application code ran, which is why the
// upload failed with nothing to show for it and why no amount of error handling
// inside the action could surface a reason. Keeping the constant out of that
// file is what stops it happening again.
//
// AV / MRK / SV are personal initials, so they name a person. NI / SI / VA are
// territories (North India, South India, …), not people: mapping NI to a rep
// put "Amit Srivastava" on the Outstanding tile of 133 clients he had nothing
// to do with (18 Sep). A territory code stays a territory code — it is kept on
// the client row as outstanding_debtor_code and shown as the book it sits in.
export const DEBTOR_USER: Record<string, number> = {
  AV:  5,   // Anil Vankudre
  MRK: 6,   // Madhav R Kulkarni
  SV:  9,   // Sudhir Vichare
};

/** What a territory debtor code means, for display. */
export const DEBTOR_BOOK: Record<string, string> = {
  NI: 'North India book', SI: 'South India book', VA: 'VA book',
};

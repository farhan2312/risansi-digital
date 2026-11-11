// The spare quotation's terms and conditions, Domestic and Export, as in the user's
// "Trems & Condition Spare_Quotation.xlsx". The quote keeps which are unticked
// (termsOff); the wording of a ticked one can be edited on the Spare Quotation page's
// Terms card or on the document (both SpareDocEdits.terms).
// Client-safe.

export type TermsMarket = "domestic" | "export";
export type SpareTerm = { id: string; text: string };

export const TERMS_MARKETS: { value: TermsMarket; label: string }[] = [
  { value: "domestic", label: "Domestic" },
  { value: "export", label: "Export" },
];

/** The enquiry's client market type ("Domestic" / "Export", or empty). */
export const termsMarketOf = (clientMarketType: string | null | undefined): TermsMarket => (/export/i.test(clientMarketType ?? "") ? "export" : "domestic");

const VALIDITY = "Offer validity : 60 days";
const LD_CHARGES = "LD Charges : Not Acceptable";
const SHORTAGE = "Shortage/Damage : \na) Claims for shortage/damage must be conveyed by the Buyer to the RIL, in writing, no later than (10) calendar days from the date of the receipt of the Equipment/ material.\nb) Claims for shortage/damage beyond this period will not be accepted, nor will they be adequate reason for the delay or diminishment of payment.\nc) Failure by Buyer to given such written notice to RIL within the applicable time period shall be deemed an absolute and unconditional waiver of Buyer’s claim for shortage/damage.";
const TRANSIT = "Damage during Transit/Storage :\nRIL shall not be responsible for any transit insurance for damage or loss of goods. RIL shall not be responsible for inadequate storage of material causing damage to the goods.";
const CANCELLATION = "Order cancellation/Liquidated Damage Clause/Penalty :\nIf it is not approved in writing by us, no penalty/liquidated damage or order cancellation clause are acceptable to RIL. In case order is cancelled by buyer due to unavoidable reasons, buyer agrees to pay the cancellation charges as below :\na) Within 1 week of placing PO   – 15% of order value\nb) Within 2 weeks of placing PO – 30% of order value\nc) Within 3 weeks of placing PO – 45% of order value";
const WARRANTY_REF = "Warranty Clause : As attached";

export const SPARE_TERMS: Record<TermsMarket, SpareTerm[]> = {
  domestic: [
    { id: "d1", text: "Delivery Terms : Ex-works Kanpur" },
    { id: "d2", text: VALIDITY },
    { id: "d3", text: LD_CHARGES },
    { id: "d4", text: "Freight & Insurance : To be borne by buyer" },
    { id: "d5", text: "Payment Terms :  100% against Proforma Invoice before dispatch." },
    { id: "d6", text: "Packing Charges : Extra @ 3%" },
    { id: "d7", text: "GST : 18% (HSN Code 84139190) GSTIN : 09AAACR6923J1Z4" },
    // 8 and 9 swapped (user, 2026-11-11); the ids stay with their wording.
    { id: "d9", text: "Delivery Time : 2-3 weeks" },
    { id: "d8", text: "Bank Guarantee : Bank Guarantees are not acceptable unless otherwise approved in written by RIL. Payment of all issued BGs are to be released by the Buyer before dispatch of goods." },
    { id: "d10", text: SHORTAGE },
    { id: "d11", text: TRANSIT },
    { id: "d12", text: CANCELLATION },
    { id: "d13", text: WARRANTY_REF },
  ],
  export: [
    { id: "e1", text: "Delivery Terms : Ex-works Kanpur / FOB Mumbai, India / CIF Destination Port" },
    { id: "e2", text: VALIDITY },
    { id: "e3", text: LD_CHARGES },
    { id: "e4", text: "Mode of shipment : by Sea" },
    { id: "e5", text: "Payment Terms :  100% by TT against Proforma Invoice before dispatch upon proof of readiness." },
    { id: "e6", text: "Exportworthy Packing Charges : Extra @ 5%" },
    { id: "e7", text: "Our IMPORTER-EXPORTER CODE No. 0696002931" },
    { id: "e9", text: "Dispatch Time : 2-3 weeks and Delivery Time – additional transit (2-4 weeks by sea)" },
    { id: "e8", text: "Country of Origin & Supply : INDIA" },
    { id: "e10", text: SHORTAGE },
    { id: "e11", text: TRANSIT },
    { id: "e12", text: CANCELLATION },
    { id: "e13", text: WARRANTY_REF },
  ],
};

export const SPARE_WARRANTY_HEADING = "RISANSI SPARE PARTS WARRANTY CLAUSE";
export const SPARE_WARRANTY: SpareTerm[] = [
  { id: "w1", text: "All spares parts manufactured or distributed by Risansi Industries Ltd. are warranted by Risansi to be free of defects in material and workmanship. However, the warranty does not cover any operational wear and tear. Risansi Industries obligation under this warranty is limited to repair or replacement of the defective product or refund of the purchase price paid solely at the discretion of Risansi and provided such defective product is returned to Risansi freight prepaid & upon examination such product is found to be defective. This warranty shall be void in the event that the product has been subject to misuse, misapplication, improper maintenance, modification or tampering, improper operation and non-conforming operating parameters. This warranty is expressed in lieu of all other warranties, expressed or implied from Risansi Industries, its representatives or employees. Risansi Industries reserves the right to change spares specifications without notice." },
  { id: "w2", text: "The warranty does not apply where the spares have been – \n(i) subjected to abuse, misuse, damage, neglect, negligence, accident, improper testing, improper installation, improper storage, improper handling, improper operation, non-conforming operating parameters,  abnormal physical stress, abnormal environmental condition, or use contrary to any instructions issued by Risansi; \n(ii) modified, reconstructed, repaired, or altered by persons other than Risansi or its authorized representative; or \n(iii) used with any third-party product , hardware, or other product that has not been previously approved in writing by Risansi Industries. Additionally, this warranty does not cover claims for labor, material, time or transportation, and does not apply to loss or damage caused by fire, theft, riot, explosion, labor dispute, act of God, or other causes beyond control of Risansi Industries Ltd." },
  { id: "w3", text: "EXCLUSIVE REMEDY : \na. The buyer’s sole remedy under this warranty is limited to the repair, replacement or rebuilding of any spare part which does not conform to the warranties provided herein or, in Risansi industries’ sole discretion. Buyer’s remedy is conditioned on Buyer’s compliance with its obligations under this warranty. Spare parts that buyer believes do not conform to this warranty must be returned transportation prepaid and received at our factory within the warranty period. If Risansi determines that the supplied spare part is non-conforming and is otherwise covered by this warranty, the rebuilt or replaced spare part will be returned to the customer at the expense of Risansi Industries, and will carry the same warranties as provided above.\nb. RISANSI INDUSTRIES LTD. WILL NOT BE RESPONSIBLE FOR ANY INCIDENTAL, SPECIAL, EXEMPLARY OR CONSEQUENTIAL DAMAGES, INCLUDING WITHOUT LIMITATION DIRECT AND INDIRECT LOST PROFITS, REGARDLESS OF WHETHER THOSE DAMAGES WERE FORESEEABLE.\nc. It is to be noted that rubber parts have a shelf life, hence, usage of rubber parts after storage period of greater than 18 months (from the date of invoice) is not recommended." },
  { id: "w4", text: "The buyer is requested to follow the IOM carefully for operations, flushing and installation guidelines." },
];

/** "Warranty Clause : As attached": unticked, the warranty clauses aren't printed either. */
export const WARRANTY_TERM: Record<TermsMarket, string> = { domestic: "d13", export: "e13" };

export const SPARE_TERM_IDS = new Set([...SPARE_TERMS.domestic, ...SPARE_TERMS.export, ...SPARE_WARRANTY].map((t) => t.id));

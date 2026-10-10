// Real Excel charts, written by hand into a workbook ExcelJS has already built.
//
// ExcelJS cannot create charts — it has addImage and conditional formatting and
// nothing else — so a "chart" from it is either a picture or a row of coloured
// cells. Neither survives contact with a manager who wants to click a bar and
// see the number, or print the sheet and have it look like a report.
//
// An .xlsx IS a zip of XML parts. So the workbook is built normally, then opened
// and four things are added: the chart part itself, a drawing that positions it,
// the relationships tying them together, and a content-type declaration so Excel
// knows what it is looking at. The result is a genuine chart object — clickable,
// resizable, restyleable, and it recalculates if somebody edits the data.
//
// Deliberately narrow: clustered bar and line, one series each, solid fill. Every
// element below is required by the schema. Excel is unforgiving about ordering
// and will report a file as corrupt rather than say which tag is out of place,
// so the sequences here follow the spec exactly and should be changed carefully.

import JSZip from 'jszip';

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A sheet name needs quoting in a formula when it holds anything but word characters. */
function sheetRef(sheet: string): string {
  return /^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
}

function axis(id: number, crossId: number, kind: 'cat' | 'val', opts: { pos: string; reverse?: boolean; numFmt?: string }): string {
  // catAx and valAx share most of their shape; the differences are the element
  // name and the two children only one of them carries.
  const tag = kind === 'cat' ? 'c:catAx' : 'c:valAx';
  return `<${tag}>
    <c:axId val="${id}"/>
    <c:scaling><c:orientation val="${opts.reverse ? 'maxMin' : 'minMax'}"/></c:scaling>
    <c:delete val="0"/>
    <c:axPos val="${opts.pos}"/>
    ${kind === 'val' ? '<c:majorGridlines/>' : ''}
    <c:numFmt formatCode="${kind === 'val' ? esc(opts.numFmt ?? 'General') : 'General'}" sourceLinked="0"/>
    <c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
    <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="850"/></a:pPr><a:endParaRPr lang="en-IN"/></a:p></c:txPr>
    <c:crossAx val="${crossId}"/>
    <c:crosses val="autoZero"/>
    ${kind === 'cat' ? '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>' : '<c:crossBetween val="between"/>'}
  </${tag}>`;
}

/**
 * One chart part.
 *
 * `cats` and `vals` are A1 ranges on `sheet`, e.g. 'B12:B26'. `dir` is 'bar' for
 * horizontal bars (long names stay readable) or 'col' for vertical.
 */
export interface ChartSpec {
  title: string;
  sheet: string;
  /** A1 range holding the category labels, e.g. '$AB$70:$AB$84'. */
  cats: string;
  /** A1 range holding the values. */
  vals: string;
  seriesName: string;
  type?: 'bar' | 'line';
  /** 'bar' for horizontal bars, 'col' for vertical. Ignored for a line. */
  dir?: 'bar' | 'col';
  colour?: string;
  numFmt?: string;
}

export interface ChartPlacement {
  fromCol: number; fromRow: number; toCol: number; toRow: number;
}

export function chartXml({ title, sheet, cats, vals, seriesName, type = 'bar', dir = 'bar', colour = '0A3D8F', numFmt = 'General' }: ChartSpec): string {
  const catAxId = 111000001, valAxId = 222000001;
  const ref = sheetRef(sheet);
  const plot = type === 'line'
    ? `<c:lineChart>
         <c:grouping val="standard"/><c:varyColors val="0"/>
         <c:ser>
           <c:idx val="0"/><c:order val="0"/>
           <c:tx><c:v>${esc(seriesName)}</c:v></c:tx>
           <c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></a:ln></c:spPr>
           <c:marker><c:symbol val="circle"/><c:size val="5"/>
             <c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr></c:marker>
           <c:cat><c:strRef><c:f>${ref}!${cats}</c:f></c:strRef></c:cat>
           <c:val><c:numRef><c:f>${ref}!${vals}</c:f></c:numRef></c:val>
           <c:smooth val="0"/>
         </c:ser>
         <c:marker val="1"/>
         <c:axId val="${catAxId}"/><c:axId val="${valAxId}"/>
       </c:lineChart>`
    : `<c:barChart>
         <c:barDir val="${dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>
         <c:ser>
           <c:idx val="0"/><c:order val="0"/>
           <c:tx><c:v>${esc(seriesName)}</c:v></c:tx>
           <c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr>
           <c:cat><c:strRef><c:f>${ref}!${cats}</c:f></c:strRef></c:cat>
           <c:val><c:numRef><c:f>${ref}!${vals}</c:f></c:numRef></c:val>
         </c:ser>
         <c:gapWidth val="40"/>
         <c:axId val="${catAxId}"/><c:axId val="${valAxId}"/>
       </c:barChart>`;

  // A horizontal bar reads top-down only if the category axis is reversed;
  // without this the biggest value sits at the bottom, which nobody expects.
  const catOpts = dir === 'bar' && type !== 'line'
    ? { pos: 'l', reverse: true } : { pos: 'b' };
  const valOpts = dir === 'bar' && type !== 'line'
    ? { pos: 'b', numFmt } : { pos: 'l', numFmt };

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"><a:solidFill><a:srgbClr val="0A3D8F"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="en-IN" sz="1100" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      ${plot}
      ${axis(catAxId, valAxId, 'cat', catOpts)}
      ${axis(valAxId, catAxId, 'val', valOpts)}
      <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr>
</c:chartSpace>`;
}

/** The drawing that says where on the sheet each chart sits. */
function drawingXml(anchors: ChartPlacement[]): string {
  const body = anchors.map((a, i) => `
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}">${body}
</xdr:wsDr>`;
}

/**
 * Add charts to a finished .xlsx buffer.
 *
 * `sheetFile` is the part name of the sheet they belong on — 'sheet1.xml' for
 * the first worksheet ExcelJS wrote. Each chart carries its own anchor.
 */
export async function injectCharts(
  buffer: Buffer,
  { sheetFile = 'sheet1.xml', charts }: { sheetFile?: string; charts: { xml: string; anchor: ChartPlacement }[] },
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  // 1. The chart parts.
  charts.forEach((ch, i) => {
    zip.file(`xl/charts/chart${i + 1}.xml`, ch.xml);
  });

  // 2. The drawing, and its relationships pointing at each chart.
  zip.file('xl/drawings/drawing1.xml', drawingXml(charts.map(c => c.anchor)));
  zip.file('xl/drawings/_rels/drawing1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${R}">${charts.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${R}/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}
</Relationships>`);

  // 3. The sheet has to point at the drawing, and declare it in its own rels.
  //    ExcelJS numbers its relationship ids, so a fresh one is picked past the
  //    highest already there rather than assumed to be rId1.
  const relPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const existing = zip.file(relPath) ? await zip.file(relPath)!.async('string') : null;
  const used = existing ? [...existing.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])) : [];
  const drawingRid = `rId${(used.length ? Math.max(...used) : 0) + 1}`;
  const drawingRel = `<Relationship Id="${drawingRid}" Type="${R}/drawing" Target="../drawings/drawing1.xml"/>`;
  zip.file(relPath, existing
    ? existing.replace('</Relationships>', `${drawingRel}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${R}">${drawingRel}</Relationships>`);

  const sheetPath = `xl/worksheets/${sheetFile}`;
  let sheet = await zip.file(sheetPath)!.async('string');
  // WHERE <drawing/> GOES, precisely.
  //
  // CT_Worksheet is a sequence, and drawing sits near the end of it but NOT at
  // the very end: it comes after pageSetup and before extLst. Appending it just
  // inside </worksheet> is right only when the sheet has no extLst — and this
  // one does, because conditional-formatting data bars are written as an x14
  // extension. Excel's response was "we found a problem with some content",
  // naming the file and nothing else.
  //
  // So: before the worksheet-level extLst when there is one, otherwise before
  // the closing tag. The worksheet-level extLst is the last one in the part;
  // the others belong to cfRule elements and have closed long before it opens.
  const drawingTag = `<drawing r:id="${drawingRid}"/>`;
  if (/<\/extLst>\s*<\/worksheet>\s*$/.test(sheet)) {
    const at = sheet.lastIndexOf('<extLst>');
    sheet = sheet.slice(0, at) + drawingTag + sheet.slice(at);
  } else {
    sheet = sheet.replace('</worksheet>', `${drawingTag}</worksheet>`);
  }
  zip.file(sheetPath, sheet);

  // 4. Content types, or Excel does not know what the new parts are.
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath)!.async('string');
  const overrides = [
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...charts.map((_, i) =>
      `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`),
  ].join('');
  ct = ct.replace('</Types>', `${overrides}</Types>`);
  zip.file(ctPath, ct);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}

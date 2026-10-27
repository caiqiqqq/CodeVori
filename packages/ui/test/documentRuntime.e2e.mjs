import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { zipSync, strToU8 } from "fflate";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__document-runtime-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
const zip = (entries) =>
  Buffer.from(
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))),
  ).toString("base64");
const types = (extra) =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`;
const rel = (type, target, id = "rId1") =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const rels = (r) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r}</Relationships>`;
const workbook = zip({
  "[Content_Types].xml": types(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
  ),
  "_rels/.rels": rels(rel("officeDocument", "xl/workbook.xml")),
  "xl/workbook.xml":
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": rels(
    rel("worksheet", "worksheets/sheet1.xml") + rel("worksheet", "worksheets/sheet2.xml", "rId2"),
  ),
  ...Object.fromEntries(
    [1, 2].map((n) => [
      `xl/worksheets/sheet${n}.xml`,
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:T100"/><sheetData>${Array.from({ length: 100 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Sheet ${n} Row ${i + 1}</t></is></c><c r="T${i + 1}"><v>${i}</v></c></row>`).join("")}</sheetData></worksheet>`,
    ]),
  ),
});
const docx = zip({
  "[Content_Types].xml": types(
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  ),
  "_rels/.rels": rels(rel("officeDocument", "word/document.xml")),
  "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${Array.from({ length: 150 }, (_, i) => `<w:p><w:r><w:t>Document paragraph ${i} session isolation fixture.</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
});
const pptx = zip({
  "[Content_Types].xml": types(
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      [1, 2]
        .map(
          (n) =>
            `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        )
        .join(""),
  ),
  "_rels/.rels": rels(rel("officeDocument", "ppt/presentation.xml")),
  "ppt/presentation.xml":
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
  "ppt/_rels/presentation.xml.rels": rels(
    rel("slide", "slides/slide1.xml") + rel("slide", "slides/slide2.xml", "rId2"),
  ),
  ...Object.fromEntries(
    [1, 2].map((n) => [
      `ppt/slides/slide${n}.xml`,
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    ]),
  ),
});
let pdf = "%PDF-1.4\n";
const offsets = [0];
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
  ...Array.from(
    { length: 2 },
    () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 1500] /Resources << >> >>",
  ),
];
objects.forEach((o, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
  .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const labels = {
  loading: "Loading",
  error: "Error",
  noSlides: "No slides",
  pageInput: "Page",
  previousPage: "Previous",
  nextPage: "Next",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  thumbnail: (n) => `Slide ${n}`,
};
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {DocumentViewStateProvider} from '../../../ui/src/lib/documentViewState.tsx';
import {PdfViewer} from '../../../ui/src/components/ui/pdf-viewer.tsx';
import {PptxPreviewViewer} from '../../../ui/src/components/ui/pptx-preview-viewer.tsx';
import {PreviewPaneOfficeXlsxContent} from '../../../ui/src/previewPaneOfficeXlsxContent.tsx';
import {PreviewPaneOfficeDocxContent} from '../../../ui/src/previewPaneOfficeDocxContent.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import '../../../ui/src/styles.css';
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
const pdf=decode('${Buffer.from(pdf).toString("base64")}'),xlsx=decode('${workbook}'),docx=decode('${docx}'),pptx=decode('${pptx}');
const labels={...${JSON.stringify(labels)},thumbnail:n=>'Slide '+n};
function Fixture(){const [session,setSession]=useState('A'),[kind,setKind]=useState('pdf'),[show,setShow]=useState(true);return <ZCodeIntlProvider initialLocale="zh-CN"><nav>{['A','B'].map(s=><button key={s} onClick={()=>setSession(s)}>{s}</button>)}{['pdf','xlsx','docx','pptx'].map(k=><button key={k} onClick={()=>setKind(k)}>{k}</button>)}<button onClick={()=>setShow(!show)}>Toggle</button></nav><main style={{height:500,width:900}}>{show&&<DocumentViewStateProvider stateKey={JSON.stringify(['/fixture',session,kind])}>{kind==='pdf'?<PdfViewer source={pdf} labels={labels}/>:kind==='xlsx'?<PreviewPaneOfficeXlsxContent buffer={xlsx} errorMessage="Xlsx error" isDark={false} sourcePath="fixture.xlsx"/>:kind==='docx'?<PreviewPaneOfficeDocxContent buffer={docx} errorMessage="Docx error" sourcePath="fixture.docx"/>:<PptxPreviewViewer data={pptx} labels={labels} fileName="fixture.pptx"/>}</DocumentViewStateProvider>}</main></ZCodeIntlProvider>};createRoot(document.getElementById('root')!).render(<Fixture/>);
 `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`;
  const click = (label) => page.getByRole("button", { name: label, exact: true }).click();
  await page.goto(base);
  await page.getByRole("button", { name: "Next", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Next"]').disabled);
  await click("Next");
  await click("Zoom in");
  await page.getByText("125%", { exact: true }).waitFor();
  await click("B");
  assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "1");
  await page.getByText("100%", { exact: true }).waitFor();
  await click("A");
  assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "2");
  await page.getByText("125%", { exact: true }).waitFor();
  await click("Toggle");
  await click("Toggle");
  assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "2");
  const other = await browser.newPage();
  await other.goto(base);
  await other.getByLabel("Page", { exact: true }).waitFor();
  assert.equal(await other.getByLabel("Page", { exact: true }).inputValue(), "1");
  await other.close();
  await click("xlsx");
  await page.getByRole("tab", { name: "Second", exact: true }).click();
  const sheet = page.locator("[data-document-sheet-scroller]");
  await sheet.hover();
  await page.mouse.wheel(0, 750);
  await page.waitForFunction(
    () => document.querySelector("[data-document-sheet-scroller]").scrollTop > 700,
  );
  await click("B");
  await page.getByRole("tab", { name: "First", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("tab", { name: "First", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await click("A");
  await page.getByRole("tab", { name: "Second", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Second",
  );
  await page.waitForFunction(
    () => document.querySelector("[data-document-sheet-scroller]").scrollTop > 700,
  );
  await click("docx");
  await page
    .getByText("Document paragraph 149 session isolation fixture.", { exact: true })
    .waitFor();
  // Locate the actual viewport by its scroll extent; generated DOCX pages are asynchronous.
  const scrollWord = () =>
    page.locator("main").evaluate((el) => {
      const e = [...el.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).overflowY === "auto" && e.scrollHeight > e.clientHeight,
      );
      if (!e) throw Error("no DOCX viewport");
      e.dataset.testWordScroll = "";
      e.scrollTop = 800;
      e.dispatchEvent(new Event("scroll"));
      return e.scrollTop;
    });
  assert.ok((await scrollWord()) > 700);
  await click("B");
  await page
    .getByText("Document paragraph 149 session isolation fixture.", { exact: true })
    .waitFor();
  await click("A");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main div")].some((e) => e.scrollTop > 700),
  );
  await click("pptx");
  await page.getByLabel("Page", { exact: true }).waitFor({ timeout: 30000 });
  await click("Next");
  await click("Zoom in");
  const zoom = await page.locator("main").innerText();
  assert.ok(zoom.includes("125%"));
  await click("B");
  await page.getByLabel("Page", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "1");
  await click("A");
  await page.getByLabel("Page", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "2");
  await page.getByText("125%", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS PDF/PPTX page and zoom, XLSX sheet and scroll, DOCX scroll, session switches, remount and independent window",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}

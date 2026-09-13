"use client";

/**
 * Same mechanism as the rig's report: the browser's own print-to-PDF, driven by
 * the print stylesheet in globals.css. No PDF dependency, and the chart prints
 * as vector SVG rather than a screenshot.
 */
export function ExportPdfButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
    >
      Export PDF
    </button>
  );
}

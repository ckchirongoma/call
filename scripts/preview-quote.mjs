// Call — the print-to-PDF proof of the quotation document (SPEC R8).
//
// A stub until Task 6.4, which replaces this file with the real thing: render
// the two-needs-over-budget fixture's quotation in Chromium to
// preview/quote.pdf, and check the page count and the text layer. Until there
// is a renderer there is nothing to print, so it says so and exits 0: the
// `npm run verify` chain and CI's "Print-to-PDF smoke" step are whole from
// Phase 0, and the step starts proving something the day the renderer lands.

const smoke = process.argv.includes("--smoke");
console.log(`preview-quote${smoke ? " --smoke" : ""}: no renderer yet (Task 6.4 adds it)`);
process.exit(0);

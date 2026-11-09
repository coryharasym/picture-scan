# Picture Scan

A small, dependency-free document scanner designed for iPhone Safari, with desktop support. Take photos or select existing images, adjust the four page corners, flatten perspective, clean up the scan, and combine up to 24 pages into a printable PDF.

## Features

- Camera capture, multiple-photo import, and desktop drag and drop.
- Automatic edge suggestions plus draggable/keyboard-adjustable corners.
- Perspective correction and 90° rotation.
- Clean colour with local shadow correction, original colour, grayscale, and black-and-white finishes; brightness control and flattened preview.
- Edit, delete, and reorder pages before exporting.
- Letter (default) or A4 PDF pages with ¼-inch margins and no stretching.
- Name the document, then use the native file share sheet where supported or download the PDF. On iPhone, choose **Save to Files** from the share sheet.
- Add to Home Screen; the application shell is available offline after a successful first visit.

## Privacy

All photo processing and PDF generation happen in the browser. There is no server, analytics, account, upload, third-party script, or document storage. Only static application assets are cached for offline use. Photos and PDF data remain in memory until the tab is closed or the pages are cleared. Save/share a PDF before leaving the app; refreshing discards the current document. The browser may retain a tab in memory while it is backgrounded. Downloaded/shared PDFs are saved only at the destination you choose.

## Run locally

Serve this directory with a static HTTP server, for example `python3 -m http.server 5173`, then visit `http://localhost:5173`. There is no dependency installation or build step. Run `npm test` for geometry, edge detection, image processing, and PDF byte-structure checks.

## GitHub Pages

After merging, enable **Settings → Pages → Deploy from a branch → main / (root)**. All paths are relative, so the app works at `/picture-scan/`. HTTPS is required for the native share API and service worker.

## Practical limits

Automatic edge detection works best on a light sheet against a contrasting background; always check the suggested corners. Dragging the corners is the reliable fallback for coloured sheets, low contrast, complex scenes, or shadows. Perspective correction makes a planar page rectangular; it does not unbend curved book pages. Review fine text in the preview, especially in black-and-white mode. PDFs contain images, not searchable OCR text.

Photos are normalized to a maximum 2400-pixel edge; output scans have a maximum 2200-pixel edge. Files larger than 40 MB are rejected. A 24-page cap limits browser memory use. JPEG and PNG are the most portable choices; HEIC/HEIF support depends on the browser and OS. An unsupported format produces an explanatory message. Camera permission, hardware capture, native iOS sharing, and Home Screen behavior require a real-device check.

## Files

`index.html` / `style.css`: interface. `app.js`: session and editing flow. `imaging.js`: geometry, edge suggestions, and pixel processing. `processor.js`: background worker. `pdf.js`: JPEG-backed PDF writer. `export.js`: file-only sharing, PDF preview, and download attachment preparation. `sw.js`: static-asset-only offline cache.

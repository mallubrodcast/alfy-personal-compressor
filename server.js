const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Setup storage directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const COMPRESSED_DIR = path.join(__dirname, 'compressed');
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(COMPRESSED_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const cleanupFiles = (...filePaths) => {
  filePaths.forEach(filePath => {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
  });
};

// Compression Engines
async function compressImage(inputPath, outputPath, quality, format) {
  const targetQuality = Math.max(1, Math.min(100, parseInt(quality)));
  let pipeline = sharp(inputPath);

  switch (format.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      pipeline = pipeline.jpeg({ quality: targetQuality, mozjpeg: true });
      break;
    case '.png':
      pipeline = pipeline.png({ quality: targetQuality, compressionLevel: 9 });
      break;
    case '.webp':
      pipeline = pipeline.webp({ quality: targetQuality });
      break;
    case '.gif':
      pipeline = pipeline.gif({ colours: Math.floor((targetQuality / 100) * 256) });
      break;
    default:
      pipeline = pipeline.webp({ quality: targetQuality });
  }
  await pipeline.toFile(outputPath);
}

async function compressPDF(inputPath, outputPath) {
  const pdfBytes = await fs.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setProducer('');
  const compressedBytes = await pdfDoc.save({ useObjectStreams: true });
  await fs.writeFile(outputPath, compressedBytes);
}

function compressMedia(inputPath, outputPath, targetQuality, isVideo = true) {
  return new Promise((resolve, reject) => {
    const qualityVal = parseInt(targetQuality);
    let command = ffmpeg(inputPath);

    if (isVideo) {
      const crf = Math.round(51 - ((qualityVal / 100) * 33));
      command
        .videoCodec('libx264')
        .outputOptions([`-crf ${crf}`, '-preset faster'])
        .audioCodec('aac')
        .audioBitrate('128k');
    } else {
      const bitrate = Math.max(64, Math.round((qualityVal / 100) * 320));
      command.audioCodec('libmp3lame').audioBitrate(`${bitrate}k`);
    }

    command
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// API Endpoint for Server-Side Compression
app.post('/api/compress', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const inputPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const outputFilename = `compressed-${Date.now()}${ext}`;
  const outputPath = path.join(COMPRESSED_DIR, outputFilename);
  const quality = req.body.quality || 58;

  try {
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) {
      await compressImage(inputPath, outputPath, quality, ext);
    } else if (ext === '.pdf') {
      await compressPDF(inputPath, outputPath);
    } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
      await compressMedia(inputPath, outputPath, quality, true);
    } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
      await compressMedia(inputPath, outputPath, quality, false);
    } else {
      await fs.copy(inputPath, outputPath);
    }

    const originalStats = await fs.stat(inputPath);
    const compressedStats = await fs.stat(outputPath);

    res.json({
      success: true,
      originalName: req.file.originalname,
      originalSize: originalStats.size,
      compressedSize: compressedStats.size,
      downloadUrl: `/download/${outputFilename}`
    });

  } catch (err) {
    console.error('Compression Error:', err);
    res.status(500).json({ error: 'File compression failed.' });
  } finally {
    setTimeout(() => cleanupFiles(inputPath), 5000);
  }
});

// File Download Endpoint
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(COMPRESSED_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File expired or not found.');
  }

  res.download(filePath, (err) => {
    if (!err) {
      setTimeout(() => cleanupFiles(filePath), 60000);
    }
  });
});

// Serve Integrated Glassmorphism UI
app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html lang="en">
 <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CompressX Pro — Smart Media Compression</title>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.263.0/dist/umd/lucide.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #e9efff;
      --muted: #99a8c7;
      --panel: rgba(16, 25, 49, 0.72);
      --panel-edge: rgba(151, 176, 255, 0.16);
      --accent: #75f5c8;
      --accent-deep: #0e9f78;
      --navy: #08101f;
      --danger: #ff8f9d;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }

    body {
      width: 100%;
      min-height: 100vh;
      margin: 0;
      font-family: "DM Sans", sans-serif;
      color: var(--ink);
      background: #08101f;
      overflow-x: hidden;
    }

    body.light-mode {
      --ink: #12203a;
      --muted: #586983;
      --panel: rgba(255, 255, 255, 0.75);
      --panel-edge: rgba(52, 83, 136, 0.16);
      --accent: #087e61;
      --accent-deep: #05634c;
      --navy: #edf3fb;
      --danger: #cc3351;
      background: #edf3fb;
    }

    .app-shell {
      width: 100%;
      min-height: 100vh;
      position: relative;
      isolation: isolate;
      background:
        radial-gradient(circle at 12% 3%, rgba(68, 109, 255, .26), transparent 30%),
        radial-gradient(circle at 88% 13%, rgba(32, 226, 170, .16), transparent 24%),
        #08101f;
    }

    .light-mode .app-shell {
      background:
        radial-gradient(circle at 10% 1%, rgba(115, 157, 255, .24), transparent 31%),
        radial-gradient(circle at 91% 12%, rgba(61, 212, 165, .18), transparent 25%),
        #edf3fb;
    }

    .orb {
      position: absolute;
      border-radius: 999px;
      filter: blur(2px);
      opacity: .45;
      pointer-events: none;
      z-index: -1;
      animation: drift 10s ease-in-out infinite alternate;
    }

    .orb-one { width: 17rem; height: 17rem; background: #3757db; right: -7rem; bottom: 4rem; }
    .orb-two { width: 11rem; height: 11rem; background: #13a980; left: -4rem; bottom: 22%; animation-delay: -4s; }

    @keyframes drift {
      from { transform: translate3d(0, 0, 0) scale(1); }
      to { transform: translate3d(1.4rem, -1rem, 0) scale(1.08); }
    }

    .glass-panel {
      background: var(--panel);
      border: 1px solid var(--panel-edge);
      box-shadow: 0 25px 70px rgba(0, 0, 0, .2), inset 0 1px 0 rgba(255, 255, 255, .05);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
    }

    .upload-zone {
      border: 1.5px dashed rgba(117, 245, 200, .45);
      background: linear-gradient(135deg, rgba(117, 245, 200, .07), rgba(91, 124, 255, .06));
      transition: border-color .25s ease, background .25s ease, transform .25s ease;
      cursor: pointer;
    }

    .upload-zone:hover, .upload-zone.drag-over {
      border-color: var(--accent);
      background: linear-gradient(135deg, rgba(117, 245, 200, .16), rgba(91, 124, 255, .12));
      transform: translateY(-2px);
    }

    .range-input {
      appearance: none;
      width: 100%;
      height: 7px;
      border-radius: 999px;
      outline: none;
      background: linear-gradient(to right, var(--accent) 0%, var(--accent) 58%, rgba(153, 168, 199, .26) 58%, rgba(153, 168, 199, .26) 100%);
    }

    .range-input::-webkit-slider-thumb {
      appearance: none;
      width: 21px;
      height: 21px;
      border: 4px solid #ffffff;
      border-radius: 50%;
      background: var(--accent-deep);
      box-shadow: 0 2px 10px rgba(0, 0, 0, .36);
      cursor: pointer;
    }

    .progress-track { background: rgba(153, 168, 199, .16); }
    .progress-fill {
      width: 0%;
      background: linear-gradient(90deg, #58dcb3, #91f2d6);
      transition: width .35s ease;
    }

    .file-preview {
      background: rgba(7, 15, 31, .55);
      border: 1px solid var(--panel-edge);
    }

    .preview-image {
      width: 100%;
      height: 10rem;
      object-fit: cover;
      border-radius: 14px;
      display: none;
    }

    .mono { font-family: "Space Mono", monospace; }
  </style>
 </head>
 <body>
  <div class="app-shell">
   <div class="orb orb-one"></div>
   <div class="orb orb-two"></div>
   <header class="w-full px-5 pt-5 sm:px-8 sm:pt-7">
    <nav class="mx-auto flex max-w-6xl items-center justify-between">
     <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-300/20">
       <i data-lucide="shrink" aria-hidden="true" class="h-5 w-5"></i>
      </div>
      <div>
       <p class="font-semibold tracking-tight">CompressX Pro</p>
       <p class="text-xs" style="color:#99a8c7;">Universal Optimizer</p>
      </div>
     </div>
     <div class="flex items-center gap-3">
      <button id="theme-toggle" type="button" class="flex h-10 w-10 items-center justify-center rounded-full border transition hover:scale-105" style="border-color:rgba(151,176,255,.16); background:rgba(16,25,49,.72); color:#e9efff;">
       <i data-lucide="sun" class="h-4 w-4"></i>
      </button>
     </div>
    </nav>
   </header>

   <main class="w-full px-5 pb-10 pt-12 sm:px-8 sm:pb-14 sm:pt-16">
    <section class="mx-auto max-w-6xl">
     <div class="mx-auto max-w-3xl text-center">
      <p class="mono mb-4 text-xs font-bold uppercase tracking-[0.2em]" style="color:#75f5c8;">Ultra-Fast Compression</p>
      <h1 class="text-3xl font-bold tracking-tight sm:text-5xl">Optimize Images, PDFs & Media Files</h1>
      <p class="mx-auto mt-5 max-w-2xl text-base leading-7" style="color:#99a8c7;">Reduce file size without sacrificing visual or audio quality directly in your browser or via cloud backend.</p>
     </div>

     <div class="mt-10 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <section class="glass-panel rounded-[28px] p-4 sm:p-6">
       <h2 class="font-semibold text-lg">Upload Media</h2>
       <input id="file-input" type="file" class="sr-only">
       <div id="upload-zone" class="upload-zone mt-5 flex min-h-72 flex-col items-center justify-center rounded-2xl px-6 py-10 text-center" role="button" tabindex="0">
        <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-300 text-slate-950 shadow-xl shadow-emerald-300/20">
         <i data-lucide="cloud-upload" class="h-7 w-7"></i>
        </div>
        <p class="mb-2 mt-5 font-semibold text-base">Drag & Drop file here</p>
        <p class="m-0 max-w-sm text-sm leading-6" style="color:#99a8c7;">Supports JPG, PNG, WebP, PDF, MP4, MP3 & More</p>
        <span class="mt-5 inline-block rounded-xl px-4 py-2 text-sm font-semibold" style="background:rgba(117,245,200,.13); color:#75f5c8;">Browse Files</span>
       </div>
       <p id="validation-message" class="mt-4 hidden rounded-xl px-4 py-3 text-sm font-medium"></p>
      </section>

      <aside class="glass-panel rounded-[28px] p-6">
       <div class="flex items-start justify-between gap-4">
        <div>
         <h2 class="font-semibold text-lg">Compression Target</h2>
         <p class="mb-0 mt-2 text-sm leading-6" style="color:#99a8c7;">Adjust processing quality level.</p>
        </div>
        <output id="reduction-output" class="mono rounded-xl px-3 py-2 text-sm font-bold" style="background:rgba(117,245,200,.14); color:#75f5c8;">58%</output>
       </div>
       <div class="mt-8">
        <label for="reduction-slider" class="text-sm font-medium">Target Quality</label>
        <input id="reduction-slider" class="range-input mt-4" type="range" min="10" max="95" value="58">
        <div class="mt-3 flex justify-between text-xs" style="color:#99a8c7;">
         <span>High Compression</span>
         <span>Best Quality</span>
        </div>
       </div>
       <div class="mt-8 rounded-2xl border p-4" style="border-color:rgba(151,176,255,.16); background:rgba(5,12,27,.18);">
        <div class="flex gap-3">
         <i data-lucide="shield-check" class="mt-0.5 h-5 w-5 flex-none" style="color:#75f5c8;"></i>
         <p class="m-0 text-sm leading-6" style="color:#99a8c7;">Files are processed securely and deleted automatically from the server.</p>
        </div>
       </div>
       <button id="compress-again" type="button" class="mt-6 w-full rounded-2xl px-5 py-3.5 font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-40" style="background:#75f5c8;" disabled>Re-compress</button>
      </aside>
     </div>

     <section id="results-panel" class="glass-panel mt-5 hidden rounded-[28px] p-5 sm:p-6">
      <div class="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
       <div>
        <p class="mono m-0 text-xs font-bold uppercase tracking-[0.17em]" style="color:#75f5c8;">Result</p>
        <h2 class="mb-0 mt-2 font-semibold text-xl">Compression Complete</h2>
       </div>
       <div id="processing-status" class="mono text-xs" style="color:#99a8c7;">Ready</div>
      </div>
      <div class="mt-6 grid gap-5 md:grid-cols-[180px_1fr]">
       <div class="file-preview overflow-hidden rounded-2xl p-2">
        <img id="preview-image" class="preview-image" alt="Preview">
        <div id="preview-placeholder" class="flex h-40 items-center justify-center rounded-xl" style="background:rgba(117,245,200,.08); color:#75f5c8;">
         <i data-lucide="file" class="h-10 w-10"></i>
        </div>
       </div>
       <div class="flex min-w-0 flex-col justify-between">
        <div>
         <p id="file-name" class="truncate text-base font-semibold"></p>
         <p id="file-type" class="mono mt-1 text-xs uppercase" style="color:#99a8c7;"></p>
         <div class="progress-track mt-5 h-2 overflow-hidden rounded-full">
          <div id="progress-fill" class="progress-fill h-full rounded-full"></div>
         </div>
        </div>
        <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
         <div class="rounded-2xl border p-4" style="border-color:rgba(151,176,255,.16);">
          <p class="m-0 text-xs" style="color:#99a8c7;">Original Size</p>
          <p id="original-size" class="mono mb-0 mt-2 text-sm font-bold">—</p>
         </div>
         <div class="rounded-2xl border p-4" style="border-color:rgba(151,176,255,.16);">
          <p class="m-0 text-xs" style="color:#99a8c7;">Compressed Size</p>
          <p id="compressed-size" class="mono mb-0 mt-2 text-sm font-bold">—</p>
         </div>
         <div class="col-span-2 rounded-2xl border p-4 sm:col-span-1" style="border-color:rgba(151,176,255,.16);">
          <p class="m-0 text-xs" style="color:#99a8c7;">Total Saved</p>
          <p id="saved-size" class="mono mb-0 mt-2 text-sm font-bold" style="color:#75f5c8;">—</p>
         </div>
        </div>
       </div>
      </div>
      <a id="download-button" class="mt-6 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 font-bold text-slate-950 transition sm:w-auto" style="background:#75f5c8; text-decoration:none;" download>Download Compressed File</a>
     </section>
    </section>
   </main>
  </div>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      lucide.createIcons();

      const input = document.getElementById("file-input");
      const uploadZone = document.getElementById("upload-zone");
      const slider = document.getElementById("reduction-slider");
      const reductionOutput = document.getElementById("reduction-output");
      const resultsPanel = document.getElementById("results-panel");
      const previewImage = document.getElementById("preview-image");
      const previewPlaceholder = document.getElementById("preview-placeholder");
      const fileName = document.getElementById("file-name");
      const fileType = document.getElementById("file-type");
      const originalSize = document.getElementById("original-size");
      const compressedSize = document.getElementById("compressed-size");
      const savedSize = document.getElementById("saved-size");
      const progressFill = document.getElementById("progress-fill");
      const processingStatus = document.getElementById("processing-status");
      const downloadButton = document.getElementById("download-button");
      const compressAgain = document.getElementById("compress-again");
      const themeToggle = document.getElementById("theme-toggle");

      let currentFile = null;

      function formatBytes(bytes) {
        if (!bytes) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return (bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2) + " " + units[index];
      }

      function updateSliderStyle() {
        const value = Number(slider.value);
        reductionOutput.textContent = value + "% Quality";
        slider.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${value}%, rgba(153, 168, 199, .26) ${value}%, rgba(153, 168, 199, .26) 100%)`;
      }

      function handleFile(file) {
        if (!file) return;
        currentFile = file;

        fileName.textContent = file.name;
        fileType.textContent = file.name.split('.').pop().toUpperCase();
        originalSize.textContent = formatBytes(file.size);
        compressedSize.textContent = "—";
        savedSize.textContent = "—";

        resultsPanel.classList.remove("hidden");
        progressFill.style.width = "10%";
        processingStatus.textContent = "Uploading file…";
        downloadButton.style.pointerEvents = "none";
        downloadButton.style.opacity = "0.5";
        compressAgain.disabled = false;

        if (file.type.startsWith("image/")) {
          previewImage.src = URL.createObjectURL(file);
          previewImage.style.display = "block";
          previewPlaceholder.style.display = "none";
        } else {
          previewImage.style.display = "none";
          previewPlaceholder.style.display = "flex";
        }

        processCompression(file);
      }

      function processCompression(file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("quality", slider.value);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/compress", true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 70);
            progressFill.style.width = percent + "%";
            processingStatus.textContent = "Processing: " + percent + "%";
          }
        };

        xhr.onload = function() {
          if (xhr.status === 200) {
            const res = JSON.parse(xhr.responseText);
            progressFill.style.width = "100%";
            processingStatus.textContent = "Compression Complete";

            compressedSize.textContent = formatBytes(res.compressedSize);
            const saved = Math.round(((res.originalSize - res.compressedSize) / res.originalSize) * 100);
            savedSize.textContent = (saved > 0 ? '-' : '+') + Math.abs(saved) + "%";

            downloadButton.href = res.downloadUrl;
            downloadButton.style.pointerEvents = "auto";
            downloadButton.style.opacity = "1";
          } else {
            processingStatus.textContent = "Compression failed.";
          }
        };

        xhr.send(formData);
      }

      uploadZone.addEventListener("click", () => input.click());
      input.addEventListener("change", (e) => handleFile(e.target.files[0]));

      ["dragenter", "dragover"].forEach(name => uploadZone.addEventListener(name, (e) => { e.preventDefault(); uploadZone.classList.add("drag-over"); }));
      ["dragleave", "drop"].forEach(name => uploadZone.addEventListener(name, (e) => { e.preventDefault(); uploadZone.classList.remove("drag-over"); }));
      uploadZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

      slider.addEventListener("input", updateSliderStyle);
      slider.addEventListener("change", () => { if (currentFile) processCompression(currentFile); });
      compressAgain.addEventListener("click", () => { if (currentFile) processCompression(currentFile); });

      themeToggle.addEventListener("click", () => {
        document.body.classList.toggle("light-mode");
      });

      updateSliderStyle();
    });
  </script>
 </body>
</html>`);
});

app.listen(PORT, () => console.log(`Server live at http://localhost:${PORT}`));

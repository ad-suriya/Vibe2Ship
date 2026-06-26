import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pages = [
  'popup',
  'task-capture',
  'focus-lock',
  'side-panel',
  'options',
  'new-tab',
  'devtools',
  'devtools-panel',
];

const rootDist = path.join(__dirname, 'dist');

for (const page of pages) {
  const src = path.join(__dirname, 'pages', page, 'dist');
  const dest = path.join(rootDist, page);

  if (fs.existsSync(src)) {
    console.log(`Copying ${page}...`);
    fs.copySync(src, dest, { overwrite: true });
  }
}

// Copy content scripts
const contentSrc = path.join(__dirname, 'dist', 'content');
if (fs.existsSync(contentSrc)) {
  console.log('Content scripts already in dist');
}

console.log('✅ All pages copied to dist/');

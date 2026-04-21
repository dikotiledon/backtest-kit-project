import fs from 'node:fs/promises';
import path from 'node:path';

const [, , inputArg = './pine/test.pine', outputArg = './pine/test.flattened.pine', libsDirArg = './pine/scripts'] = process.argv;
const cwd = process.cwd();
const inputPath = path.resolve(cwd, inputArg);
const outputPath = path.resolve(cwd, outputArg);
const libsDir = path.resolve(cwd, libsDirArg);

const source = await fs.readFile(inputPath, 'utf8');
const lines = source.split(/\r?\n/);

const importRegex = /^\s*import\s+([\w.-]+)\/([\w.-]+)\/\d+\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const imports = [];
const mainLines = [];

for (const line of lines) {
  const m = line.match(importRegex);
  if (m) {
    imports.push({ vendor: m[1], lib: m[2], alias: m[3] });
  } else {
    mainLines.push(line);
  }
}

if (imports.length === 0) {
  await fs.writeFile(outputPath, source, 'utf8');
  console.log(`No import lines found. Copied as-is to ${outputArg}`);
  process.exit(0);
}

const libBlocks = [];
for (const imp of imports) {
  const libPath = path.join(libsDir, `${imp.lib}.pine`);
  let libSource;
  try {
    libSource = await fs.readFile(libPath, 'utf8');
  } catch (e) {
    console.error(`Missing local library file for import ${imp.vendor}/${imp.lib}: ${libPath}`);
    process.exit(1);
  }

  const libLines = libSource.split(/\r?\n/);
  const cleaned = [];
  let cutExamples = false;

  for (let l of libLines) {
    if (/^\s*\/\/\s*Examples\s*:/i.test(l)) {
      cutExamples = true;
    }
    if (cutExamples) continue;

    if (/^\s*\/\/@version\s*=/.test(l)) continue;
    if (/^\s*library\s*\(/.test(l)) continue;

    l = l.replace(/^\s*export\s+/, '');
    cleaned.push(l);
  }

  libBlocks.push(`\n// ===== BEGIN inlined ${imp.vendor}/${imp.lib} as ${imp.alias} =====\n${cleaned.join('\n')}\n// ===== END inlined ${imp.vendor}/${imp.lib} =====\n`);
}

let mainSource = mainLines.join('\n');
for (const imp of imports) {
  const aliasRegex = new RegExp(`\\b${imp.alias}\\.`, 'g');
  mainSource = mainSource.replace(aliasRegex, '');
}

const out = `${libBlocks.join('\n')}\n${mainSource}`;
await fs.writeFile(outputPath, out, 'utf8');

console.log(`Flattened ${imports.length} import(s) -> ${outputArg}`);
for (const imp of imports) {
  console.log(`- ${imp.vendor}/${imp.lib} as ${imp.alias}`);
}

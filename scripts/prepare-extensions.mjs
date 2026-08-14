import pathUtil from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import {promisify} from 'node:util';
import zlib from 'node:zlib';

const outputDirectory = pathUtil.join(import.meta.dirname, '../dist-extensions/');
const potentiaOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-pot-extensions/');
const nitroOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-nb-extensions/');
const dashOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-dash-extensions/');
const mistOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-mw-extensions/');
const astraOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-astra-extensions/');
const ztEngineOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-ztengine-extensions/');
const bilupOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-bilup-extensions/');
const sharkOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-sp-extensions/');
const penguinOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-pm-extensions/');
const dinosaurOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-dm-extensions/');
const snailOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-sn-extensions/');
const arkOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-ark-extensions/');
const electraOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-em-extensions/');
const gaiaOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-gm-extensions/');
const otherOutputDirectory = pathUtil.join(import.meta.dirname, '../dist-other-extensions/');
const extBaseURL = (
  process.env.EXT_BASE_URL || 'https://potentiamod.github.io/extensions'
).replace(/\/+$/, '');
const brotliCompress = promisify(zlib.brotliCompress);
const turboWarpMetadataPath = 'data/metadata/tw-extensions.json';

const normalizeRelativePath = (relativePath) => {
  const normalized = String(relativePath).replace(/^\/+/, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(i => i === '..')) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }
  return parts.join('/');
};

const toRemoteURL = (baseURL, relativePath) => {
  const normalized = normalizeRelativePath(relativePath);
  const encodedPath = normalized
    .split('/')
    .map(i => encodeURIComponent(i))
    .join('/');
  return `${baseURL}/${encodedPath}`;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchRemoteFile = async (baseURL, relativePath, required = true) => {
  const url = toRemoteURL(baseURL, relativePath);
  const maxAttempts = 5;

  let lastError = null;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    let response = null;
    try {
      response = await fetch(url, {
        headers: {
          // Some hosts (e.g. Cloudflare/GitHub Pages) may return 503 for
          // requests that don't carry a browser-like User-Agent.
          'User-Agent': 'Mozilla/5.0 (compatible; Bilup/1.0)'
        }
      });
    } catch (error) {
      lastError = error;
    }

    if (response && response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    const status = response ? response.status : null;
    // Only transient failures are worth retrying: network errors,
    // 429 (rate limited) and 5xx (temporary server errors).
    const isTransient = !response || status === 429 || status >= 500;
    if (!isTransient || attemptNumber === maxAttempts) {
      if (required) {
        if (response) {
          throw new Error(`Failed to fetch ${url}: HTTP ${status}`);
        }
        throw lastError;
      }
      return null;
    }

    const waitMs = 500 * 2 ** (attemptNumber - 1) + Math.floor(Math.random() * 500);
    console.warn(
      `[fetch] ${url} ${response ? `returned HTTP ${status}` : 'failed to connect'}, ` +
      `retrying in ${waitMs}ms (attempt ${attemptNumber + 1}/${maxAttempts})`
    );
    await sleep(waitMs);
  }
};

const FetchExtFile = async (relativePath, required = true) =>
  fetchRemoteFile(extBaseURL, relativePath, required);

const createFetchLogPrefix = (libraryName, type, index = null, total = null) => {
  if (index === null) {
    return `[${libraryName} ${type}]`;
  }
  if (total === null) {
    return `[${libraryName} ${type} ${index}]`;
  }
  return `[${libraryName} ${type} ${index}/${total}]`;
};

const writeCompressed = async (root, relativePath, data) => {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const outputPath = pathUtil.join(root, `${normalizedRelativePath}.br`);
  await fsPromises.mkdir(pathUtil.dirname(outputPath), {recursive: true});
  const compressed = await brotliCompress(data);
  await fsPromises.writeFile(outputPath, compressed);
};

const writeRaw = async (root, relativePath, data) => {
  const normalized = normalizeRelativePath(relativePath);
  const outputPath = pathUtil.join(root, normalized);
  await fsPromises.mkdir(pathUtil.dirname(outputPath), {recursive: true});
  await fsPromises.writeFile(outputPath, data);
};

const extractLocalAssetPathsFromHTML = (html) => {
  const result = new Set();
  const matchAttribute = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = matchAttribute.exec(html)) !== null) {
    const value = match[1].trim();
    if (!value || value.startsWith('data:') || value.startsWith('#') || value.startsWith('mailto:')) {
      continue;
    }

    let relativePath = null;
    if (value.startsWith('/')) {
      relativePath = value.slice(1);
    } else if (value.startsWith(`${extBaseURL}/`)) {
      relativePath = value.slice(extBaseURL.length + 1);
    } else {
      continue;
    }

    relativePath = relativePath.split('#')[0].split('?')[0];
    if (!relativePath || relativePath.endsWith('/')) {
      continue;
    }
    result.add(normalizeRelativePath(relativePath));
  }
  return result;
};


//TurboWarp; Always goes first!
const buildTurboWarpOfflineFiles = async () => {
  console.log(`[TurboWarp] Preparing extension cache from ${extBaseURL}`);

  const tempDirectory = pathUtil.join(import.meta.dirname, '../dist-extensions-temp/');
  fs.rmSync(tempDirectory, {
    recursive: true,
    force: true
  });
  console.log('[TurboWarp] Created temporary output directory');

  console.log(
    `${createFetchLogPrefix('TurboWarp', 'required', 1, 1)} Fetching ${turboWarpMetadataPath}`
  );
  const metadataBuffer = await FetchExtFile(turboWarpMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[TurboWarp] Parsed metadata');

  const requiredFiles = new Set([turboWarpMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/turbowarp/${extension.slug}.js`);
	  if (extension.docs) {
        requiredFiles.add(`docs/turbowarp/${extension.slug}.html`);
      }
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/turbowarp/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/turbowarp/${sample}.sb3`);
        }
      }
    }
  }

  let requiredCount = 0;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;

  let requiredIndex = 0;
  for (const file of requiredFiles) {
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('TurboWarp', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    const data = await FetchExtFile(file, true);
    await writeCompressed(tempDirectory, file, data);
    requiredCount++;

    if (file.endsWith('.html')) {
      const html = data.toString('utf-8');
      for (const discoveredPath of extractLocalAssetPathsFromHTML(html)) {
        if (!requiredFiles.has(discoveredPath)) {
          optionalFiles.add(discoveredPath);
        }
      }
    }
  }

  const downloadedOptionalFiles = new Set();
  let optionalIndex = 0;
  while (optionalFiles.size > 0) {
    const iterator = optionalFiles.values().next();
    if (iterator.done) {
      break;
    }
    const file = iterator.value;
    optionalFiles.delete(file);

    if (requiredFiles.has(file) || downloadedOptionalFiles.has(file)) {
      continue;
    }

    optionalIndex++;
    console.log(`${createFetchLogPrefix('TurboWarp', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('TurboWarp', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }

    await writeCompressed(tempDirectory, file, data);
    downloadedOptionalFiles.add(file);
    optionalCount++;

    if (file.endsWith('.html')) {
      const html = data.toString('utf-8');
      for (const discoveredPath of extractLocalAssetPathsFromHTML(html)) {
        if (!requiredFiles.has(discoveredPath) && !downloadedOptionalFiles.has(discoveredPath)) {
          optionalFiles.add(discoveredPath);
        }
      }
    }
  }

  fs.rmSync(outputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempDirectory, outputDirectory);

  console.log(
    `Fetched TurboWarp extensions to ${outputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//PotentiaMod
const buildPotentiaOfflineFiles = async () => {
  console.log(`[Potentia] Preparing extension cache from ${extBaseURL}`);

  const tempPotentiaDirectory = pathUtil.join(import.meta.dirname, '../dist-pot-extensions-temp/');
  fs.rmSync(tempPotentiaDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Potentia] Created temporary output directory');

  const potentiaModMetadataPath = 'data/metadata/pot-extensions.json';
  console.log(`${createFetchLogPrefix('Potentia', 'required', 1, 1)} Fetching ${potentiaModMetadataPath}`);
  const metadataBuffer = await FetchExtFile(potentiaModMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Potentia] Parsed metadata');

  const requiredFiles = new Set([potentiaModMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/potentiamod/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/potentiamod/${extension.image}`);
    }
  }

  await writeCompressed(tempPotentiaDirectory, potentiaModMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === potentiaModMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Potentia', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempPotentiaDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Potentia', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Potentia', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Potentia', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempPotentiaDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(potentiaOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempPotentiaDirectory, potentiaOutputDirectory);

  console.log(
    `Fetched Potentia extensions to ${potentiaOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//NitroBolt
const buildNitroOfflineFiles = async () => {
  console.log(`[Nitro] Preparing extension cache from ${extBaseURL}`);

  const tempNitroDirectory = pathUtil.join(import.meta.dirname, '../dist-nb-extensions-temp/');
  fs.rmSync(tempNitroDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Nitro] Created temporary output directory');

  const nitroBoltMetadataPath = 'data/metadata/nb-extensions.json';
  console.log(`${createFetchLogPrefix('Nitro', 'required', 1, 1)} Fetching ${nitroBoltMetadataPath}`);
  const metadataBuffer = await FetchExtFile(nitroBoltMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Nitro] Parsed metadata');

  const requiredFiles = new Set([nitroBoltMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/nitrobolt/${extension.slug}.js`);
	  if (extension.docs) {
        requiredFiles.add(`docs/nitrobolt/${extension.slug}.html`);
      }
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/nitrobolt/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/nitrobolt/${sample}.sb3`);
        }
      }
    }
  }

  await writeCompressed(tempNitroDirectory, nitroBoltMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === nitroBoltMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Nitro', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempNitroDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Nitro', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Nitro', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Nitro', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempNitroDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(nitroOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempNitroDirectory, nitroOutputDirectory);

  console.log(
    `Fetched Nitro extensions to ${nitroOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Dash
const buildDashOfflineFiles = async () => {
  console.log(`[Dash] Preparing extension cache from ${extBaseURL}`);

  const tempDashDirectory = pathUtil.join(import.meta.dirname, '../dist-dash-extensions-temp/');
  fs.rmSync(tempDashDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Dash] Created temporary output directory');

  const dashMetadataPath = 'data/metadata/dash-extensions.json';
  console.log(`${createFetchLogPrefix('Dash', 'required', 1, 1)} Fetching ${dashMetadataPath}`);
  const metadataBuffer = await FetchExtFile(dashMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Dash] Parsed metadata');

  const requiredFiles = new Set([dashMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/dash/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/dash/${extension.image}`);
    }
  }

  await writeCompressed(tempDashDirectory, dashMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === dashMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Dash', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempDashDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Dash', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Dash', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Dash', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempDashDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(dashOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempDashDirectory, dashOutputDirectory);

  console.log(
    `Fetched Dash extensions to ${dashOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Mistium
const buildMistiumOfflineFiles = async () => {
  console.log(`[Mistium] Preparing extension cache from ${extBaseURL}`);

  const tempMistDirectory = pathUtil.join(import.meta.dirname, '../dist-mw-extensions-temp/');
  fs.rmSync(tempMistDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Mistium] Created temporary output directory');

  const mistiumMetadataPath = 'data/metadata/mist-extensions.json';
  console.log(`${createFetchLogPrefix('Mistium', 'required', 1, 1)} Fetching ${mistiumMetadataPath}`);
  const metadataBuffer = await FetchExtFile(mistiumMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Mistium] Parsed metadata');

  const requiredFiles = new Set([mistiumMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/mistium/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/mistium/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/mistium/${sample}.sb3`);
        }
      }
    }
  }

  await writeCompressed(tempMistDirectory, mistiumMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === mistiumMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Mistium', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempMistDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Mistium', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Mistium', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Mistium', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempMistDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(mistOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempMistDirectory, mistOutputDirectory);

  console.log(
    `Fetched Mistium extensions to ${mistOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//AstraEditor
const buildAstraOfflineFiles = async () => {
  console.log(`[Astra] Preparing extension cache from ${extBaseURL}`);

  const tempAstraDirectory = pathUtil.join(import.meta.dirname, '../dist-ae-extensions-temp/');
  fs.rmSync(tempAstraDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Astra] Created temporary output directory');

  const metadataPath = 'data/metadata/ae-extensions.json';
  console.log(`${createFetchLogPrefix('Astra', 'required', 1, 1)} Fetching ${metadataPath}`);
  const metadataBuffer = await FetchExtFile(metadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Astra] Parsed metadata');

  const requiredFiles = new Set([metadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/astraeditor/${extension.slug}.js`);
	  if (extension.docs) {
        requiredFiles.add(`docs/astraeditor/${extension.slug}.html`);
      }
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/astraeditor/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/astraeditor/${sample}.sb3`);
        }
      }
    }
  }

  await writeCompressed(tempAstraDirectory, metadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === metadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Astra', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempAstraDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Astra', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Astra', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Astra', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempAstraDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(astraOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempAstraDirectory, astraOutputDirectory);

  console.log(
    `Fetched Astra extensions to ${astraOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//02Engine
const buildZTEngineOfflineFiles = async () => {
  console.log(`[02Engine] Preparing extension cache from ${extBaseURL}`);

  const tempztEngineDirectory = pathUtil.join(import.meta.dirname, '../dist-ztengine-extensions-temp/');
  fs.rmSync(tempztEngineDirectory, {
    recursive: true,
    force: true
  });
  console.log('[02Engine] Created temporary output directory');

  const zeroTwoEngineMetadataPath = 'data/metadata/ztengine-extensions.json';
  console.log(`${createFetchLogPrefix('02Engine', 'required', 1, 1)} Fetching ${zeroTwoEngineMetadataPath}`);
  const metadataBuffer = await FetchExtFile(zeroTwoEngineMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[02Engine] Parsed metadata');

  const requiredFiles = new Set([zeroTwoEngineMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/zerotwoengine/${extension.slug}.js`);
	  if (extension.docs) {
        requiredFiles.add(`docs/zerotwoengine/${extension.slug}.html`);
      }
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/zerotwoengine/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/zerotwoengine/${sample}.sb3`);
        }
      }
    }
  }

  await writeCompressed(tempztEngineDirectory, zeroTwoEngineMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === zeroTwoEngineMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('02Engine', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempztEngineDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('02Engine', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('02Engine', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('02Engine', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempztEngineDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(ztEngineOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempztEngineDirectory, ztEngineOutputDirectory);

  console.log(
    `Fetched 02Engine extensions to ${ztEngineOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Bilup
const buildBilupOfflineFiles = async () => {
  console.log(`[Bilup] Preparing extension cache from ${extBaseURL}`);

  const tempBilupDirectory = pathUtil.join(import.meta.dirname, '../dist-bilup-extensions-temp/');
  fs.rmSync(tempBilupDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Bilup] Created temporary output directory');

  const bilupMetadataPath = 'data/metadata/bilup-extensions.json';
  console.log(`${createFetchLogPrefix('Bilup', 'required', 1, 1)} Fetching ${bilupMetadataPath}`);
  const metadataBuffer = await FetchExtFile(bilupMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Bilup] Parsed metadata');

  const requiredFiles = new Set([bilupMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/bilup/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/bilup/${extension.image}`);
    }
  }

  await writeCompressed(tempBilupDirectory, bilupMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === bilupMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Bilup', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempBilupDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Bilup', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Bilup', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Bilup', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempBilupDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(bilupOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempBilupDirectory, bilupOutputDirectory);

  console.log(
    `Fetched Bilup extensions to ${bilupOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//SharkPool
const buildSharkOfflineFiles = async () => {
  console.log(`[Shark] Preparing extension cache from ${extBaseURL}`);

  const tempSharkDirectory = pathUtil.join(import.meta.dirname, '../dist-sp-extensions-temp/');
  fs.rmSync(tempSharkDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Shark] Created temporary output directory');

  const sharkPoolMetadataPath = 'data/metadata/sp-extensions.json';
  console.log(`${createFetchLogPrefix('Shark', 'required', 1, 1)} Fetching ${sharkPoolMetadataPath}`);
  const metadataBuffer = await FetchExtFile(sharkPoolMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Shark] Parsed metadata');

  const requiredFiles = new Set([sharkPoolMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/sharkpool/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/sharkpool/${extension.image}`);
    }
  }

  await writeCompressed(tempSharkDirectory, sharkPoolMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === sharkPoolMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Shark', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempSharkDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Shark', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Shark', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Shark', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempSharkDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(sharkOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempSharkDirectory, sharkOutputDirectory);

  console.log(
    `Fetched Shark extensions to ${sharkOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//PenguinMod
const buildPenguinOfflineFiles = async () => {
  console.log(`[Penguin] Preparing extension cache from ${extBaseURL}`);

  const tempPenguinDirectory = pathUtil.join(import.meta.dirname, '../dist-pm-extensions-temp/');
  fs.rmSync(tempPenguinDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Penguin] Created temporary output directory');

  const penguinModMetadataPath = 'data/metadata/pm-extensions.json';
  console.log(`${createFetchLogPrefix('Penguin', 'required', 1, 1)} Fetching ${penguinModMetadataPath}`);
  const metadataBuffer = await FetchExtFile(penguinModMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Penguin] Parsed metadata');

  const requiredFiles = new Set([penguinModMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/penguinmod/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/penguinmod/${extension.image}`);
    }
    if (Array.isArray(extension.samples)) {
      for (const sample of extension.samples) {
        if (typeof sample === 'string' && sample) {
          requiredFiles.add(`samples/penguinmod/${sample}.sb3`);
        }
      }
    }
  }

  await writeCompressed(tempPenguinDirectory, penguinModMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === penguinModMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Penguin', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempPenguinDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Penguin', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Penguin', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Penguin', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempPenguinDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(penguinOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempPenguinDirectory, penguinOutputDirectory);

  console.log(
    `Fetched Penguin extensions to ${penguinOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Ark IDE
const buildArkOfflineFiles = async () => {
  console.log(`[Ark] Preparing extension cache from ${extBaseURL}`);

  const tempArkDirectory = pathUtil.join(import.meta.dirname, '../dist-ark-extensions-temp/');
  fs.rmSync(tempArkDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Ark] Created temporary output directory');

  const arkIDEMetadataPath = 'data/metadata/ark-extensions.json';
  console.log(`${createFetchLogPrefix('Ark', 'required', 1, 1)} Fetching ${arkIDEMetadataPath}`);
  const metadataBuffer = await FetchExtFile(arkIDEMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Ark] Parsed metadata');

  const requiredFiles = new Set([arkIDEMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/arkide/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/arkide/${extension.image}`);
    }
  }

  await writeCompressed(tempArkDirectory, arkIDEMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === arkIDEMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Ark', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempArkDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Ark', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Ark', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Ark', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempArkDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(arkOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempArkDirectory, arkOutputDirectory);

  console.log(
    `Fetched Ark extensions to ${arkOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//DinosaurMod
const buildDinosaurOfflineFiles = async () => {
  console.log(`[Dinosaur] Preparing extension cache from ${extBaseURL}`);

  const tempDinosaurDirectory = pathUtil.join(import.meta.dirname, '../dist-dm-extensions-temp/');
  fs.rmSync(tempDinosaurDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Dinosaur] Created temporary output directory');

  const dinosaurModMetadataPath = 'data/metadata/dm-extensions.json';
  console.log(`${createFetchLogPrefix('Dinosaur', 'required', 1, 1)} Fetching ${dinosaurModMetadataPath}`);
  const metadataBuffer = await FetchExtFile(dinosaurModMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Dinosaur] Parsed metadata');

  const requiredFiles = new Set([dinosaurModMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/dinosaurmod/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/dinosaurmod/${extension.image}`);
    }
  }

  await writeCompressed(tempDinosaurDirectory, dinosaurModMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === dinosaurModMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Dinosaur', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempDinosaurDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Dinosaur', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Dinosaur', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Dinosaur', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempDinosaurDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(dinosaurOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempDinosaurDirectory, dinosaurOutputDirectory);

  console.log(
    `Fetched Dinosaur extensions to ${dinosaurOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Snail IDE
const buildSnailOfflineFiles = async () => {
  console.log(`[Snail] Preparing extension cache from ${extBaseURL}`);

  const tempSnailDirectory = pathUtil.join(import.meta.dirname, '../dist-sn-extensions-temp/');
  fs.rmSync(tempSnailDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Snail] Created temporary output directory');

  const snailIDEMetadataPath = 'data/metadata/sn-extensions.json';
  console.log(`${createFetchLogPrefix('Snail', 'required', 1, 1)} Fetching ${snailIDEMetadataPath}`);
  const metadataBuffer = await FetchExtFile(snailIDEMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Snail] Parsed metadata');

  const requiredFiles = new Set([snailIDEMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/snailide/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/snailide/${extension.image}`);
    }
  }

  await writeCompressed(tempSnailDirectory, snailIDEMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === snailIDEMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Snail', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempSnailDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Snail', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Snail', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Snail', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempSnailDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(snailOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempSnailDirectory, snailOutputDirectory);

  console.log(
    `Fetched Snail extensions to ${snailOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//ElectraMod
const buildElectraOfflineFiles = async () => {
  console.log(`[Electra] Preparing extension cache from ${extBaseURL}`);

  const tempElectraDirectory = pathUtil.join(import.meta.dirname, '../dist-em-extensions-temp/');
  fs.rmSync(tempElectraDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Electra] Created temporary output directory');

  const electraModMetadataPath = 'data/metadata/em-extensions.json';
  console.log(`${createFetchLogPrefix('Electra', 'required', 1, 1)} Fetching ${electraModMetadataPath}`);
  const metadataBuffer = await FetchExtFile(electraModMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Electra] Parsed metadata');

  const requiredFiles = new Set([electraModMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/electramod/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/electramod/${extension.image}`);
    }
  }

  await writeCompressed(tempElectraDirectory, electraModMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === electraModMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Electra', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempElectraDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Electra', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Electra', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Electra', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempElectraDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(electraOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempElectraDirectory, electraOutputDirectory);

  console.log(
    `Fetched Electra extensions to ${electraOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//GaiaMod
const buildGaiaOfflineFiles = async () => {
  console.log(`[Gaia] Preparing extension cache from ${extBaseURL}`);

  const tempGaiaDirectory = pathUtil.join(import.meta.dirname, '../dist-gm-extensions-temp/');
  fs.rmSync(tempGaiaDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Gaia] Created temporary output directory');

  const gaiaModMetadataPath = 'data/metadata/gm-extensions.json';
  console.log(`${createFetchLogPrefix('Gaia', 'required', 1, 1)} Fetching ${gaiaModMetadataPath}`);
  const metadataBuffer = await FetchExtFile(gaiaModMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Gaia] Parsed metadata');

  const requiredFiles = new Set([gaiaModMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/gaiamod/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/gaiamod/${extension.image}`);
    }
  }

  await writeCompressed(tempGaiaDirectory, gaiaModMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === gaiaModMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Gaia', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempGaiaDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Gaia', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Gaia', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Gaia', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempGaiaDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(gaiaOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempGaiaDirectory, gaiaOutputDirectory);

  console.log(
    `Fetched Gaia extensions to ${gaiaOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

//Other Extensions (AcidMod, BananaMod, etc.)
const buildOtherOfflineFiles = async () => {
  console.log(`[Other] Preparing extension cache from ${extBaseURL}`);

  const tempOtherDirectory = pathUtil.join(import.meta.dirname, '../dist-other-extensions-temp/');
  fs.rmSync(tempOtherDirectory, {
    recursive: true,
    force: true
  });
  console.log('[Other] Created temporary output directory');

  const otherMetadataPath = 'data/metadata/other-extensions.json';
  console.log(`${createFetchLogPrefix('Other', 'required', 1, 1)} Fetching ${otherMetadataPath}`);
  const metadataBuffer = await FetchExtFile(otherMetadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[Other] Parsed metadata');

  const requiredFiles = new Set([otherMetadataPath]);
  const optionalFiles = new Set([
    'index.html'
  ]);

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      requiredFiles.add(`extensions/other/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      requiredFiles.add(`img/other/${extension.image}`);
    }
  }

  await writeCompressed(tempOtherDirectory, otherMetadataPath, metadataBuffer);

  let requiredCount = 1;
  let optionalCount = 0;
  const requiredTotal = requiredFiles.size;
  let requiredIndex = 1;
  for (const file of requiredFiles) {
    if (file === otherMetadataPath) {
      continue;
    }
    requiredIndex++;
    console.log(
      `${createFetchLogPrefix('Other', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await FetchExtFile(file, true);
      await writeCompressed(tempOtherDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('Other', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('Other', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await FetchExtFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('Other', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempOtherDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(otherOutputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempOtherDirectory, otherOutputDirectory);

  console.log(
    `Fetched Other extensions to ${otherOutputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};


try {
  await buildTurboWarpOfflineFiles();
  await buildPotentiaOfflineFiles();
  await buildAstraOfflineFiles();
  await buildNitroOfflineFiles();
  await buildDashOfflineFiles();
  await buildMistiumOfflineFiles();
  await buildZTEngineOfflineFiles();
  await buildBilupOfflineFiles();
  await buildSharkOfflineFiles();
  await buildPenguinOfflineFiles();
  await buildArkOfflineFiles();
  await buildDinosaurOfflineFiles();
  await buildSnailOfflineFiles();
  await buildElectraOfflineFiles();
  await buildGaiaOfflineFiles();
  await buildOtherOfflineFiles();
} catch (error) {
  console.error(error);
  process.exit(1);
}
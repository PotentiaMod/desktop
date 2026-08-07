import pathUtil from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import {promisify} from 'node:util';
import zlib from 'node:zlib';

const outputDirectory = pathUtil.join(import.meta.dirname, '../dist-pot-extensions/');
const potExtensionsBaseURL = (
  process.env.POT_EXTENSIONS_BASE_URL || 'https://potentiamod.github.io/extensions'
).replace(/\/+$/, '');

const brotliCompress = promisify(zlib.brotliCompress);

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

const fetchRemoteFile = async (baseURL, relativePath, required = true) => {
  const url = toRemoteURL(baseURL, relativePath);
  const reaeonse = await fetch(url);
  if (!reaeonse.ok) {
    if (required) {
      throw new Error(`Failed to fetch ${url}: HTTP ${reaeonse.status}`);
    }
    return null;
  }
  return Buffer.from(await reaeonse.arrayBuffer());
};

const fetchAEFile = async (relativePath, required = true) =>
  fetchRemoteFile(potExtensionsBaseURL, relativePath, required);

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
    } else if (value.startsWith(`${potExtensionsBaseURL}/`)) {
      relativePath = value.slice(potExtensionsBaseURL.length + 1);
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

const buildPOTOfflineFiles = async () => {
  console.log(`[PotentiaMod] Preparing extension cache from ${potExtensionsBaseURL}`);

  const tempDirectory = pathUtil.join(import.meta.dirname, '../dist-pot-extensions-temp/');
  fs.rmSync(tempDirectory, {
    recursive: true,
    force: true
  });
  console.log('[PotentiaMod] Created temporary output directory');

  const metadataPath = 'data/metadata/pot-extensions.json';
  console.log(`${createFetchLogPrefix('PotentiaMod', 'required', 1, 1)} Fetching ${metadataPath}`);
  const metadataBuffer = await fetchAEFile(metadataPath, true);
  const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
  console.log('[PotentiaMod] Parsed metadata');

  const requiredFiles = new Set([metadataPath]);
   const optionalFiles = new Set();

  for (const extension of metadata.extensions || []) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }
    if (typeof extension.slug === 'string' && extension.slug) {
      const directory = 'extensions/potentiamod';
      requiredFiles.add(`${directory}/${extension.slug}.js`);
    }
    if (typeof extension.image === 'string' && extension.image) {
      const imgdirectory = 'img/potentiamod';
      requiredFiles.add(`${imgdirectory}/${extension.image}`);
    }
  }

  await writeCompressed(tempDirectory, metadataPath, metadataBuffer);

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
      `${createFetchLogPrefix('PotentiaMod', 'required', requiredIndex, requiredTotal)} Fetching ${file}`
    );
    try {
      const data = await fetchAEFile(file, true);
      await writeCompressed(tempDirectory, file, data);
      requiredCount++;
    } catch (error) {
      console.warn(`${createFetchLogPrefix('PotentiaMod', 'required', requiredIndex, requiredTotal)} Failed to fetch ${file}:`, error.message);
    }
  }

  let optionalIndex = 0;
  for (const file of optionalFiles) {
    optionalIndex++;
    console.log(`${createFetchLogPrefix('PotentiaMod', 'optional', optionalIndex)} Fetching ${file}`);
    const data = await fetchAEFile(file, false);
    if (!data) {
      console.log(`${createFetchLogPrefix('PotentiaMod', 'optional', optionalIndex)} Missing ${file}`);
      continue;
    }
    await writeCompressed(tempDirectory, file, data);
    optionalCount++;
  }

  fs.rmSync(outputDirectory, {
    recursive: true,
    force: true
  });
  fs.renameSync(tempDirectory, outputDirectory);

  console.log(
    `Fetched PotentiaMod extensions to ${outputDirectory} (required: ${requiredCount}, optional: ${optionalCount})`
  );
};

try {
  await buildPOTOfflineFiles();
} catch (error) {
  console.error(error);
  process.exit(1);
}
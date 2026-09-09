#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..', '..');
const publicRoot = path.join(projectRoot, 'public');
const siteOrigin = 'https://daftuyda.moe';
const minimumSocialImageBytes = 10 * 1024;
const failures = [];
const warnings = [];
const socialImageEndpointTargets = new Set();
const staticSocialImagePaths = new Set();
const socialImageOwners = new Map();

function walkHtml(directory = publicRoot) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(fullPath);
    return entry.isFile() && entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

function routeForHtml(filePath) {
  const relative = path.relative(publicRoot, filePath).replaceAll(path.sep, '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'/index.html'.length)}`;
  return `/${relative.slice(0, -'.html'.length)}`;
}

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}=["']([^"']*)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function findTags(html, tagName, attributeName, attributeValue) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))]
    .map((match) => match[0])
    .filter(
      (tag) => getAttribute(tag, attributeName).toLowerCase() === attributeValue.toLowerCase()
    );
}

function findTag(html, tagName, attributeName, attributeValue) {
  return findTags(html, tagName, attributeName, attributeValue)[0];
}

function metaContent(html, key, value) {
  const tag = findTag(html, 'meta', key, value);
  return tag ? getAttribute(tag, 'content') : '';
}

function canonicalFrom(html) {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((candidate) =>
      getAttribute(candidate, 'rel').toLowerCase().split(/\s+/).includes('canonical')
    );
  return tag ? getAttribute(tag, 'href') : '';
}

function textContent(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSiteUrl(value, baseUrl = siteOrigin) {
  try {
    const url = new URL(value, baseUrl);
    if (url.origin !== siteOrigin) return null;
    let pathname = url.pathname.replace(/\.html$/i, '');
    if (pathname !== '/') pathname = pathname.replace(/\/+$/, '');
    return `${siteOrigin}${pathname || '/'}`;
  } catch {
    return null;
  }
}

function addUnique(map, value, label, file) {
  if (!value) return;
  if (map.has(value)) {
    failures.push(`${file} -> duplicate ${label} also used by ${map.get(value)}`);
  } else {
    map.set(value, file);
  }
}

function validateSocialImageUrl(file, label, value) {
  if (!value) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${file} -> ${label} must be a valid absolute URL, found ${value}`);
    return;
  }

  if (url.protocol !== 'https:' || url.origin !== siteOrigin || url.username || url.password) {
    failures.push(`${file} -> ${label} must use an absolute first-party HTTPS URL, found ${value}`);
    return;
  }
  if (url.hash) failures.push(`${file} -> ${label} must not include a fragment`);

  if (url.pathname === '/api/og') {
    const parameterNames = [...new Set(url.searchParams.keys())];
    const pageValues = url.searchParams.getAll('page');
    if (
      parameterNames.length !== 1 ||
      parameterNames[0] !== 'page' ||
      pageValues.length !== 1 ||
      !/^[a-z0-9-]+$/.test(pageValues[0])
    ) {
      failures.push(`${file} -> ${label} must use /api/og with one valid page parameter`);
      return;
    }
    socialImageEndpointTargets.add(`${url.pathname}?page=${encodeURIComponent(pageValues[0])}`);
    return;
  }

  const directEndpoint = url.pathname.match(/^\/api\/og\/(?:v1\/)?([a-z0-9-]+)\.png$/);
  if (directEndpoint) {
    if (url.search) {
      failures.push(`${file} -> ${label} direct PNG endpoint must not include query parameters`);
      return;
    }
    socialImageEndpointTargets.add(url.pathname);
    return;
  }

  if (url.pathname.startsWith('/assets/') && url.pathname.toLowerCase().endsWith('.png')) {
    if (url.search)
      failures.push(`${file} -> ${label} static PNG must not include query parameters`);
    const resolved = path.resolve(publicRoot, url.pathname.replace(/^\/+/, ''));
    const publicPrefix = `${path.resolve(publicRoot)}${path.sep}`;
    if (!resolved.startsWith(publicPrefix)) {
      failures.push(`${file} -> ${label} resolves outside public/`);
      return;
    }
    staticSocialImagePaths.add(resolved);
    return;
  }

  failures.push(
    `${file} -> ${label} must use /api/og?page=..., a supported /api/og PNG path, ` +
      `or a local PNG in /assets/`
  );
}

function inspectPngBuffer(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function validateStaticSocialImages() {
  for (const imagePath of staticSocialImagePaths) {
    const relative = path.relative(projectRoot, imagePath).replaceAll(path.sep, '/');
    if (!fs.existsSync(imagePath)) {
      failures.push(`${relative} -> social image does not exist`);
      continue;
    }
    const image = fs.readFileSync(imagePath);
    const metadata = inspectPngBuffer(image);
    if (!metadata) {
      failures.push(`${relative} -> social image is not a valid PNG`);
      continue;
    }
    if (image.length < minimumSocialImageBytes) {
      failures.push(
        `${relative} -> social image is too small to be nontrivial (${image.length} bytes)`
      );
    }
    if (metadata.width !== 1200 || metadata.height !== 630) {
      failures.push(
        `${relative} -> social image must be 1200x630, found ${metadata.width}x${metadata.height}`
      );
    }
  }
}

function validateDynamicSocialImages() {
  const targets = [...socialImageEndpointTargets].sort();
  if (!targets.length) return;

  const probeSource = String.raw`
import json
import runpy
import sys
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

namespace = runpy.run_path(sys.argv[1])
results = []
with TestClient(namespace["app"]) as client:
    for target in sys.argv[2:]:
        record = {"target": target}
        try:
            response = client.get(target)
            content = response.content
            head = client.head(target)
            record.update({
                "status": response.status_code,
                "content_type": response.headers.get("content-type", ""),
                "bytes": len(content),
                "signature": content[:8].hex(),
                "head_status": head.status_code,
                "head_content_type": head.headers.get("content-type", ""),
                "head_content_length": head.headers.get("content-length", ""),
            })
            with Image.open(BytesIO(content)) as image:
                image.verify()
            with Image.open(BytesIO(content)) as image:
                rgb = image.convert("RGB")
                record.update({
                    "format": image.format,
                    "width": image.width,
                    "height": image.height,
                    "channel_spread": max(high - low for low, high in rgb.getextrema()),
                })
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        results.append(record)
print(json.dumps(results, separators=(",", ":")))
`;
  const endpointPath = path.join(projectRoot, 'api', '[...path].py');
  const probe = spawnSync(
    process.env.PYTHON || 'python',
    ['-c', probeSource, endpointPath, ...targets],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (probe.error) {
    failures.push(`social image endpoint probe could not start (${probe.error.message})`);
    return;
  }
  if (probe.status !== 0) {
    failures.push(
      `social image endpoint probe failed with exit ${probe.status}: ${probe.stderr.trim() || 'no error output'}`
    );
    return;
  }

  let records;
  try {
    records = JSON.parse(probe.stdout.trim());
  } catch (error) {
    failures.push(`social image endpoint probe returned invalid JSON (${error.message})`);
    return;
  }
  if (!Array.isArray(records) || records.length !== targets.length) {
    failures.push(
      `social image endpoint probe returned ${Array.isArray(records) ? records.length : 'invalid'} ` +
        `records for ${targets.length} targets`
    );
    return;
  }

  for (const record of records) {
    const label = record.target || 'unknown social image target';
    if (record.error) {
      failures.push(`${label} -> local endpoint did not return a readable PNG (${record.error})`);
      continue;
    }
    if (record.status !== 200)
      failures.push(`${label} -> local endpoint returned HTTP ${record.status}`);
    if (!String(record.content_type).toLowerCase().startsWith('image/png')) {
      failures.push(
        `${label} -> local endpoint returned ${record.content_type || 'no content type'}`
      );
    }
    if (record.head_status !== 200) {
      failures.push(`${label} -> local endpoint HEAD returned HTTP ${record.head_status}`);
    }
    if (!String(record.head_content_type).toLowerCase().startsWith('image/png')) {
      failures.push(
        `${label} -> local endpoint HEAD returned ${record.head_content_type || 'no content type'}`
      );
    }
    if (Number(record.head_content_length) !== record.bytes) {
      failures.push(
        `${label} -> local endpoint HEAD content-length ${record.head_content_length || 'missing'} ` +
          `does not match GET body (${record.bytes} bytes)`
      );
    }
    if (record.signature !== '89504e470d0a1a0a' || record.format !== 'PNG') {
      failures.push(`${label} -> local endpoint response is not a valid PNG`);
    }
    if (record.bytes < minimumSocialImageBytes || record.channel_spread < 16) {
      failures.push(
        `${label} -> local endpoint PNG is trivial ` +
          `(${record.bytes} bytes, channel spread ${record.channel_spread})`
      );
    }
    if (record.width !== 1200 || record.height !== 630) {
      failures.push(
        `${label} -> local endpoint PNG must be 1200x630, found ${record.width}x${record.height}`
      );
    }
  }
}

const titleOwners = new Map();
const descriptionOwners = new Map();
const canonicalOwners = new Map();
const pages = [];

function expectedSocialImageForRoute(route) {
  if (route === '/optimizer') return `${siteOrigin}/assets/og-default.png`;
  if (route === '/') return `${siteOrigin}/api/og/v1/home.png`;
  if (route === '/404') return `${siteOrigin}/api/og/v1/not-found.png`;
  if (route === '/rank-breakdown') return `${siteOrigin}/api/og/v1/rank.png`;
  if (route.startsWith('/guides/')) {
    return `${siteOrigin}/api/og/v1/guide-${route.slice('/guides/'.length)}.png`;
  }
  return `${siteOrigin}/api/og/v1/${route.slice(1)}.png`;
}

for (const filePath of walkHtml()) {
  const file = path.relative(projectRoot, filePath).replaceAll(path.sep, '/');
  const route = routeForHtml(filePath);
  const expectedCanonical = `${siteOrigin}${route}`;
  const html = fs.readFileSync(filePath, 'utf8');
  const title =
    html
      .match(/<title>([\s\S]*?)<\/title>/i)?.[1]
      .replace(/\s+/g, ' ')
      .trim() || '';
  const description = metaContent(html, 'name', 'description');
  const robots = metaContent(html, 'name', 'robots').toLowerCase();
  const canonical = canonicalFrom(html);
  const indexable = !robots.split(/[,\s]+/).includes('noindex');

  if (indexable) {
    pages.push({ file, route, canonical, html });
    if (!title) failures.push(`${file} -> title is empty`);
    if (!description) failures.push(`${file} -> meta description is empty`);
    if (canonical !== expectedCanonical) {
      failures.push(
        `${file} -> canonical must be ${expectedCanonical}, found ${canonical || 'none'}`
      );
    }
    addUnique(titleOwners, title.toLowerCase(), 'title', file);
    addUnique(descriptionOwners, description.toLowerCase(), 'description', file);
    addUnique(canonicalOwners, canonical, 'canonical URL', file);
  }

  const socialFields = [
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['property', 'og:url'],
    ['property', 'og:image'],
    ['property', 'og:image:type'],
    ['property', 'og:image:width'],
    ['property', 'og:image:height'],
    ['property', 'og:image:alt'],
    ['property', 'og:site_name'],
    ['name', 'twitter:card'],
    ['name', 'twitter:title'],
    ['name', 'twitter:description'],
    ['name', 'twitter:image'],
    ['name', 'twitter:image:alt'],
  ];
  for (const [key, value] of socialFields) {
    const tags = findTags(html, 'meta', key, value);
    if (!tags.length) failures.push(`${file} -> missing ${value}`);
    if (tags.length > 1) failures.push(`${file} -> duplicate ${value} metadata`);
  }
  const ogUrl = metaContent(html, 'property', 'og:url');
  if (ogUrl && ogUrl !== canonical) failures.push(`${file} -> og:url must match canonical URL`);
  const ogImage = metaContent(html, 'property', 'og:image');
  const twitterImage = metaContent(html, 'name', 'twitter:image');
  const alignedMetadata = [
    ['og:title', metaContent(html, 'property', 'og:title'), title],
    ['og:description', metaContent(html, 'property', 'og:description'), description],
    ['twitter:title', metaContent(html, 'name', 'twitter:title'), title],
    ['twitter:description', metaContent(html, 'name', 'twitter:description'), description],
    ['og:image:alt', metaContent(html, 'property', 'og:image:alt'), title],
    ['twitter:image:alt', metaContent(html, 'name', 'twitter:image:alt'), title],
    ['twitter:image', twitterImage, ogImage],
    ['twitter:card', metaContent(html, 'name', 'twitter:card'), 'summary_large_image'],
  ];
  for (const [label, actual, expected] of alignedMetadata) {
    if (actual && expected && actual !== expected) {
      failures.push(`${file} -> ${label} does not match the primary page metadata`);
    }
  }
  const expectedSocialImage = expectedSocialImageForRoute(route);
  if (ogImage && ogImage !== expectedSocialImage) {
    failures.push(`${file} -> og:image must be ${expectedSocialImage}, found ${ogImage}`);
  }
  if (twitterImage && twitterImage !== expectedSocialImage) {
    failures.push(`${file} -> twitter:image must be ${expectedSocialImage}, found ${twitterImage}`);
  }
  validateSocialImageUrl(file, 'og:image', ogImage);
  validateSocialImageUrl(file, 'twitter:image', twitterImage);
  addUnique(socialImageOwners, ogImage, 'dedicated social image URL', file);

  const expectedImageMetadata = [
    ['og:image:type', 'image/png'],
    ['og:image:width', '1200'],
    ['og:image:height', '630'],
  ];
  for (const [label, expected] of expectedImageMetadata) {
    const actual = metaContent(html, 'property', label);
    if (actual && actual !== expected) {
      failures.push(`${file} -> ${label} must be ${expected}, found ${actual}`);
    }
  }

  if (!indexable) continue;

  const jsonLdBlocks = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];
  if (!jsonLdBlocks.length) failures.push(`${file} -> missing JSON-LD structured data`);
  let hasPageEntity = false;
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const entities = Array.isArray(data)
        ? data
        : Array.isArray(data['@graph'])
          ? data['@graph']
          : [data];
      hasPageEntity ||= entities.some((entity) => {
        const types = Array.isArray(entity?.['@type']) ? entity['@type'] : [entity?.['@type']];
        return types.some((type) =>
          [
            'Article',
            'CollectionPage',
            'HowTo',
            'TechArticle',
            'WebApplication',
            'WebPage',
          ].includes(type)
        );
      });
    } catch (error) {
      failures.push(`${file} -> invalid JSON-LD (${error.message})`);
    }
  }
  if (jsonLdBlocks.length && !hasPageEntity) {
    failures.push(`${file} -> JSON-LD has no page-level entity`);
  }

  const words = textContent(html).split(/\s+/).filter(Boolean).length;
  if (words < 50) warnings.push(`${file} -> only ${words} words of static crawlable copy`);
  if (title.length < 30 || title.length > 70) {
    warnings.push(`${file} -> title length is ${title.length} characters`);
  }
  if (description.length < 80 || description.length > 170) {
    warnings.push(`${file} -> description length is ${description.length} characters`);
  }
  if (!/uma musume/i.test(title)) warnings.push(`${file} -> title omits “Uma Musume”`);
}

validateStaticSocialImages();
validateDynamicSocialImages();

const sitemapPath = path.join(publicRoot, 'sitemap.xml');
const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
const sitemapSet = new Set(sitemapUrls);
if (sitemapSet.size !== sitemapUrls.length) failures.push('public/sitemap.xml -> duplicate URLs');

const indexableUrls = new Set(pages.map((page) => page.canonical).filter(Boolean));
for (const url of indexableUrls) {
  if (!sitemapSet.has(url)) failures.push(`public/sitemap.xml -> missing ${url}`);
}
for (const url of sitemapSet) {
  if (!indexableUrls.has(url))
    failures.push(`public/sitemap.xml -> ${url} has no indexable HTML page`);
}
for (const block of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
  const url = block[1].match(/<loc>([^<]+)<\/loc>/)?.[1].trim() || 'unknown URL';
  const lastModified = block[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1].trim() || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastModified)) {
    failures.push(`public/sitemap.xml -> ${url} is missing a valid YYYY-MM-DD lastmod`);
  } else if (lastModified > new Date().toISOString().slice(0, 10)) {
    failures.push(`public/sitemap.xml -> ${url} has a future lastmod (${lastModified})`);
  }
}

const inboundUrls = new Set();
for (const page of pages) {
  for (const match of page.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const url = normalizeSiteUrl(match[1], page.canonical || siteOrigin);
    if (url && url !== page.canonical) inboundUrls.add(url);
  }
}
const navSource = fs.readFileSync(path.join(publicRoot, 'js', 'nav.js'), 'utf8');
for (const match of navSource.matchAll(/\bpath:\s*["']([^"']+)["']/g)) {
  const url = normalizeSiteUrl(match[1]);
  if (url) inboundUrls.add(url);
}
for (const url of indexableUrls) {
  if (url !== `${siteOrigin}/` && !inboundUrls.has(url)) {
    failures.push(`${url} -> orphaned; no crawlable internal link points to this page`);
  }
}

const robots = fs.readFileSync(path.join(publicRoot, 'robots.txt'), 'utf8').replace(/^\uFEFF/, '');
if (!/^Sitemap:\s*https:\/\/daftuyda\.moe\/sitemap\.xml\s*$/im.test(robots)) {
  failures.push('public/robots.txt -> missing canonical sitemap directive');
}
if (!/^Allow:\s*\/api\/og\s*$/im.test(robots)) {
  failures.push('public/robots.txt -> dynamic social image endpoint is not crawlable');
}

const vercelConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
if (vercelConfig.cleanUrls !== true || vercelConfig.trailingSlash !== false) {
  failures.push('vercel.json -> cleanUrls must be true and trailingSlash must be false');
}
const versionedSocialImageRewrite = vercelConfig.rewrites?.find(
  (rewrite) =>
    rewrite.source === '/api/og/v1/:page.png' && rewrite.destination === '/api/og?page=:page'
);
if (!versionedSocialImageRewrite) {
  failures.push('vercel.json -> missing /api/og/v1/:page.png social image rewrite');
}
const immutableImageHeaders = (vercelConfig.headers || []).filter(
  (rule) =>
    /(?:png|jpe?g|webp|svg|ico)/i.test(rule.source || '') &&
    rule.headers?.some(
      (header) =>
        header.key?.toLowerCase() === 'cache-control' && /\bimmutable\b/i.test(header.value || '')
    )
);
if (!immutableImageHeaders.length) {
  failures.push('vercel.json -> missing immutable cache policy for static image assets');
}
for (const rule of immutableImageHeaders) {
  if (!rule.source.startsWith('/assets/')) {
    failures.push(
      `vercel.json -> immutable image header ${rule.source} must be scoped to /assets/ so API ` +
        `social images and errors are not cached immutably`
    );
  }
}
const hostRedirect = vercelConfig.redirects?.find(
  (redirect) =>
    redirect.permanent === true &&
    redirect.destination === `${siteOrigin}/:path*` &&
    redirect.has?.some(
      (condition) => condition.type === 'host' && condition.value === 'www.daftuyda.moe'
    )
);
if (!hostRedirect) failures.push('vercel.json -> missing permanent www-to-apex redirect');

warnings.forEach((warning) => console.warn(`SEO warning: ${warning}`));
if (failures.length) {
  console.error(`SEO audit failed (${failures.length} issues):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `SEO audit passed (${pages.length} indexable pages, ${sitemapUrls.length} sitemap URLs` +
    `, ${socialImageEndpointTargets.size + staticSocialImagePaths.size} social images` +
    `${warnings.length ? `, ${warnings.length} advisory warnings` : ''}).`
);

import fetch from 'node-fetch';
import Parser from 'rss-parser';
import dotenv from 'dotenv';

dotenv.config();

const WP_API_URL = process.env.WP_API_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;

const MAX_AGE_DAYS = 1;

// Step 1: Add multiple feed/category mappings here
const FEED_CONFIGS = [
  {
    // Everyday Joy
    url: 'https://www.omnycontent.com/d/playlist/78fc2cc4-b65c-4b13-a57e-af7000e01efa/a573cd11-3e6d-4669-a142-af930169f945/f787098c-4a00-4ad2-a3f9-af93016b2fb1/podcast.rss',
    categoryId: 18,
    featuredMediaId: 6316,
  },
  {
    // Father Figures
    url: 'https://www.omnycontent.com/d/playlist/78fc2cc4-b65c-4b13-a57e-af7000e01efa/d82c099b-2d17-4e3d-8deb-b1d30023ed80/3455a8ba-1d19-4d54-86b5-b1d300248a7b/podcast.rss',
    categoryId: 22,
    featuredMediaId: 2884,
  },
  {
    // Lucy & Kel
    url: 'https://www.omnycontent.com/d/playlist/78fc2cc4-b65c-4b13-a57e-af7000e01efa/820b1f9f-131f-481f-93a2-b1e700171b59/8c42df28-9190-4bd7-bad7-b1e7001890b0/podcast.rss',
    categoryId: 19,
    featuredMediaId: 2883,
  },
  {
    // Well Hello Anxiety
    url: 'https://www.omnycontent.com/d/playlist/78fc2cc4-b65c-4b13-a57e-af7000e01efa/ef1bbf20-9776-4f0f-a9b6-b0a3017021b0/b03b36ee-4d1b-4d80-bfac-b0a3017021de/podcast.rss',
    categoryId: 21,
    featuredMediaId: 1587,
  },
  {
    // Towards Understanding
    url: 'https://www.omnycontent.com/d/playlist/78fc2cc4-b65c-4b13-a57e-af7000e01efa/b493f1b9-2fdb-4bfc-93e6-b0880028e267/1aef4a1d-d8b3-4db4-8b1a-b088003a3724/podcast.rss',
    categoryIds: [20, 11],
    featuredMediaId: 5375,
    useSourceMedia: true,
  },
];

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true, includeSnippet: true }],
      ['itunes:image', 'itunesImage', { keepArray: false, includeSnippet: true }],
    ],
  },
});

async function uploadImageToWordPress(imageUrl, auth) {
  try {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
    const imageBuffer = await imageRes.arrayBuffer();
    const fileName = imageUrl.split('/').pop().split('?')[0];

    const uploadRes = await fetch(`${WP_API_URL}/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
      },
      body: imageBuffer,
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.message || 'Upload failed');
    return uploadData.id;
  } catch (err) {
    console.error(`❌ Failed to upload image from ${imageUrl}:`, err);
    return null;
  }
}

function stripHtml(html) {
  if (!html) return '';
  let text = html.replace(/<[^>]*>/g, '');
  return text.replace(/&(?:amp|quot|apos|lt|gt|ndash|mdash|hellip|copy|reg|trade|nbsp);/g, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
    '&ndash;': '–', '&mdash;': '—', '&hellip;': '…', '&copy;': '©', '&reg;': '®',
    '&trade;': '™', '&nbsp;': ' ',
  })[entity] || entity);
}

async function parseFeed(url) {
  const feed = await parser.parseURL(url);
  return feed.items;
}

async function postToWordPress(item, categoryIds, featuredMediaId, useSourceMedia) {
  const auth = Buffer.from(`${WP_USERNAME}:${WP_PASSWORD}`).toString('base64');
  const audioContent = item.mediaContent?.find(content => content.$?.type === 'audio/mpeg');
  const playerUrl = audioContent?.['media:player']?.[0]?.$?.url;

  if (!playerUrl) {
    console.error(`No player URL found for post: ${item.title}`);
    return;
  }

  const pubDateISO = (item.pubDate ? new Date(item.pubDate) : new Date()).toISOString();
  const cleanContent = stripHtml(item.content);
  const excerpt = cleanContent.substring(0, 200) || item.title;

  let mediaId = featuredMediaId;

  if (useSourceMedia && item.itunesImage?.$?.href) {
    const imageUrl = item.itunesImage.$.href;
    console.log(`🌄 Uploading source image: ${imageUrl}`);
    const uploadedId = await uploadImageToWordPress(imageUrl, auth);
    if (uploadedId) {
      mediaId = uploadedId;
    }
  }

  const postBody = {
    title: item.title,
    content: `<p>${item.content}</p><iframe src="${playerUrl}" width="100%" height="180" frameborder="0" allow="autoplay; clipboard-write" allowfullscreen></iframe>`,
    excerpt,
    categories: categoryIds,
    status: 'publish',
    date: pubDateISO,
    date_gmt: pubDateISO,
    featured_media: mediaId,
    acf: {
      disabled: false,
      episode_guid: item.guid?.trim() || null,
    },
  };

  const response = await fetch(`${WP_API_URL}/wp/v2/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postBody),
  });

  const responseBody = await response.json();
  if (!response.ok) {
    console.error(`❌ Failed to create post: ${response.statusText}`, responseBody);
  } else {
    console.log(`✅ Published: ${responseBody.link}`);
  }
}

function isRecent(pubDate) {
  if (!pubDate) return false;
  const now = new Date();
  const postDate = new Date(pubDate);
  const diffDays = (now - postDate) / (1000 * 60 * 60 * 24);
  return diffDays <= MAX_AGE_DAYS;
}

async function processFeed(config) {
  const { url, categoryId, categoryIds, featuredMediaId, useSourceMedia } = config;

  try {
    const items = await parseFeed(url);
    let skippedCount = 0;

    for (const item of items.reverse()) {
      if (!isRecent(item.pubDate)) {
        skippedCount++;
        continue;
      }

      console.log(`\n📥 Importing: ${item.title}`);
      const categoryIdsFinal = categoryIds || (categoryId ? [categoryId] : []);
      await postToWordPress(item, categoryIdsFinal, featuredMediaId, useSourceMedia);
    }

    if (skippedCount > 0) {
      console.log(`⏭️ Skipped ${skippedCount} old item${skippedCount !== 1 ? 's' : ''}`);
    }
  } catch (error) {
    console.error(`❌ Error processing feed ${url}:`, error);
  }
}

async function main() {
  for (const config of FEED_CONFIGS) {
    console.log(`\n=== Processing feed: ${config.url} ===`);
    await processFeed(config);
  }
}

main().catch(console.error);
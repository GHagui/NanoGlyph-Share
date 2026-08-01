import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';

export const CANONICAL_APP_URL = 'https://ghagui.github.io/NanoGlyph-Share/';
export const isNativePlatform = Capacitor.isNativePlatform();

const NanoGlyphMedia = registerPlugin('NanoGlyphMedia');

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function savePngBlob(blob, filename) {
  if (!isNativePlatform) {
    downloadBlob(blob, filename);
    return;
  }
  await NanoGlyphMedia.savePng({
    data: await blobToBase64(blob),
    filename,
  });
}

export async function shareUrl(url) {
  if (isNativePlatform) {
    await Share.share({ url, dialogTitle: 'Share NanoGlyph link' });
    return true;
  }
  if (navigator.share) {
    await navigator.share({ url });
    return true;
  }
  return false;
}

function acceptedDeepLink(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return url.protocol === 'https:'
      && url.hostname === 'ghagui.github.io'
      && url.pathname.startsWith('/NanoGlyph-Share/')
      && url.hash.length > 1
      && url.hash.length <= (8 * 1024 * 1024) + 1;
  } catch {
    return false;
  }
}

export async function initializePlatform(onDeepLink) {
  if (!isNativePlatform) {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
      } catch (error) {
        console.warn('Service Worker registration failed:', error);
      }
    }
    return false;
  }

  const route = event => {
    if (!acceptedDeepLink(event.url)) return false;
    const incoming = new URL(event.url);
    window.location.hash = incoming.hash;
    onDeepLink?.(incoming);
    return true;
  };

  await App.addListener('appUrlOpen', route);
  const launch = await App.getLaunchUrl();
  return launch?.url ? route(launch) : false;
}

const MAX_EDGE = 1280;

export async function processChatImageFile(file: Blob): Promise<{
  base64: string;
  contentType: string;
  filename: string;
}> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process photo');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const base64 = dataUrl.split(',')[1] || '';
  bitmap.close();
  return { base64, contentType: 'image/jpeg', filename: 'photo.jpg' };
}

export function pickWebImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('data-testid', 'chat-photo-file');
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

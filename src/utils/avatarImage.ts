import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { AVATAR_SIZE, squareCrop } from '../lib/avatar';

/** A square ~512 px JPEG, ready to upload (rj t179u). */
export type AvatarImage = { base64: string; contentType: 'image/jpeg' };

async function processNative(uri: string, width: number, height: number): Promise<AvatarImage> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: squareCrop(width, height) }, { resize: { width: AVATAR_SIZE, height: AVATAR_SIZE } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  const base64 =
    result.base64 ||
    (await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 }));
  if (!base64) throw new Error('Could not read the photo. Try another image.');
  return { base64, contentType: 'image/jpeg' };
}

/** Web: center-crop on a canvas. */
export async function processAvatarWebFile(file: Blob): Promise<AvatarImage> {
  const bitmap = await createImageBitmap(file);
  const c = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  const side = Math.min(AVATAR_SIZE, c.width);
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process photo');
  ctx.drawImage(bitmap, c.originX, c.originY, c.width, c.height, 0, 0, side, side);
  bitmap.close();
  const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || '';
  if (!base64) throw new Error('Could not read the photo. Try another image.');
  return { base64, contentType: 'image/jpeg' };
}

/** Native: gallery with the square crop editor. Null when cancelled. */
export async function pickAvatarImage(): Promise<AvatarImage | null> {
  if (Platform.OS === 'web') throw new Error('Use the file picker on the web');
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library permission is required');
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
    exif: false,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  const a = picked.assets[0];
  return processNative(a.uri, a.width || AVATAR_SIZE, a.height || AVATAR_SIZE);
}

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { processChatImageFile } from './chatImage';

export const MAX_IMAGE_EDGE = 1280;

export type ProcessedImage = {
  uri: string;
  base64: string;
  contentType: 'image/jpeg';
  filename: string;
};

function resizeActions(width?: number, height?: number): ImageManipulator.Action[] {
  if (!width || !height) return [];
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_IMAGE_EDGE) return [];
  if (width >= height) return [{ resize: { width: MAX_IMAGE_EDGE } }];
  return [{ resize: { height: MAX_IMAGE_EDGE } }];
}

export async function processImageUri(
  uri: string,
  size?: { width?: number; height?: number }
): Promise<ProcessedImage> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    resizeActions(size?.width, size?.height),
    {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );
  let base64 = result.base64;
  if (!base64) {
    base64 = await FileSystem.readAsStringAsync(result.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  if (!base64) {
    throw new Error('Could not read the photo. Try another image.');
  }
  return {
    uri: result.uri,
    base64,
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
  };
}

export async function pickProcessedImage(): Promise<ProcessedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required');
  }
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
    exif: false,
    allowsEditing: true,
  });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  const asset = picked.assets[0];
  return processImageUri(asset.uri, { width: asset.width, height: asset.height });
}

export async function processWebFile(file: File): Promise<ProcessedImage> {
  const processed = await processChatImageFile(file);
  return {
    uri: `data:image/jpeg;base64,${processed.base64}`,
    base64: processed.base64,
    contentType: 'image/jpeg',
    filename: processed.filename,
  };
}

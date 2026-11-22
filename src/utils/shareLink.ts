import { Platform, Share } from 'react-native';
import { showToast } from '../stores/toastStore';

/**
 * Share a link: the system share sheet on Android/iOS; on the web the browser's
 * share sheet (navigator.share) where there is one, else copy to the clipboard.
 */
export async function shareLink(url: string, title: string): Promise<void> {
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message: `${title}\n${url}`, title, url });
    } catch {
      showToast('Could not open the share menu.', 'error');
    }
    return;
  }
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav?.share) {
    try {
      await nav.share({ title, url });
      return;
    } catch (e) {
      // The person closed the share sheet: nothing to report.
      if ((e as { name?: string })?.name === 'AbortError') return;
    }
  }
  try {
    await nav?.clipboard?.writeText(url);
    showToast('Link copied', 'success', 'map');
  } catch {
    showToast('Could not copy the link.', 'error', 'map');
  }
}

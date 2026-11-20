import { useRef } from 'react';
import { router } from 'expo-router';
import { Screen, ScreenHeader, useToast } from '@/components/design-system';
import { toListingPayload } from '@/domain/listings';
import { ListingWizard, type ListingDraftPhoto } from '@/features/listings/ListingWizard';
import { AppError, fail } from '@/lib/errors';
import { buildObjectPath, uploadPrivateFile } from '@/providers/storage/private-upload';
import { listingManagementRepository } from '@/repositories';

/** Creates the draft and its required first cover photo as one retry-safe flow. */
export default function NewListing() {
  const toast = useToast();
  const listingId = useRef<string | null>(null);
  const uploadedPath = useRef<string | null>(null);

  return (
    <Screen>
      <ScreenHeader title="New listing" size="compact" back />
      <ListingWizard
        initial={{ title: '', category: '', condition: undefined as never, description: '', equipmentNotes: '', dailyRate: '', deposit: '0', lateFeePerDay: '0', pickupPointId: null, pickupNotes: '' }}
        submitLabel="Save draft"
        requireCoverPhoto
        onSubmit={async (values, photo?: ListingDraftPhoto) => {
          if (!photo) return fail(new AppError('validation', 'Add a cover photo before saving this listing.', 'photos'));
          if (!listingId.current) {
            const created = await listingManagementRepository.create(toListingPayload(values));
            if (!created.ok) return created;
            listingId.current = created.data;
          }
          if (!uploadedPath.current) {
            const path = buildObjectPath(listingId.current, photo.mimeType);
            const uploaded = await uploadPrivateFile({ bucket: 'listing-images', path, uri: photo.uri, mimeType: photo.mimeType }).promise;
            if (!uploaded.ok) return fail(new AppError(uploaded.error.kind, `Draft saved, but the cover photo could not upload. Try Save draft again. ${uploaded.error.message}`, uploaded.error.code));
            uploadedPath.current = uploaded.data.path;
          }
          const registered = await listingManagementRepository.addImage(listingId.current, uploadedPath.current);
          if (!registered.ok) return fail(new AppError(registered.error.kind, `Draft saved, but the cover photo could not be attached. Try Save draft again. ${registered.error.message}`, registered.error.code));
          toast.show({ title: 'Draft saved with cover photo', message: 'You can add or rearrange more photos before publishing.', tone: 'success' });
          router.replace(`/manage/listings/${listingId.current}`);
          return registered;
        }}
      />
    </Screen>
  );
}

import { useLocalSearchParams } from 'expo-router';
import { Banner, ErrorState, LoadingRows, Screen, ScreenHeader } from '@/components/design-system';
import { ListingDetailView } from '@/features/listings/ListingDetailView';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository } from '@/repositories';

/** Shows the listing exactly as verified students will see it (Journey B.4 "preview"). */
export default function ListingPreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useAsync(() => listingManagementRepository.get(id), [id]);
  const l = listing.data;
  const photos = useListingPhotos(l?.images.map((i) => i.path) ?? []);
  return (
    <Screen>
      <ScreenHeader title="Preview" size="compact" back />
      {listing.error ? (
        <ErrorState offline={listing.error.kind === 'network'} message={listing.error.message} onRetry={listing.reload} />
      ) : !l ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <Banner tone="info" title="This is how verified students will see your listing" message={l.status === 'active' ? 'It’s live now.' : 'It isn’t visible to students until you publish it.'} />
          <ListingDetailView
            listing={{
              title: l.title,
              categoryLabel: l.categoryLabel,
              condition: l.condition,
              description: l.description,
              equipmentNotes: l.equipmentNotes,
              dailyRate: l.dailyRate,
              deposit: l.deposit,
              lateFeePerDay: l.lateFeePerDay,
              pickupPointLabel: l.pickupPointLabel,
              pickupNotes: l.pickupNotes,
              photoUrls: l.images.map((i) => photos.data?.[i.path]).filter((u): u is string => Boolean(u)),
            }}
          />
        </>
      )}
    </Screen>
  );
}

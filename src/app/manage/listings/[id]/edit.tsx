import { router, useLocalSearchParams } from 'expo-router';
import { Banner, ErrorState, LoadingRows, Screen, ScreenHeader, useToast } from '@/components/design-system';
import { centavosToInput, toListingPayload } from '@/domain/listings';
import { ListingWizard } from '@/features/listings/ListingWizard';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository } from '@/repositories';

export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const listing = useAsync(() => listingManagementRepository.get(id), [id]);
  const l = listing.data;
  return (
    <Screen>
      <ScreenHeader title="Edit listing" size="compact" back />
      {listing.error ? (
        <ErrorState offline={listing.error.kind === 'network'} message={listing.error.message} onRetry={listing.reload} />
      ) : !l ? (
        listing.loading ? <LoadingRows rows={4} /> : <Banner tone="warning" title="This listing no longer exists." />
      ) : (
        <>
          <Banner tone="info" title="Existing bookings keep their agreed terms" message="Changes apply to new requests only. Accepted bookings keep the title, price, deposit and late fee that were agreed." />
          <ListingWizard
            initial={{
              title: l.title,
              category: l.category,
              condition: l.condition,
              description: l.description,
              equipmentNotes: l.equipmentNotes ?? '',
              dailyRate: centavosToInput(l.dailyRate),
              deposit: centavosToInput(l.deposit),
              lateFeePerDay: centavosToInput(l.lateFeePerDay),
              pickupPointId: l.pickupPointId,
              pickupNotes: l.pickupNotes ?? '',
            }}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              const r = await listingManagementRepository.update(id, toListingPayload(values));
              if (r.ok) {
                toast.show({ title: 'Changes saved', tone: 'success' });
                router.back();
              }
              return r;
            }}
          />
        </>
      )}
    </Screen>
  );
}
